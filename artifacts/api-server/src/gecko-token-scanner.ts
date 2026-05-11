/**
 * gecko-token-scanner.ts
 *
 * Independent token scanner powered by GeckoTerminal.
 * Scans new & trending pools on Base every 30 seconds.
 * Applies strict AI + safety filters before emitting buy signals.
 * Focused on new meme coins — primary signal source for the sniper.
 */

import { EventEmitter } from 'events';
import axios from 'axios';
import {
    getGeckoNewPools,
    getGeckoTrendingPools,
    getEthPriceUsd,
    type GeckoNewPool
} from './price-oracle';

export interface TokenOpportunity {
    tokenAddress:  string;
    tokenSymbol:   string;
    tokenName:     string;
    pairAddress:   string;
    liquidityUsd:  number;
    liquidityEth:  number;
    volumeH24:     number;
    priceUsd:      string;
    priceChangeH1: number;
    fdvUsd:        number;
    buyTxH1:       number;
    sellTxH1:      number;
    ageMinutes:    number;
    safetyScore:   number;
    source:        'new_pool' | 'trending';
    discoveredAt:  number;
}

export interface ScannerConfig {
    minLiquidityUsd:  number;
    maxLiquidityUsd:  number;
    minVolumeH24:     number;
    maxAgeMinutes:    number;
    minBuyTxH1:       number;
    maxBuySellRatio:  number;   // max sells/buys ratio (high sell pressure = bad)
    minPriceChangeH1: number;   // % (looking for upward momentum)
    maxPriceChangeH1: number;   // % (avoid pump-and-dump)
    minFdvUsd:        number;
    maxFdvUsd:        number;
    scanIntervalMs:   number;
}

export class GeckoTokenScanner extends EventEmitter {
    private scanInterval: NodeJS.Timeout | null = null;
    private pruneInterval: NodeJS.Timeout | null = null;
    private seenTokens   = new Set<string>();
    private seenTokenTs  = new Map<string, number>(); // addr → discoveredAt ms
    private isScanning   = false;
    private lastNewPoolScan    = 0;
    private lastTrendingScan   = 0;
    private readonly NEW_POOL_INTERVAL_MS    = 30_000;  // every 30s
    private readonly TRENDING_INTERVAL_MS    = 120_000; // every 2 min
    private readonly SEEN_TOKEN_TTL_MS       = 6 * 60 * 60 * 1000; // prune after 6h
    private readonly PRUNE_INTERVAL_MS       = 60 * 60 * 1000;     // prune every 1h

    private config: ScannerConfig = {
        minLiquidityUsd:  3_000,    // $3k min liquidity
        maxLiquidityUsd:  500_000,  // $500k max (avoid whale tanks)
        minVolumeH24:     500,      // $500 min daily volume
        maxAgeMinutes:    120,      // max 2 hours old for new pool
        minBuyTxH1:       5,        // at least 5 buy txs in last hour
        maxBuySellRatio:  3.0,      // sells can't be 3x more than buys
        minPriceChangeH1: -10,      // not crashing more than 10%
        maxPriceChangeH1: 200,      // not a >200% pump (likely dump incoming)
        minFdvUsd:        10_000,   // FDV $10k min
        maxFdvUsd:        10_000_000, // FDV $10M max
        scanIntervalMs:   15_000,   // check every 15 seconds
    };

    constructor(configOverrides?: Partial<ScannerConfig>) {
        super();
        if (configOverrides) {
            this.config = { ...this.config, ...configOverrides };
        }
    }

    start(): void {
        if (this.scanInterval) return;
        console.log('\n🦎 [GeckoScanner] Token scanner ACTIVE');
        console.log(`   Min liq: $${this.config.minLiquidityUsd.toLocaleString()}`);
        console.log(`   Max age: ${this.config.maxAgeMinutes} min`);

        this.scanInterval = setInterval(() => {
            this.scan().catch(console.error);
        }, this.config.scanIntervalMs);

        // Prune seenTokens periodically to prevent memory leak
        this.pruneInterval = setInterval(() => this.pruneSeenTokens(), this.PRUNE_INTERVAL_MS);
    }

    stop(): void {
        if (this.scanInterval) {
            clearInterval(this.scanInterval);
            this.scanInterval = null;
        }
        if (this.pruneInterval) {
            clearInterval(this.pruneInterval);
            this.pruneInterval = null;
        }
        console.log('🛑 [GeckoScanner] Token scanner stopped');
    }

    private pruneSeenTokens(): void {
        const cutoff = Date.now() - this.SEEN_TOKEN_TTL_MS;
        let pruned = 0;
        for (const [addr, ts] of this.seenTokenTs) {
            if (ts < cutoff) {
                this.seenTokens.delete(addr);
                this.seenTokenTs.delete(addr);
                pruned++;
            }
        }
        if (pruned > 0) console.log(`🦎 [GeckoScanner] Pruned ${pruned} stale tokens (${this.seenTokens.size} remaining)`);
    }

    updateConfig(updates: Partial<ScannerConfig>): void {
        this.config = { ...this.config, ...updates };
    }

    private async scan(): Promise<void> {
        if (this.isScanning) return;
        this.isScanning = true;

        try {
            const now = Date.now();
            const pools: GeckoNewPool[] = [];

            // New pools scan
            if (now - this.lastNewPoolScan > this.NEW_POOL_INTERVAL_MS) {
                this.lastNewPoolScan = now;
                const newPools = await getGeckoNewPools();
                pools.push(...newPools.map(p => ({ ...p, source: 'new_pool' as const })));
            }

            // Trending pools scan
            if (now - this.lastTrendingScan > this.TRENDING_INTERVAL_MS) {
                this.lastTrendingScan = now;
                const trending = await getGeckoTrendingPools();
                pools.push(...trending.map(p => ({ ...p, source: 'trending' as const })));
            }

            const ethPrice = await getEthPriceUsd();

            for (const pool of pools) {
                await this.processPool(pool, ethPrice);
            }
        } catch (err: any) {
            // Silent fail
        } finally {
            this.isScanning = false;
        }
    }

