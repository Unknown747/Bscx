/**
 * whale-monitor.ts
 *
 * Monitors "approved-for-monitoring" whale wallets.
 * PRIMARY: Blockscout API — baca riwayat tx langsung dari blockchain Base
 * FALLBACK: GeckoTerminal pool trades — jika Blockscout tidak tersedia
 *
 * Poll interval: 10 menit
 */

import axios from 'axios';
import {
    dbGetMonitoredWallets, dbUpdateMonitoredStats,
    dbGetMonitoredWallet,
    type MonitoredWalletRow,
} from './db';
import { getGeckoTrendingPools } from './price-oracle';
import { analyzeWalletOnChain, isBasescanAvailable } from './basescan-monitor';

const GECKO_BASE    = 'https://api.geckoterminal.com/api/v2';
const GECKO_HEADERS = { Accept: 'application/json;version=20230302' };

interface TradeRecord {
    walletAddress: string;
    poolAddress:   string;
    kind:          'buy' | 'sell';
    priceUsd:      number;
    volumeUsd:     number;
    timestampMs:   number;
}

// In-memory trade history between polls (cleared after each stat update)
const walletHistory = new Map<string, { buys: TradeRecord[]; sells: TradeRecord[] }>();
// Track which trade timestamps we've already seen (dedupe)
const seenTxKeys   = new Set<string>();

export class WhaleMonitorService {
    private pollTimer: NodeJS.Timeout | null = null;
    private readonly POLL_MS = 10 * 60 * 1000;

    start(): void {
        const mode = isBasescanAvailable() ? 'Blockscout API (on-chain)' : 'GeckoTerminal (pool-only)';
        console.log(`🔬 WhaleMonitorService started — polling every 10 min via ${mode}`);
        this.poll().catch(() => {});
        this.pollTimer = setInterval(() => this.poll().catch(() => {}), this.POLL_MS);
    }

    stop(): void {
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
        console.log('🔬 WhaleMonitorService stopped');
    }

    async poll(): Promise<void> {
        const monitored = dbGetMonitoredWallets();
        if (monitored.length === 0) return;

        console.log(`🔬 [Monitor] Polling ${monitored.length} wallets... (${isBasescanAvailable() ? '🔗 Blockscout' : '🦎 GeckoTerminal'})`);

        if (isBasescanAvailable()) {
            await this.pollWithBasescan(monitored);
        } else {
            await this.pollWithGecko(monitored);
        }
    }

    // ── PRIMARY: Blockscout on-chain analysis ─────────────────────────────────

    private async pollWithBasescan(monitored: MonitoredWalletRow[]): Promise<void> {
        for (const wallet of monitored) {
            try {
                // Fetch since monitoring start — basescan-monitor handles caching lastBlock
                const result = await analyzeWalletOnChain(wallet.address, wallet.monitoredSince);

                if (result.error && result.dataSource === 'fallback') {
                    console.warn(`🔬 [Blockscout] ${wallet.address.slice(0, 10)}… error: ${result.error} — fallback ke Gecko`);
                    await this.fetchWalletTradesDirect(wallet.address.toLowerCase(), new Set([wallet.address.toLowerCase()]));
                    this.updateStatsGecko(wallet);
                    continue;
                }

                // Merge basescan data with existing DB stats (incremental)
                const existing = dbGetMonitoredWallet(wallet.address);
                if (!existing) continue;

                // Basescan returns cumulative data since monitoredSince — replace stats directly
                const monitorDays = Math.max(0.04, (Date.now() - wallet.monitoredSince) / 86_400_000);

                if (result.tradesObserved > 0 || result.tradePairs.length > 0) {
                    const newTotal  = Math.max(existing.tradesObserved, result.tradesObserved);
                    const newWins   = Math.max(existing.winsObserved,   result.winsObserved);
                    const newLosses = Math.max(existing.lossesObserved, result.lossesObserved);
                    const pairs     = newWins + newLosses;

                    // Weighted merge: Basescan data is ground truth, but keep existing if it has more pairs
                    const finalWins   = pairs > existing.winsObserved + existing.lossesObserved ? newWins : existing.winsObserved;
                    const finalLosses = pairs > existing.winsObserved + existing.lossesObserved ? newLosses : existing.lossesObserved;
                    const finalPairs  = finalWins + finalLosses;
                    const finalPnl    = finalPairs > 0 ? result.avgPnlPct : existing.totalPnlPct;
                    const finalTrades = Math.max(newTotal, existing.tradesObserved);
                    const finalTpd    = parseFloat((finalTrades / monitorDays).toFixed(2));
                    const finalLastMs = result.lastTradeMs > 0
                        ? Math.max(result.lastTradeMs, existing.lastTradeMs)
                        : existing.lastTradeMs;

                    dbUpdateMonitoredStats(wallet.address, {
                        tradesObserved: finalTrades,
                        winsObserved:   finalWins,
                        lossesObserved: finalLosses,
                        totalPnlPct:    parseFloat(finalPnl.toFixed(2)),
                        tradesPerDay:   finalTpd,
                        lastTradeMs:    finalLastMs,
                        dataSource:     'basescan',
                    });

                    console.log(
                        `🔬 [Blockscout] ${wallet.address.slice(0, 10)}… ` +
                        `${finalTrades} tx | ${finalWins}W/${finalLosses}L | ` +
                        `PnL: ${finalPnl >= 0 ? '+' : ''}${finalPnl.toFixed(1)}%`
                    );
                } else {
                    // No new txs found — update dataSource but keep existing stats
                    dbUpdateMonitoredStats(wallet.address, { dataSource: 'basescan' });
                    console.log(`🔬 [Blockscout] ${wallet.address.slice(0, 10)}… tidak ada tx baru`);
                }

                // Rate limit: 5 req/s on free tier
                await delay(250);
            } catch (err: any) {
                console.warn(`🔬 [Blockscout] Poll error ${wallet.address.slice(0, 10)}…: ${err.message}`);
                await delay(500);
            }
        }
    }

