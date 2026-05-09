/**
 * whale-analyzer-pro.ts
 * Analisis whale lanjutan: Sharpe ratio, entry timing, MEV detection
 * Menggunakan data GeckoTerminal (sesuai arsitektur bot yang ada)
 */

import axios from 'axios';

const GECKO_BASE    = 'https://api.geckoterminal.com/api/v2';
const GECKO_HEADERS = { Accept: 'application/json;version=20230302' };

export interface WhaleQualityScore {
    totalScore:      number;    // 0–100
    sharpeRatio:     number;
    avgEntryTiming:  number;    // 0–100, makin tinggi makin awal entry-nya
    realizedPnL7d:   number;    // % estimasi 7 hari
    buyToSellRatio:  number;    // >1 = net buyer (bagus)
    mevDetected:     boolean;   // true = kemungkinan bot/MEV — hati-hati
    uniquePoolCount: number;
    tradeCount:      number;
    avgVolumeUsd:    number;
}

interface TradeRec {
    kind:       'buy' | 'sell';
    volumeUsd:  number;
    priceUsd:   number;
    timestampMs: number;
    poolAddress: string;
}

// ── Fetch trades for a wallet across GeckoTerminal pools ───────────────────────
async function fetchWalletTrades(walletAddress: string, maxPools = 8): Promise<TradeRec[]> {
    const allTrades: TradeRec[] = [];
    try {
        // Fetch trending + new pools
        const [trendRes, newRes] = await Promise.allSettled([
            axios.get(`${GECKO_BASE}/networks/base/pools?sort=h24_volume_desc&page=1`, { headers: GECKO_HEADERS, timeout: 8000 }),
            axios.get(`${GECKO_BASE}/networks/base/pools?sort=pool_created_at_desc&page=1`, { headers: GECKO_HEADERS, timeout: 8000 }),
        ]);

        const pools: any[] = [
            ...((trendRes.status === 'fulfilled' ? trendRes.value.data?.data : []) ?? []),
            ...((newRes.status === 'fulfilled' ? newRes.value.data?.data : []) ?? []),
        ].filter((p: any) => p.attributes?.address);

        // Deduplicate
        const seen = new Set<string>();
        const unique = pools.filter((p: any) => {
            const addr = p.attributes.address;
            if (seen.has(addr)) return false;
            seen.add(addr);
            return true;
        }).slice(0, maxPools);

        // Fetch trades for each pool in parallel
        await Promise.allSettled(unique.map(async (pool: any) => {
            const poolAddress = pool.attributes.address;
            try {
                const res = await axios.get(
                    `${GECKO_BASE}/networks/base/pools/${poolAddress}/trades`,
                    { headers: GECKO_HEADERS, timeout: 7000 }
                );
                const trades: any[] = res.data?.data ?? [];
                for (const t of trades) {
                    const a = t.attributes ?? {};
                    if ((a.tx_from_address ?? '').toLowerCase() !== walletAddress.toLowerCase()) continue;
                    allTrades.push({
                        kind:        a.kind === 'buy' ? 'buy' : 'sell',
                        volumeUsd:   parseFloat(a.volume_in_usd ?? '0'),
                        priceUsd:    parseFloat(a.price_to_in_usd ?? a.price_from_in_usd ?? '0'),
                        timestampMs: a.block_timestamp ? new Date(a.block_timestamp).getTime() : Date.now(),
                        poolAddress,
                    });
                }
            } catch { /* skip pool */ }
        }));
    } catch { /* fallback to empty */ }
    return allTrades;
}

// ── Sharpe ratio from trade returns ──────────────────────────────────────────
function calcSharpe(buys: TradeRec[], sells: TradeRec[]): number {
    if (buys.length < 2) return 0;
    // Estimate returns: pair each sell with chronologically preceding buy in same pool
    const returns: number[] = [];
    for (const sell of sells) {
        const matchBuy = buys
            .filter(b => b.poolAddress === sell.poolAddress && b.timestampMs < sell.timestampMs)
            .sort((a, b) => b.timestampMs - a.timestampMs)[0];
        if (matchBuy && matchBuy.priceUsd > 0 && sell.priceUsd > 0) {
            returns.push((sell.priceUsd - matchBuy.priceUsd) / matchBuy.priceUsd);
        }
    }
    if (returns.length < 2) return 0;
    const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.map(r => Math.pow(r - avg, 2)).reduce((a, b) => a + b, 0) / returns.length;
    const std = Math.sqrt(variance);
    return std === 0 ? 0 : parseFloat((avg / std).toFixed(3));
}

