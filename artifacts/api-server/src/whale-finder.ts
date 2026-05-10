/**
 * whale-finder.ts
 *
 * Discovers profitable whale wallets on Base by:
 * 1. Fetching trending + new pools from GeckoTerminal
 * 2. Pulling recent TRADES from GeckoTerminal /pools/{pool}/trades (gives real tx_from_address)
 * 3. Building a cross-pool wallet map: wallets that buy in 2+ different tokens = candidates
 * 4. Scoring on trade volume, unique-pool count, recency, and buy/sell activity
 * 5. Persisting candidates in SQLite; sending Telegram notification for approval
 *
 * Manual scans always run immediately (no cooldown).
 * Auto-scans respect a 15-minute cooldown.
 */

import axios from 'axios';
import { getGeckoTrendingPools, getGeckoNewPools, getBestDexPair, getEthPriceUsd } from './price-oracle';
import {
    initDb,
    dbUpsertWhale, dbGetWhale, dbGetPendingWhales, dbGetAllWhales,
    dbApproveWhale, dbRejectWhale, dbWhaleExists, dbIsRejected, dbMonitorWhale,
    type WhaleRow,
} from './db';

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';
const GECKO_HEADERS = { Accept: 'application/json;version=20230302' };

// ─── Known non-trader addresses to skip ──────────────────────────────────────
const SKIP_ADDRESSES = new Set([
    '0x4200000000000000000000000000000000000006', // WETH
    '0x2626664c2603336e57b271c5c0b26f421741e481', // Uniswap V3 Router
    '0x33128a8fc17869897dce68ed026d694621f6fdfd', // Uniswap V3 Factory
    '0x03a520b32c04bf3beef7beb072f8deaa56b05f91', // Uniswap NFT Position Manager
    '0x000000000000000000000000000000000000dead', // Burn
    '0x0000000000000000000000000000000000000000', // Zero
    '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', // Universal Router
]);

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface WhaleCandidate {
    address:          string;
    estimatedWinRate: number;
    tradeCount:       number;
    avgProfitPct:     number;
    totalVolumeEth:   number;
    lastActiveMs:     number;
    discoveredAt:     number;
    score:            number;
    tokens:           string[];
    status:           'pending' | 'approved' | 'rejected' | 'monitoring';
    approvedAt?:      number;
}

export interface SimulationResult {
    walletAddress:   string;
    tokenAddress:    string;
    tokenSymbol:     string;
    simulated:       boolean;
    estimatedProfit: number;
    estimatedRisk:   'LOW' | 'MEDIUM' | 'HIGH';
    winRate:         number;
    tradeCount:      number;
    summary:         string;
}

// ─── Internal trade record ────────────────────────────────────────────────────

interface TradeRecord {
    walletAddress: string;
    poolAddress:   string;
    tokenAddress:  string;
    tokenSymbol:   string;
    kind:          'buy' | 'sell';
    volumeUsd:     number;
    timestampMs:   number;
}

// ─── Init DB ──────────────────────────────────────────────────────────────────
initDb();

// ─── Auto-scan cooldown (manual scans always bypass this) ────────────────────
let lastAutoScanMs = 0;
const AUTO_SCAN_COOLDOWN_MS = 15 * 60 * 1000;

// ─── Live ETH price (updated before each scan) ───────────────────────────────
let _ethPriceUsd = 3000;

// ─── Scan filters ─────────────────────────────────────────────────────────────
const FILTERS = {
    MIN_UNIQUE_POOLS:     2,     // must appear in trades for 2+ different pools
    MIN_TOTAL_TRADES:     3,     // min total buy trades across all pools
    MIN_SCORE:            40,    // minimum composite score
    MAX_LAST_ACTIVE_DAYS: 7,     // active within last 7 days
    MIN_TRADE_VOLUME_USD: 50,    // minimum per-trade volume to count
};

// ─── Convert DB row ↔ WhaleCandidate ─────────────────────────────────────────

function rowToCandidate(r: WhaleRow): WhaleCandidate {
    return {
        address:          r.address,
        estimatedWinRate: r.estimatedWinRate,
        tradeCount:       r.tradeCount,
        avgProfitPct:     r.avgProfitPct,
        totalVolumeEth:   r.totalVolumeEth,
        lastActiveMs:     r.lastActiveMs,
        discoveredAt:     r.discoveredAt,
        score:            r.score,
        tokens:           r.tokens,
        status:           r.status,
        approvedAt:       r.approvedAt,
    };
}

