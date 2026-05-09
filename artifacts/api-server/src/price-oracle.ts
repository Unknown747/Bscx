/**
 * price-oracle.ts
 * Shared price data layer for all modules.
 *
 * Fixes 3 DexScreener problems:
 *  1. Rate limiting  — in-memory cache (5s TTL) + request deduplication + 429 backoff
 *  2. Latency        — ETH price & token price fetched in parallel via Promise.all
 *  3. New tokens     — on-chain fallback via Uniswap V3 Factory + pool slot0
 */

import axios from 'axios';
import { type PublicClient } from 'viem';

// ─── Constants ───────────────────────────────────────────────────────────────
const WETH              = '0x4200000000000000000000000000000000000006';
const UNI_V3_FACTORY    = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const FEE_TIERS         = [500, 3000, 10000] as const;
const ZERO_ADDR         = '0x0000000000000000000000000000000000000000';
const DEX_BASE_URL      = 'https://api.dexscreener.com/latest/dex/search?q=';
const COINGECKO_URL     = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';

// ─── ABIs ────────────────────────────────────────────────────────────────────
const FACTORY_ABI = [{
    name: 'getPool', type: 'function',
    inputs: [
        { name: 'tokenA', type: 'address' },
        { name: 'tokenB', type: 'address' },
        { name: 'fee',    type: 'uint24'  },
    ],
    outputs: [{ type: 'address' }],
    stateMutability: 'view'
}] as const;

const POOL_SLOT0_ABI = [{
    name: 'slot0', type: 'function',
    inputs: [],
    outputs: [
        { name: 'sqrtPriceX96',             type: 'uint160' },
        { name: 'tick',                      type: 'int24'   },
        { name: 'observationIndex',          type: 'uint16'  },
        { name: 'observationCardinality',    type: 'uint16'  },
        { name: 'observationCardinalityNext',type: 'uint16'  },
        { name: 'feeProtocol',               type: 'uint8'   },
        { name: 'unlocked',                  type: 'bool'    },
    ],
    stateMutability: 'view'
}] as const;

// ─── DexScreener Cache ────────────────────────────────────────────────────────
interface CacheEntry { data: any; expiresAt: number; }

class DexScreenerCache {
    private cache   = new Map<string, CacheEntry>();
    private pending = new Map<string, Promise<any>>();
    private lastReq = 0;

    private readonly TTL_MS       = 5_000;  // reuse response for 5 s
    private readonly MIN_DELAY_MS = 250;    // max ~4 req/s to avoid rate limit

    async fetch(query: string): Promise<any | null> {
        const url = DEX_BASE_URL + query;
        const now = Date.now();

        // 1. Cache hit
        const cached = this.cache.get(url);
        if (cached && cached.expiresAt > now) return cached.data;

        // 2. Deduplicate in-flight requests for same URL
        const inflight = this.pending.get(url);
        if (inflight) return inflight;

        const promise = this._doFetch(url);
        this.pending.set(url, promise);
        promise.finally(() => this.pending.delete(url));
        return promise;
    }

    private async _doFetch(url: string, retries = 2): Promise<any | null> {
        // Rate limiting
        const gap = this.lastReq + this.MIN_DELAY_MS - Date.now();
        if (gap > 0) await sleep(gap);
        this.lastReq = Date.now();

        try {
            const res = await axios.get(url, { timeout: 5_000 });
            this.cache.set(url, { data: res.data, expiresAt: Date.now() + this.TTL_MS });
            return res.data;
        } catch (err: any) {
            if (err?.response?.status === 429 && retries > 0) {
                // Exponential backoff on rate-limit
                await sleep(1_000 * (3 - retries));
                return this._doFetch(url, retries - 1);
            }
            return null;
        }
    }
}

export const dexCache = new DexScreenerCache();

// ─── ETH Price (cached 60 s) ──────────────────────────────────────────────────
let _ethCache: { value: number; expiresAt: number } = { value: 3000, expiresAt: 0 };

export async function getEthPriceUsd(): Promise<number> {
    if (Date.now() < _ethCache.expiresAt) return _ethCache.value;
    try {
        const res   = await axios.get(COINGECKO_URL, { timeout: 3_000 });
        const price = res.data?.ethereum?.usd || _ethCache.value;
        _ethCache   = { value: price, expiresAt: Date.now() + 60_000 };
        return price;
    } catch {
        return _ethCache.value;     // return last known value on failure
    }
}

// ─── DexScreener helpers ──────────────────────────────────────────────────────

/** Fetch all pairs for a token/pool address. Returns [] on miss. */
export async function getDexPairs(query: string): Promise<any[]> {
    const data = await dexCache.fetch(query);
    return data?.pairs ?? [];
}

/** Best pair (first result) for a query. Returns null on miss. */
export async function getBestDexPair(query: string): Promise<any | null> {
    const pairs = await getDexPairs(query);
    return pairs[0] ?? null;
}