    // ── FALLBACK: GeckoTerminal pool scanning ─────────────────────────────────

    private async pollWithGecko(monitored: MonitoredWalletRow[]): Promise<void> {
        const addressSet = new Set(monitored.map(w => w.address.toLowerCase()));
        try {
            for (const wallet of monitored) {
                await this.fetchWalletTradesDirect(wallet.address.toLowerCase(), addressSet);
                await delay(300);
            }

            const pools = await getGeckoTrendingPools().catch(() => []);
            for (const pool of pools.slice(0, 30)) {
                if (!pool.pairAddress) continue;
                await this.fetchTrades(pool.pairAddress, addressSet);
                await delay(300);
            }

            await this.fetchNewPoolTrades(addressSet);

            for (const wallet of monitored) {
                this.updateStatsGecko(wallet);
            }
        } catch (err: any) {
            console.warn(`[Monitor] Gecko poll error: ${err.message}`);
        }
    }

    private async fetchWalletTradesDirect(walletAddress: string, addressSet: Set<string>): Promise<void> {
        try {
            const res = await axios.get(
                `${GECKO_BASE}/networks/base/addresses/${walletAddress}/transactions`,
                { headers: GECKO_HEADERS, params: { page: 1 }, timeout: 8000 }
            );
            for (const t of (res.data?.data ?? []) as any[]) {
                const a      = t.attributes ?? {};
                const wallet = (a.tx_from_address ?? a.from_address ?? '').toLowerCase();
                if (!wallet || !addressSet.has(wallet)) continue;

                const kind:    'buy' | 'sell' = a.kind === 'buy' ? 'buy' : 'sell';
                const priceUsd  = parseFloat(a.price_in_usd  ?? a.price_usd  ?? '0');
                const volumeUsd = parseFloat(a.volume_in_usd ?? a.volume_usd ?? '0');
                const tsMs      = a.block_timestamp ? new Date(a.block_timestamp).getTime() : Date.now();
                const poolAddr  = a.pool_address ?? a.pair_address ?? 'unknown';

                const txKey = `${wallet}-${poolAddr}-${tsMs}-${kind}`;
                if (seenTxKeys.has(txKey)) continue;
                seenTxKeys.add(txKey);

                if (!walletHistory.has(wallet)) walletHistory.set(wallet, { buys: [], sells: [] });
                const hist = walletHistory.get(wallet)!;
                const rec: TradeRecord = { walletAddress: wallet, poolAddress: poolAddr, kind, priceUsd, volumeUsd, timestampMs: tsMs };
                if (kind === 'buy') hist.buys.push(rec); else hist.sells.push(rec);
            }
        } catch { /* silent */ }
    }