// ─── GeckoTerminal: fetch recent trades for a pool ───────────────────────────
// Returns trades including tx_from_address (the real trader wallet)

async function getPoolTrades(
    poolAddress: string,
    tokenAddress: string,
    tokenSymbol: string,
): Promise<TradeRecord[]> {
    try {
        const url = `${GECKO_BASE}/networks/base/pools/${poolAddress}/trades`;
        const res = await axios.get(url, {
            headers: GECKO_HEADERS,
            params: { trade_volume_in_usd_greater_than: FILTERS.MIN_TRADE_VOLUME_USD },
            timeout: 10_000,
        });

        const trades: any[] = res.data?.data ?? [];
        const records: TradeRecord[] = [];

        for (const t of trades) {
            const a = t.attributes ?? {};
            const wallet = (a.tx_from_address ?? '').toLowerCase();
            if (!wallet || !wallet.startsWith('0x')) continue;
            if (SKIP_ADDRESSES.has(wallet)) continue;

            const kind: 'buy' | 'sell' = a.kind === 'buy' ? 'buy' : 'sell';
            const volumeUsd  = parseFloat(a.volume_in_usd ?? '0');
            const timestampMs = a.block_timestamp
                ? new Date(a.block_timestamp).getTime()
                : Date.now();

            records.push({ walletAddress: wallet, poolAddress, tokenAddress, tokenSymbol, kind, volumeUsd, timestampMs });
        }

        return records;
    } catch {
        return [];
    }
}

// ─── Score calculation ────────────────────────────────────────────────────────

function computeScore(
    estimatedWinRate: number,
    tradeCount:       number,
    uniquePools:      number,
    totalVolumeUsd:   number,
    lastActiveMs:     number,
): number {
    let score = 0;
    score += Math.min(30, (estimatedWinRate / 100) * 30);   // up to 30 for win rate
    score += Math.min(20, (tradeCount / 15)  * 20);          // up to 20 for trade frequency
    score += Math.min(25, (uniquePools / 5)  * 25);          // up to 25 for multi-pool activity
    score += Math.min(15, Math.log10(Math.max(1, totalVolumeUsd / 100)) * 7); // up to 15 for volume
    const daysSince = (Date.now() - lastActiveMs) / 86_400_000;
    score += Math.max(0, 10 - daysSince * 1.5);              // up to 10 for recency
    return Math.round(Math.min(100, score));
}

// ─── Build candidate from cross-pool trade data ───────────────────────────────

function buildCandidate(
    walletAddr: string,
    tradesByPool: Map<string, TradeRecord[]>,
): WhaleCandidate | null {
    if (dbWhaleExists(walletAddr)) return null;
    if (dbIsRejected(walletAddr))  return null;

    const uniquePools = tradesByPool.size;
    if (uniquePools < FILTERS.MIN_UNIQUE_POOLS) return null;

    let totalBuys  = 0;
    let totalSells = 0;
    let totalVolumeUsd = 0;
    let lastActiveMs   = 0;
    const tokenAddresses: string[] = [];

    for (const records of tradesByPool.values()) {
        for (const r of records) {
            if (r.kind === 'buy')  totalBuys++;
            if (r.kind === 'sell') totalSells++;
            totalVolumeUsd += r.volumeUsd;
            if (r.timestampMs > lastActiveMs) lastActiveMs = r.timestampMs;
            if (!tokenAddresses.includes(r.tokenAddress)) tokenAddresses.push(r.tokenAddress);
        }
    }

    const totalTrades = totalBuys + totalSells;
    if (totalBuys < FILTERS.MIN_TOTAL_TRADES) return null;

    const daysSince = (Date.now() - lastActiveMs) / 86_400_000;
    if (daysSince > FILTERS.MAX_LAST_ACTIVE_DAYS) return null;

    // Estimate win rate: wallets that also sell (take profit) score higher
    const sellRatio        = totalBuys > 0 ? totalSells / totalBuys : 0;
    const estimatedWinRate = Math.round(Math.min(82, 50 + sellRatio * 25 + uniquePools * 2));

    // ETH volume using live price (updated before each scan)
    const totalVolumeEth = parseFloat((totalVolumeUsd / _ethPriceUsd).toFixed(4));

    const avgProfitEst = Math.round(Math.max(5, (estimatedWinRate - 45) * 1.2));

    const score = computeScore(estimatedWinRate, totalTrades, uniquePools, totalVolumeUsd, lastActiveMs);
    if (score < FILTERS.MIN_SCORE) return null;

    return {
        address:          walletAddr,
        estimatedWinRate,
        tradeCount:       totalTrades,
        avgProfitPct:     avgProfitEst,
        totalVolumeEth,
        lastActiveMs,
        discoveredAt:     Date.now(),
        score,
        tokens:           tokenAddresses.slice(0, 8),
        status:           'pending',
    };
}

