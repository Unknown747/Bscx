/**
 * whale-monitor.ts
 *
 * Monitors "approved-for-monitoring" whale wallets.
 * Polls GeckoTerminal every 10 minutes for trade activity,
 * tracks win/loss statistics, and prepares data for AI evaluation.
 */

import axios from 'axios';
import {
    dbGetMonitoredWallets, dbUpdateMonitoredStats,
    type MonitoredWalletRow,
} from './db';
import { getGeckoTrendingPools } from './price-oracle';

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
        console.log('🔬 WhaleMonitorService started — polling every 10 min');
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

        const addressSet = new Set(monitored.map(w => w.address.toLowerCase()));
        console.log(`🔬 [Monitor] Polling ${monitored.length} wallets...`);

        try {
            // Strategy 1: Try direct per-wallet trade lookup via GeckoTerminal
            for (const wallet of monitored) {
                await this.fetchWalletTradesDirect(wallet.address.toLowerCase(), addressSet);
                await delay(300);
            }

            // Strategy 2: Scan top trending pools (broader net — top 30)
            const pools = await getGeckoTrendingPools().catch(() => []);
            const top   = pools.slice(0, 30);

            for (const pool of top) {
                if (!pool.pairAddress) continue;
                await this.fetchTrades(pool.pairAddress, addressSet);
                await delay(300);
            }

            // Strategy 3: Also scan recent new pools (whales often trade new launches)
            await this.fetchNewPoolTrades(addressSet);

            for (const wallet of monitored) {
                this.updateStats(wallet);
            }
        } catch (err: any) {
            console.warn(`[Monitor] Poll error: ${err.message}`);
        }
    }

    // Attempt direct lookup of a wallet's recent trades via GeckoTerminal
    private async fetchWalletTradesDirect(walletAddress: string, addressSet: Set<string>): Promise<void> {
        try {
            // GeckoTerminal doesn't have a wallet endpoint, but we can query
            // its trades with address filter across Base network
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
        } catch { /* endpoint may not exist — silent */ }
    }

    // Scan recently created Base pools where whales often trade early
    private async fetchNewPoolTrades(addressSet: Set<string>): Promise<void> {
        try {
            const res = await axios.get(`${GECKO_BASE}/networks/base/new_pools`, {
                headers: GECKO_HEADERS,
                params:  { page: 1 },
                timeout: 8000,
            });
            const pools: any[] = res.data?.data ?? [];
            for (const pool of pools.slice(0, 10)) {
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

    private updateStats(wallet: MonitoredWalletRow): void {
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
        });

        walletHistory.set(wallet.address.toLowerCase(), { buys: [], sells: [] });
        console.log(`🔬 [Monitor] ${wallet.address.slice(0, 10)}… +${all.length} trades | ${newWins}W/${newLosses}L`);
    }
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export const whaleMonitor = new WhaleMonitorService();