    private async fetchNewPoolTrades(addressSet: Set<string>): Promise<void> {
        try {
            const res = await axios.get(`${GECKO_BASE}/networks/base/new_pools`, {
                headers: GECKO_HEADERS, params: { page: 1 }, timeout: 8000,
            });
            for (const pool of (res.data?.data ?? []).slice(0, 10)) {
                const addr = pool.attributes?.address ?? pool.id?.split('_')[1];
                if (!addr) continue;
                await this.fetchTrades(addr, addressSet);
                await delay(250);
            }
        } catch { /* silent */ }
    }

    private async fetchTrades(poolAddress: string, addressSet: Set<string>): Promise<void> {
        try {
            const res = await axios.get(`${GECKO_BASE}/networks/base/pools/${poolAddress}/trades`, {
                headers: GECKO_HEADERS,
                params:  { trade_volume_in_usd_greater_than: 10 },
                timeout: 8000,
            });
            for (const t of (res.data?.data ?? []) as any[]) {
                const a      = t.attributes ?? {};
                const wallet = (a.tx_from_address ?? '').toLowerCase();
                if (!wallet.startsWith('0x') || !addressSet.has(wallet)) continue;

                const kind:       'buy' | 'sell' = a.kind === 'buy' ? 'buy' : 'sell';
                const priceUsd    = parseFloat(a.price_in_usd  ?? '0');
                const volumeUsd   = parseFloat(a.volume_in_usd ?? '0');
                const timestampMs = a.block_timestamp ? new Date(a.block_timestamp).getTime() : Date.now();

                const txKey = `${wallet}-${poolAddress}-${timestampMs}-${kind}`;
                if (seenTxKeys.has(txKey)) continue;
                seenTxKeys.add(txKey);
                if (seenTxKeys.size > 20_000) {
                    const oldest = Array.from(seenTxKeys).slice(0, 5_000);
                    for (const key of oldest) seenTxKeys.delete(key);
                }

                if (!walletHistory.has(wallet)) walletHistory.set(wallet, { buys: [], sells: [] });
                const hist   = walletHistory.get(wallet)!;
                const record: TradeRecord = { walletAddress: wallet, poolAddress, kind, priceUsd, volumeUsd, timestampMs };
                if (kind === 'buy')  hist.buys.push(record);
                else                 hist.sells.push(record);
            }
        } catch { /* skip pool on error */ }
    }

    private updateStatsGecko(wallet: MonitoredWalletRow): void {
        const hist = walletHistory.get(wallet.address.toLowerCase());
        if (!hist || (hist.buys.length === 0 && hist.sells.length === 0)) return;

        const all         = [...hist.buys, ...hist.sells];
        const lastTradeMs = Math.max(...all.map(t => t.timestampMs));

        let wins = 0, losses = 0, totalPnlPct = 0;
        for (const sell of hist.sells) {
            const matchBuy = hist.buys
                .filter(b => b.poolAddress === sell.poolAddress && b.timestampMs < sell.timestampMs)
                .sort((a, b) => b.timestampMs - a.timestampMs)[0];

            if (matchBuy && matchBuy.priceUsd > 0 && sell.priceUsd > 0) {
                const pnl = ((sell.priceUsd - matchBuy.priceUsd) / matchBuy.priceUsd) * 100;
                totalPnlPct += pnl;
                if (pnl > 0) wins++; else losses++;
            }
        }

        const monitorDays  = Math.max(0.04, (Date.now() - wallet.monitoredSince) / 86_400_000);
        const newTotal     = wallet.tradesObserved + all.length;
        const newWins      = wallet.winsObserved   + wins;
        const newLosses    = wallet.lossesObserved + losses;
        const pairs        = newWins + newLosses;
        const avgPnl       = pairs > 0
            ? ((wallet.totalPnlPct * (wallet.winsObserved + wallet.lossesObserved) + totalPnlPct) / pairs)
            : 0;
        const tradesPerDay = parseFloat((newTotal / monitorDays).toFixed(2));

        dbUpdateMonitoredStats(wallet.address, {
            tradesObserved: newTotal,
            winsObserved:   newWins,
            lossesObserved: newLosses,
            totalPnlPct:    parseFloat(avgPnl.toFixed(2)),
            tradesPerDay,
            lastTradeMs,
            dataSource:     'gecko',
        });

        walletHistory.set(wallet.address.toLowerCase(), { buys: [], sells: [] });
        console.log(`🔬 [Gecko] ${wallet.address.slice(0, 10)}… +${all.length} trades | ${newWins}W/${newLosses}L`);
    }
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export const whaleMonitor = new WhaleMonitorService();