    private async processPool(pool: GeckoNewPool & { source?: string }, ethPrice: number): Promise<void> {
        const addr = pool.tokenAddress?.toLowerCase();
        if (!addr || !addr.startsWith('0x')) return;
        if (this.seenTokens.has(addr)) return;

        const source: 'new_pool' | 'trending' = (pool as any).source ?? 'new_pool';
        const ageMinutes = (Date.now() - pool.pairCreatedAt) / 60_000;

        // ── Filters ──
        if (pool.liquidityUsd < this.config.minLiquidityUsd)  return;
        if (pool.liquidityUsd > this.config.maxLiquidityUsd)  return;
        if (pool.volumeH24    < this.config.minVolumeH24)     return;
        if (source === 'new_pool' && ageMinutes > this.config.maxAgeMinutes) return;
        if (pool.buyTxH1      < this.config.minBuyTxH1)       return;
        if (pool.fdvUsd > 0   && pool.fdvUsd < this.config.minFdvUsd)   return;
        if (pool.fdvUsd > 0   && pool.fdvUsd > this.config.maxFdvUsd)   return;
        if (pool.priceChangeH1 < this.config.minPriceChangeH1) return;
        if (pool.priceChangeH1 > this.config.maxPriceChangeH1) return;

        // Buy/sell ratio check
        if (pool.sellTxH1 > 0) {
            const bsRatio = pool.sellTxH1 / Math.max(1, pool.buyTxH1);
            if (bsRatio > this.config.maxBuySellRatio) return;
        }

        // Mark as seen immediately (with timestamp for TTL pruning)
        this.seenTokens.add(addr);
        this.seenTokenTs.set(addr, Date.now());

        // Safety check (GoPlus)
        const safety = await this.checkSafety(addr);
        if (!safety.safe) {
            console.log(`   🛡️ [GeckoScanner] ${pool.tokenSymbol} UNSAFE: ${safety.reason}`);
            return;
        }

        const liquidityEth = ethPrice > 0 ? pool.liquidityUsd / ethPrice : 0;

        const opportunity: TokenOpportunity = {
            tokenAddress:  addr,
            tokenSymbol:   pool.tokenSymbol   || 'UNKNOWN',
            tokenName:     pool.tokenName     || 'Unknown Token',
            pairAddress:   pool.pairAddress   || '',
            liquidityUsd:  pool.liquidityUsd,
            liquidityEth,
            volumeH24:     pool.volumeH24,
            priceUsd:      pool.priceUsd,
            priceChangeH1: pool.priceChangeH1,
            fdvUsd:        pool.fdvUsd,
            buyTxH1:       pool.buyTxH1,
            sellTxH1:      pool.sellTxH1,
            ageMinutes:    Math.round(ageMinutes),
            safetyScore:   safety.score,
            source,
            discoveredAt:  Date.now(),
        };

        console.log(`\n🦎 [GeckoScanner] Token opportunity!`);
        console.log(`   🪙 ${opportunity.tokenSymbol} (${source})`);
        console.log(`   💧 Liq: $${opportunity.liquidityUsd.toLocaleString()} | Vol24h: $${opportunity.volumeH24.toLocaleString()}`);
        console.log(`   📈 Price change 1h: ${opportunity.priceChangeH1 >= 0 ? '+' : ''}${opportunity.priceChangeH1.toFixed(1)}%`);
        console.log(`   🛡️ Safety: ${opportunity.safetyScore}/100`);

        this.emit('token-opportunity', opportunity);
    }

    private async checkSafety(tokenAddress: string): Promise<{ safe: boolean; reason?: string; score: number }> {
        try {
            const res = await axios.get(
                `https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${tokenAddress}`,
                { timeout: 6000 }
            );
            const data = res.data?.result?.[tokenAddress.toLowerCase()];
            if (!data) return { safe: false, reason: 'Token tidak ditemukan di GoPlus — belum terverifikasi', score: 0 };

            const sellTax    = parseFloat(data.sell_tax  || '0');
            const buyTax     = parseFloat(data.buy_tax   || '0');
            const creatorPct = parseFloat(data.creator_percent || '0') * 100;
            const holders    = parseInt(data.holder_count || '0');

            if (data.is_honeypot === '1')   return { safe: false, reason: 'Honeypot', score: 0 };
            if (sellTax > 10)               return { safe: false, reason: `Sell tax ${sellTax}%`, score: 0 };
            if (buyTax > 10)                return { safe: false, reason: `Buy tax ${buyTax}%`, score: 0 };
            if (creatorPct > 20)            return { safe: false, reason: `Creator ${creatorPct.toFixed(0)}%`, score: 0 };

            let score = 100;
            if (data.is_mintable === '1') score -= 20;
            if (creatorPct > 15)          score -= 15;
            if (sellTax > 5)              score -= sellTax;
            if (buyTax  > 5)              score -= buyTax;
            if (holders < 20 && holders > 0) score -= 15;
            score = Math.max(0, Math.min(100, score));

            return { safe: score >= 50, score };
        } catch {
            return { safe: false, reason: 'GoPlus tidak tersedia — skip demi keamanan', score: 0 };
        }
    }

    getSeenCount(): number {
        return this.seenTokens.size;
    }
}

export default GeckoTokenScanner;
