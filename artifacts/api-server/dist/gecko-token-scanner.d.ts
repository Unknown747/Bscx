/**
 * gecko-token-scanner.ts
 *
 * Independent token scanner powered by GeckoTerminal.
 * Scans new & trending pools on Base every 30 seconds.
 * Applies strict AI + safety filters before emitting buy signals.
 * Works independently from copy trading — dual income stream.
 */
import { EventEmitter } from 'events';
export interface TokenOpportunity {
    tokenAddress: string;
    tokenSymbol: string;
    tokenName: string;
    pairAddress: string;
    liquidityUsd: number;
    liquidityEth: number;
    volumeH24: number;
    priceUsd: string;
    priceChangeH1: number;
    fdvUsd: number;
    buyTxH1: number;
    sellTxH1: number;
    ageMinutes: number;
    safetyScore: number;
    source: 'new_pool' | 'trending';
    discoveredAt: number;
}
export interface ScannerConfig {
    minLiquidityUsd: number;
    maxLiquidityUsd: number;
    minVolumeH24: number;
    maxAgeMinutes: number;
    minBuyTxH1: number;
    maxBuySellRatio: number;
    minPriceChangeH1: number;
    maxPriceChangeH1: number;
    minFdvUsd: number;
    maxFdvUsd: number;
    scanIntervalMs: number;
}
export declare class GeckoTokenScanner extends EventEmitter {
    private scanInterval;
    private pruneInterval;
    private seenTokens;
    private seenTokenTs;
    private isScanning;
    private lastNewPoolScan;
    private lastTrendingScan;
    private readonly NEW_POOL_INTERVAL_MS;
    private readonly TRENDING_INTERVAL_MS;
    private readonly SEEN_TOKEN_TTL_MS;
    private readonly PRUNE_INTERVAL_MS;
    private config;
    constructor(configOverrides?: Partial<ScannerConfig>);
    start(): void;
    stop(): void;
    private pruneSeenTokens;
    updateConfig(updates: Partial<ScannerConfig>): void;
    private scan;
    private processPool;
    private checkSafety;
    getSeenCount(): number;
}
export default GeckoTokenScanner;
//# sourceMappingURL=gecko-token-scanner.d.ts.map