/**
 * price-oracle.ts
 * Shared price data layer — powered by GeckoTerminal (replaces DexScreener).
 *
 * GeckoTerminal Base network:
 *   Pool info:  GET /api/v2/networks/base/pools/{address}
 *   Token info: GET /api/v2/networks/base/tokens/{address}
 *   Token pools: GET /api/v2/networks/base/tokens/{address}/pools
 *   New pools:   GET /api/v2/networks/base/new_pools
 *   Trending:    GET /api/v2/networks/base/trending_pools
 */
import { type PublicClient } from 'viem';
export interface NormalizedPair {
    pairAddress: string;
    baseToken: {
        address: string;
        name: string;
        symbol: string;
    };
    quoteToken: {
        address: string;
        name: string;
        symbol: string;
    };
    priceUsd: string;
    priceNative: string;
    liquidity: {
        usd: number;
    };
    volume: {
        h24: number;
    };
    pairCreatedAt?: number;
    chainId: string;
    dexId: string;
}
declare class GeckoTerminalCache {
    private cache;
    private pending;
    private lastReq;
    private readonly TTL_MS;
    private readonly MIN_DELAY_MS;
    get(path: string): Promise<any | null>;
    private _doFetch;
}
export declare const gtCache: GeckoTerminalCache;
export declare function getEthPriceUsd(): Promise<number>;
export declare function getGeckoPairsForToken(tokenAddress: string): Promise<NormalizedPair[]>;
/** Best pair (highest liquidity) for a token address. Returns null on miss. */
export declare function getBestDexPair(tokenAddress: string): Promise<NormalizedPair | null>;
/** Get all Base UniV3 pairs for a token (for fee-tier detection). */
export declare function getDexUniV3Pairs(tokenAddress: string): Promise<NormalizedPair[]>;
/** Legacy compatibility — returns array of normalized pairs. */
export declare function getDexPairs(tokenAddress: string): Promise<NormalizedPair[]>;
/**
 * Get token price in ETH from GeckoTerminal (cached).
 * Returns null if pair not yet indexed.
 */
export declare function getDexPriceEth(tokenAddress: string): Promise<number | null>;
/** Get pool liquidity in ETH. Returns null when not yet indexed. */
export declare function getDexLiquidityEth(tokenOrPoolAddress: string): Promise<number | null>;
export interface GeckoNewPool {
    pairAddress: string;
    tokenAddress: string;
    tokenSymbol: string;
    tokenName: string;
    liquidityUsd: number;
    volumeH24: number;
    priceUsd: string;
    priceChangeH1: number;
    pairCreatedAt: number;
    buyTxH1: number;
    sellTxH1: number;
    fdvUsd: number;
}
export declare function getGeckoNewPools(): Promise<GeckoNewPool[]>;
export declare function getGeckoTrendingPools(): Promise<GeckoNewPool[]>;
export declare function getOnChainPriceEth(publicClient: PublicClient, tokenAddress: string, tokenDecimals: number): Promise<number | null>;
/**
 * Best-effort token price in ETH.
 *   1. GeckoTerminal (cached, parallel ETH price fetch)
 *   2. On-chain slot0 fallback (works for brand-new tokens)
 */
export declare function getTokenPriceEth(publicClient: PublicClient, tokenAddress: string, tokenDecimals: number): Promise<number | null>;
export {};
//# sourceMappingURL=price-oracle.d.ts.map