// ── Entry timing: did whale buy early in the pool's life? ─────────────────────
function calcEntryTiming(buys: TradeRec[]): number {
    if (!buys.length) return 50;
    // Earliest buy timestamp in each pool vs the pool's oldest trade
    const byPool = new Map<string, TradeRec[]>();
    for (const b of buys) {
        if (!byPool.has(b.poolAddress)) byPool.set(b.poolAddress, []);
        byPool.get(b.poolAddress)!.push(b);
    }
    let totalScore = 0;
    for (const [, poolBuys] of byPool) {
        const earliest = Math.min(...poolBuys.map(b => b.timestampMs));
        const latest   = Math.max(...poolBuys.map(b => b.timestampMs));
        const range    = latest - earliest;
        // If only one trade or same time — perfect early entry
        if (range < 60_000) { totalScore += 100; continue; }
        const whaleFirst = Math.min(...poolBuys.map(b => b.timestampMs));
        const relPosition = (whaleFirst - earliest) / range;
        totalScore += Math.max(0, 100 - relPosition * 100);
    }
    return Math.round(totalScore / byPool.size);
}

// ── MEV/bot detection: very fast repeated trades (< 5s apart) ────────────────
function detectMEV(trades: TradeRec[]): boolean {
    const sorted = [...trades].sort((a, b) => a.timestampMs - b.timestampMs);
    let fastCount = 0;
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].timestampMs - sorted[i - 1].timestampMs < 5000) fastCount++;
    }
    return fastCount >= 3; // 3+ trades within 5s each = likely MEV/bot
}

// ── 7-day profit estimate ─────────────────────────────────────────────────────
function calc7DayProfit(buys: TradeRec[], sells: TradeRec[]): number {
    const cutoff = Date.now() - 7 * 86_400_000;
    const recent = sells.filter(s => s.timestampMs > cutoff);
    if (!recent.length) return 0;
    let total = 0;
    for (const sell of recent) {
        const matchBuy = buys
            .filter(b => b.poolAddress === sell.poolAddress && b.timestampMs < sell.timestampMs)
            .sort((a, b) => b.timestampMs - a.timestampMs)[0];
        if (matchBuy && matchBuy.priceUsd > 0 && sell.priceUsd > 0) {
            total += ((sell.priceUsd - matchBuy.priceUsd) / matchBuy.priceUsd) * 100;
        }
    }
    return parseFloat((total / Math.max(1, recent.length)).toFixed(1));
}

// ── Composite score (0–100) ───────────────────────────────────────────────────
function compositeScore(q: Omit<WhaleQualityScore, 'totalScore'>): number {
    let score = 0;
    // Sharpe: ideal > 1.5
    score += Math.min(25, Math.max(0, q.sharpeRatio) * 15);
    // Entry timing (0–100 → 0–20 pts)
    score += (q.avgEntryTiming / 100) * 20;
    // 7d PnL: up to 20 pts
    score += Math.min(20, Math.max(0, q.realizedPnL7d / 5));
    // Buy/sell ratio > 1 is good, up to 15 pts
    score += Math.min(15, Math.max(0, (q.buyToSellRatio - 0.5) * 15));
    // Unique pools: up to 10 pts
    score += Math.min(10, q.uniquePoolCount * 2);
    // MEV detected: penalty
    if (q.mevDetected) score -= 20;
    return Math.round(Math.max(0, Math.min(100, score)));
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function analyzeWhale(walletAddress: string): Promise<WhaleQualityScore> {
    const trades = await fetchWalletTrades(walletAddress);
    const buys   = trades.filter(t => t.kind === 'buy');
    const sells  = trades.filter(t => t.kind === 'sell');

    const uniquePools   = new Set(trades.map(t => t.poolAddress)).size;
    const avgVolumeUsd  = trades.length > 0 ? trades.reduce((s, t) => s + t.volumeUsd, 0) / trades.length : 0;
    const buyToSellRatio = sells.length > 0 ? buys.length / sells.length : buys.length;

    const partial: Omit<WhaleQualityScore, 'totalScore'> = {
        sharpeRatio:    calcSharpe(buys, sells),
        avgEntryTiming: calcEntryTiming(buys),
        realizedPnL7d:  calc7DayProfit(buys, sells),
        buyToSellRatio: parseFloat(buyToSellRatio.toFixed(2)),
        mevDetected:    detectMEV(trades),
        uniquePoolCount: uniquePools,
        tradeCount:     trades.length,
        avgVolumeUsd:   parseFloat(avgVolumeUsd.toFixed(2)),
    };

    return {
        ...partial,
        totalScore: compositeScore(partial),
    };
}

// ── Crowd-copy signal: score across multiple whales buying same token ─────────
export function crowdCopySignal(
    whaleScores: { address: string; score: number; isBuying: boolean }[],
): { signal: number; shouldCopy: boolean } {
    const signal = whaleScores
        .filter(w => w.isBuying)
        .reduce((s, w) => s + w.score, 0);
    return { signal, shouldCopy: signal >= 200 };
}