/**
 * Get token price in ETH from DexScreener (cached).
 * Returns null if pair not yet indexed.
 * ETH price is fetched in parallel to minimise latency.
 */
export async function getDexPriceEth(tokenAddress: string): Promise<number | null> {
    const [pair, ethPrice] = await Promise.all([
        getBestDexPair(tokenAddress),
        getEthPriceUsd(),
    ]);
    if (!pair) return null;
    const priceUsd = parseFloat(pair.priceUsd || '0');
    if (!priceUsd || !ethPrice) return null;
    return priceUsd / ethPrice;
}

/**
 * Get pool liquidity in ETH from DexScreener.
 * Returns null when not yet indexed.
 */
export async function getDexLiquidityEth(query: string): Promise<number | null> {
    const [pair, ethPrice] = await Promise.all([
        getBestDexPair(query),
        getEthPriceUsd(),
    ]);
    if (!pair || !ethPrice) return null;
    const liqUsd = parseFloat(pair.liquidity?.usd || '0');
    return liqUsd > 0 ? liqUsd / ethPrice : null;
}

/**
 * Get ALL Uniswap-V3 pairs on Base for a token (for fee-tier detection).
 */
export async function getDexUniV3Pairs(tokenAddress: string): Promise<any[]> {
    const pairs = await getDexPairs(tokenAddress);
    return pairs.filter(
        (p: any) => p.chainId === 'base' && p.dexId?.toLowerCase().includes('uniswap')
    );
}

// ─── On-chain Price Fallback ──────────────────────────────────────────────────

/**
 * Read the current price of `tokenAddress` (in ETH) directly from the
 * Uniswap V3 pool's slot0 — works immediately after pool creation,
 * before DexScreener has indexed the pair.
 *
 * @param publicClient  viem PublicClient
 * @param tokenAddress  address of the new token
 * @param tokenDecimals decimals of the new token (usually 18)
 * @returns price in ETH, or null if no pool found
 */
export async function getOnChainPriceEth(
    publicClient: PublicClient,
    tokenAddress: string,
    tokenDecimals: number
): Promise<number | null> {
    try {
        for (const fee of FEE_TIERS) {
            const poolAddress = await publicClient.readContract({
                address:      UNI_V3_FACTORY as `0x${string}`,
                abi:          FACTORY_ABI,
                functionName: 'getPool',
                args: [tokenAddress as `0x${string}`, WETH as `0x${string}`, fee],
            }) as string;

            if (!poolAddress || poolAddress.toLowerCase() === ZERO_ADDR) continue;

            const slot0 = await publicClient.readContract({
                address:      poolAddress as `0x${string}`,
                abi:          POOL_SLOT0_ABI,
                functionName: 'slot0',
            }) as [bigint, number, number, number, number, number, boolean];

            const sqrtPriceX96 = slot0[0];
            if (sqrtPriceX96 === 0n) continue;

            // sqrtPriceX96 = sqrt(token1 / token0) * 2^96  (in raw units)
            // token0 is whichever address sorts lower
            const token0IsNewToken = tokenAddress.toLowerCase() < WETH.toLowerCase();

            // Use Number division — acceptable precision for price monitoring
            const sqrtPrice = Number(sqrtPriceX96) / Number(2n ** 96n);
            const rawRatio  = sqrtPrice * sqrtPrice; // token1_raw / token0_raw

            let priceInWeth: number;
            if (token0IsNewToken) {
                // rawRatio = WETH_raw / newToken_raw
                // 1 newToken_human = rawRatio * 10^(decimals-18) WETH
                priceInWeth = rawRatio * Math.pow(10, tokenDecimals - 18);
            } else {
                // rawRatio = newToken_raw / WETH_raw
                // 1 newToken_human = 10^(decimals-18) / rawRatio WETH
                priceInWeth = Math.pow(10, tokenDecimals - 18) / rawRatio;
            }

            if (priceInWeth > 0 && isFinite(priceInWeth)) {
                return priceInWeth;
            }
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Best-effort token price in ETH.
 * Strategy:
 *   1. DexScreener (cached, parallel ETH price fetch)
 *   2. On-chain slot0 fallback (works for brand-new tokens)
 */
export async function getTokenPriceEth(
    publicClient: PublicClient,
    tokenAddress: string,
    tokenDecimals: number
): Promise<number | null> {
    // Try DexScreener first (fast, cached)
    const dexPrice = await getDexPriceEth(tokenAddress);
    if (dexPrice !== null) return dexPrice;

    // DexScreener hasn't indexed yet — fall back to on-chain
    console.log(`   ⛓️  DexScreener miss — reading on-chain price for ${tokenAddress.slice(0,10)}...`);
    return getOnChainPriceEth(publicClient, tokenAddress, tokenDecimals);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