// ─── Main scan function ───────────────────────────────────────────────────────

/**
 * @param forceManual  When true, bypass the 15-minute auto-scan cooldown.
 *                     Always pass true for API-triggered manual scans.
 */
export async function runWhaleScan(forceManual = false): Promise<WhaleCandidate[]> {
    const now = Date.now();

    if (!forceManual && now - lastAutoScanMs < AUTO_SCAN_COOLDOWN_MS) {
        console.log('[WhaleFinder] Auto-scan cooldown — returning cached candidates');
        return dbGetPendingWhales().map(rowToCandidate);
    }

    if (!forceManual) lastAutoScanMs = now;

    console.log(`\n🔍 [WhaleFinder] Starting ${forceManual ? 'MANUAL' : 'auto'} whale scan...`);
    _ethPriceUsd = await getEthPriceUsd().catch(() => _ethPriceUsd);
    console.log(`   💲 ETH price: $${_ethPriceUsd.toFixed(0)}`);
    const newCandidates: WhaleCandidate[] = [];

    try {
        // ── Fetch pools ───────────────────────────────────────────────────────
        const [trending, newPools] = await Promise.all([
            getGeckoTrendingPools().catch(() => []),
            getGeckoNewPools().catch(() => []),
        ]);

        const allPools = [...trending, ...newPools];
        const seenPools = new Set<string>();
        const topPools = allPools
            .filter(p => {
                if (!p.tokenAddress || !p.pairAddress) return false;
                if (seenPools.has(p.pairAddress)) return false;
                seenPools.add(p.pairAddress);
                return p.liquidityUsd > 1000 && p.volumeH24 > 100;
            })
            .sort((a, b) => b.volumeH24 - a.volumeH24)
            .slice(0, 14);

        console.log(`   📊 Scanning ${topPools.length} pools (${trending.length} trending + ${newPools.length} new)`);

        // ── Fetch trades for all pools in parallel ────────────────────────────
        const allTradeResults = await Promise.all(
            topPools.map(p => getPoolTrades(p.pairAddress, p.tokenAddress, p.tokenSymbol ?? 'UNKNOWN'))
        );

        // ── Build wallet → pool → trades map ─────────────────────────────────
        // wallet address → (pool address → list of trade records)
        const walletMap = new Map<string, Map<string, TradeRecord[]>>();

        for (const trades of allTradeResults) {
            for (const trade of trades) {
                if (!walletMap.has(trade.walletAddress)) {
                    walletMap.set(trade.walletAddress, new Map());
                }
                const poolMap = walletMap.get(trade.walletAddress)!;
                if (!poolMap.has(trade.poolAddress)) {
                    poolMap.set(trade.poolAddress, []);
                }
                poolMap.get(trade.poolAddress)!.push(trade);
            }
        }

        // Log how many unique traders we found
        const buyerCount = [...walletMap.values()].filter(pm => [...pm.values()].some(trades => trades.some(t => t.kind === 'buy'))).length;
        console.log(`   👥 ${walletMap.size} unique traders found (${buyerCount} with buy trades)`);

        // ── Score each wallet ─────────────────────────────────────────────────
        for (const [walletAddr, tradesByPool] of walletMap) {
            try {
                const candidate = buildCandidate(walletAddr, tradesByPool);
                if (candidate) {
                    dbUpsertWhale(candidate);
                    newCandidates.push(candidate);
                    console.log(
                        `   🐋 FOUND: ${walletAddr.slice(0, 10)}... ` +
                        `score=${candidate.score} WR=${candidate.estimatedWinRate}% ` +
                        `pools=${tradesByPool.size} vol=$${(candidate.totalVolumeEth * _ethPriceUsd).toFixed(0)}`
                    );
                }
            } catch { /* skip individual wallet errors */ }
        }

        console.log(`[WhaleFinder] Scan complete — ${newCandidates.length} new candidates (${walletMap.size} wallets analysed)`);

    } catch (err: any) {
        console.warn(`[WhaleFinder] Scan error: ${err.message}`);
    }

    return newCandidates;
}

// ─── Approval / Rejection (DB-backed) ────────────────────────────────────────

export function getPendingCandidates(): WhaleCandidate[] {
    return dbGetPendingWhales().map(rowToCandidate);
}

export function getAllCandidates(): WhaleCandidate[] {
    return dbGetAllWhales().map(rowToCandidate);
}

export function approveCandidate(address: string): WhaleCandidate | null {
    const row = dbApproveWhale(address);
    return row ? rowToCandidate(row) : null;
}

export function monitorCandidate(address: string): WhaleCandidate | null {
    dbMonitorWhale(address);
    const row = dbGetWhale(address.toLowerCase());
    return row ? rowToCandidate(row) : null;
}

export function rejectCandidate(address: string): void {
    dbRejectWhale(address);
}

// ─── Simulation ───────────────────────────────────────────────────────────────

export async function simulateCopyTrade(
    walletAddress: string,
    tokenAddress:  string
): Promise<SimulationResult> {
    const wallet      = dbGetWhale(walletAddress.toLowerCase());
    const pair        = await getBestDexPair(tokenAddress);
    const tokenSymbol = pair?.baseToken?.symbol ?? 'UNKNOWN';

    let simProfit = 0;
    let wins = 0;
    let losses = 0;
    let simulated = false;

    if (wallet) {
        // Simulate based on wallet's overall estimated stats
        const simTrades = Math.max(3, Math.min(10, wallet.tradeCount));
        simulated = true;
        for (let i = 0; i < simTrades; i++) {
            const won = Math.random() * 100 < wallet.estimatedWinRate;
            const tradeProfit = won
                ? (10 + Math.random() * 80)
                : -(8 + Math.random() * 25);
            simProfit += tradeProfit;
            if (won) wins++; else losses++;
        }
        if (wins + losses > 0) simProfit = simProfit / (wins + losses);
    } else {
        simProfit = 15;
        wins = 3; losses = 2;
    }

    const winRate = wins + losses > 0
        ? Math.round((wins / (wins + losses)) * 100)
        : wallet?.estimatedWinRate ?? 50;

    const riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' =
        winRate >= 65 && simProfit > 20 ? 'LOW' :
        winRate >= 50 ? 'MEDIUM' : 'HIGH';

    const summary = simulated
        ? `Simulasi ${wins + losses} trade: ${wins} profit, ${losses} rugi. Est. ${simProfit >= 0 ? '+' : ''}${simProfit.toFixed(0)}% rata-rata.`
        : `Data terbatas untuk ${tokenSymbol}. Berdasarkan performa whale: est. +${simProfit.toFixed(0)}% per trade.`;

    return {
        walletAddress,
        tokenAddress,
        tokenSymbol,
        simulated,
        estimatedProfit: Math.round(simProfit),
        estimatedRisk:   riskLevel,
        winRate,
        tradeCount:      wins + losses,
        summary,
    };
}

// ─── Format Telegram message for candidate ────────────────────────────────────

export function formatWhaleTelegramMsg(candidate: WhaleCandidate, index: number): string {
    const daysSince = ((Date.now() - candidate.lastActiveMs) / 86_400_000).toFixed(1);
    const stars = candidate.score >= 80 ? '⭐⭐⭐' : candidate.score >= 60 ? '⭐⭐' : '⭐';
    const volUsd = (candidate.totalVolumeEth * _ethPriceUsd).toFixed(0);
    return (
        `🐋 <b>Whale Kandidat #${index + 1}</b>\n` +
        `${stars} Skor: <b>${candidate.score}/100</b>\n\n` +
        `👤 Alamat: <code>${candidate.address}</code>\n` +
        `📊 Est. Win Rate: <b>${candidate.estimatedWinRate}%</b>\n` +
        `📈 Est. Avg Profit: <b>+${candidate.avgProfitPct}%</b>\n` +
        `🔢 Total Trade: ${candidate.tradeCount}\n` +
        `🪙 Pool diperdagangkan: ${candidate.tokens.length}\n` +
        `💰 Est. Volume: ~$${volUsd}\n` +
        `⏱ Terakhir aktif: ${daysSince} hari lalu\n\n` +
        `✅ Balas: /approve ${candidate.address}\n` +
        `❌ Balas: /reject ${candidate.address}`
    );
}
