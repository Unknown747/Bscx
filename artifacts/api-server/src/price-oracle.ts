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

import axios from 'axios';
import { type PublicClient } from 'viem';

// ─── Constants ───────────────────────────────────────────────────────────────
const WETH              = '0x4200000000000000000000000000000000000006';
const UNI_V3_FACTORY   = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const FEE_TIERS        = [500, 3000, 10000] as const;
const ZERO_ADDR        = '0x0000000000000000000000000000000000000000';
const GT_BASE          = 'https://api.geckoterminal.com/api/v2';
const COINGECKO_URL    = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';

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

// ─── Pair format (compatible with previous DexScreener callers) ────────────
export interface NormalizedPair {
    pairAddress:  string;
    baseToken:    { address: string; name: string; symbol: string };
    quoteToken:   { address: string; name: string; symbol: string };
    priceUsd:     string;
    priceNative:  string;
    liquidity:    { usd: number };
    volume:       { h24: number };
    pairCreatedAt?: number;   // ms timestamp
    chainId:      string;
    dexId:        string;
    feeTier?:     500 | 3000 | 10000;   // Uniswap V3 fee tier in basis points
}

// ─── GeckoTerminal Cache ─────────────────────────────────────────────────────
interface CacheEntry { data: any; expiresAt: number; }

class GeckoTerminalCache {
    private cache   = new Map<string, CacheEntry>();
    private pending = new Map<string, Promise<any>>();
    private lastReq = 0;

    private readonly TTL_MS       = 6_000;   // 6 s TTL — GT updates every ~5 s
    private readonly MIN_DELAY_MS = 300;     // ~3 req/s to stay within free tier

    async get(path: string): Promise<any | null> {
        const url = `${GT_BASE}${path}`;
        const now = Date.now();

        const cached = this.cache.get(url);
        if (cached && cached.expiresAt > now) return cached.data;

        const inflight = this.pending.get(url);
        if (inflight) return inflight;

        const promise = this._doFetch(url);
        this.pending.set(url, promise);
        promise.finally(() => this.pending.delete(url));
        return promise;
    }

    private async _doFetch(url: string, retries = 2): Promise<any | null> {
        const gap = this.lastReq + this.MIN_DELAY_MS - Date.now();
        if (gap > 0) await sleep(gap);
        this.lastReq = Date.now();

        try {
            const res = await axios.get(url, {
                timeout: 6_000,
                headers: { 'Accept': 'application/json;version=20230302' }
            });
            this.cache.set(url, { data: res.data, expiresAt: Date.now() + this.TTL_MS });
            return res.data;
        } catch (err: any) {
            if (err?.response?.status === 429 && retries > 0) {
                await sleep(1_200 * (3 - retries));
                return this._doFetch(url, retries - 1);
            }
            return null;
        }
    }
}

export const gtCache = new GeckoTerminalCache();

// ─── ETH Price (cached 60 s, CoinGecko) ─────────────────────────────────────
let _ethCache: { value: number; expiresAt: number } = { value: 3000, expiresAt: 0 };

export async function getEthPriceUsd(): Promise<number> {
    if (Date.now() < _ethCache.expiresAt) return _ethCache.value;
    try {
        const res   = await axios.get(COINGECKO_URL, { timeout: 3_000 });
        const price = res.data?.ethereum?.usd || _ethCache.value;
        _ethCache   = { value: price, expiresAt: Date.now() + 60_000 };
        return price;
    } catch {
        return _ethCache.value;
    }
}

// ─── GeckoTerminal → NormalizedPair adapter ──────────────────────────────────

function adaptPoolData(gtData: any, included: any[] = []): NormalizedPair | null {
    if (!gtData?.attributes) return null;
    const attr = gtData.attributes;

    // Resolve token info from "included" array (GT embeds tokens in multi-pool response)
    const relBase  = gtData.relationships?.base_token?.data?.id;
    const relQuote = gtData.relationships?.quote_token?.data?.id;
    const baseInc  = included.find((x: any) => x.id === relBase)?.attributes  ?? {};
    const quoteInc = included.find((x: any) => x.id === relQuote)?.attributes ?? {};

    const baseAddr  = baseInc.address  || relBase?.split('_')[1]  || '';
    const quoteAddr = quoteInc.address || relQuote?.split('_')[1] || '';

    const pairCreatedAt = attr.pool_created_at
        ? new Date(attr.pool_created_at).getTime()
        : undefined;

    // Extract Uniswap V3 fee tier — try direct attribute first, then parse pool name
    // GeckoTerminal pool names look like "TOKEN / WETH 0.05%" | "0.3%" | "1%"
    let feeTier: 500 | 3000 | 10000 | undefined;
    const rawFt = attr.fee_tier !== undefined ? parseInt(String(attr.fee_tier)) : NaN;
    if (rawFt === 500 || rawFt === 3000 || rawFt === 10000) {
        feeTier = rawFt;
    } else {
        const nameMatch = String(attr.name ?? '').match(/([\d.]+)%/);
        if (nameMatch) {
            const pct = parseFloat(nameMatch[1]);
            if (Math.abs(pct - 0.05) < 0.01)  feeTier = 500;
            else if (Math.abs(pct - 0.3) < 0.01) feeTier = 3000;
            else if (Math.abs(pct - 1.0) < 0.01) feeTier = 10000;
        }
    }

    return {
        pairAddress:  attr.address || '',
        baseToken: {
            address: baseAddr,
            name:    baseInc.name   || attr.name?.split(' / ')[0] || 'Unknown',
            symbol:  baseInc.symbol || attr.name?.split(' / ')[0] || 'UNKNOWN',
        },
        quoteToken: {
            address: quoteAddr,
            name:    quoteInc.name   || 'Wrapped Ether',
            symbol:  quoteInc.symbol || 'WETH',
        },
        priceUsd:    String(attr.base_token_price_usd     || '0'),
        priceNative: String(attr.base_token_price_native_currency || '0'),
        liquidity:   { usd: parseFloat(attr.reserve_in_usd || '0') || 0 },
        volume:      { h24: parseFloat(attr.volume_usd?.h24 || '0') || 0 },
        pairCreatedAt,
        chainId: 'base',
        dexId:   'uniswap_v3',
        feeTier,
    };
}

// ─── Get pools for a token address ───────────────────────────────────────────

export async function getGeckoPairsForToken(tokenAddress: string): Promise<NormalizedPair[]> {
    const addr  = tokenAddress.toLowerCase();
    const data  = await gtCache.get(`/networks/base/tokens/${addr}/pools?include=base_token,quote_token&page=1`);
    if (!data?.data || !Array.isArray(data.data)) return [];

    const included = data.included ?? [];
    return data.data
        .map((d: any) => adaptPoolData(d, included))
        .filter((p: NormalizedPair | null): p is NormalizedPair => p !== null);
}

/** Best pair (highest liquidity) for a token address. Returns null on miss. */
export async function getBestDexPair(tokenAddress: string): Promise<NormalizedPair | null> {
    // Try token's pools first (most reliable)
    const pairs = await getGeckoPairsForToken(tokenAddress);
    if (pairs.length > 0) {
        return pairs.sort((a, b) => b.liquidity.usd - a.liquidity.usd)[0];
    }

    // Fallback: query the pool address directly (used when tokenAddress is actually a pool addr)
    const addr = tokenAddress.toLowerCase();
    const data = await gtCache.get(`/networks/base/pools/${addr}?include=base_token,quote_token`);
    if (!data?.data) return null;
    return adaptPoolData(data.data, data.included ?? []);
}

/** Get all Base UniV3 pairs for a token (for fee-tier detection). */
export async function getDexUniV3Pairs(tokenAddress: string): Promise<NormalizedPair[]> {
    return getGeckoPairsForToken(tokenAddress);
}

/** Legacy compatibility — returns array of normalized pairs. */
export async function getDexPairs(tokenAddress: string): Promise<NormalizedPair[]> {
    return getGeckoPairsForToken(tokenAddress);
}

// ─── Price helpers ────────────────────────────────────────────────────────────

/**
 * Get token price in ETH from GeckoTerminal (cached).
 * Returns null if pair not yet indexed.
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

/** Get pool liquidity in ETH. Returns null when not yet indexed. */
export async function getDexLiquidityEth(tokenOrPoolAddress: string): Promise<number | null> {
    const [pair, ethPrice] = await Promise.all([
        getBestDexPair(tokenOrPoolAddress),
        getEthPriceUsd(),
    ]);
    if (!pair || !ethPrice) return null;
    const liqUsd = pair.liquidity.usd;
    return liqUsd > 0 ? liqUsd / ethPrice : null;
}

// ─── New pools from GeckoTerminal ─────────────────────────────────────────────

export interface GeckoNewPool {
    pairAddress:  string;
    tokenAddress: string;
    tokenSymbol:  string;
    tokenName:    string;
    liquidityUsd: number;
    volumeH24:    number;
    priceUsd:     string;
    priceChangeH1: number;
    pairCreatedAt: number;
    buyTxH1:      number;
    sellTxH1:     number;
    fdvUsd:       number;
}

export async function getGeckoNewPools(): Promise<GeckoNewPool[]> {
    const data = await gtCache.get('/networks/base/new_pools?include=base_token,quote_token&page=1');
    if (!data?.data || !Array.isArray(data.data)) return [];

    const included = data.included ?? [];
    const results: GeckoNewPool[] = [];

    for (const d of data.data) {
        const pair = adaptPoolData(d, included);
        if (!pair) continue;

        // Only WETH-paired tokens
        const isWethPair = pair.quoteToken.symbol?.toUpperCase().includes('WETH') ||
                           pair.quoteToken.address?.toLowerCase() === WETH.toLowerCase();
        if (!isWethPair && !pair.baseToken.symbol?.toUpperCase().includes('WETH')) continue;

        const attr = d.attributes;
        results.push({
            pairAddress:   pair.pairAddress,
            tokenAddress:  pair.baseToken.address,
            tokenSymbol:   pair.baseToken.symbol,
            tokenName:     pair.baseToken.name,
            liquidityUsd:  pair.liquidity.usd,
            volumeH24:     pair.volume.h24,
            priceUsd:      pair.priceUsd,
            priceChangeH1: parseFloat(attr?.price_change_percentage?.h1 || '0'),
            pairCreatedAt: pair.pairCreatedAt ?? Date.now(),
            buyTxH1:       attr?.transactions?.h1?.buys  ?? 0,
            sellTxH1:      attr?.transactions?.h1?.sells ?? 0,
            fdvUsd:        parseFloat(attr?.fdv_usd || '0'),
        });
    }
    return results;
}

export async function getGeckoTrendingPools(): Promise<GeckoNewPool[]> {
    const data = await gtCache.get('/networks/base/trending_pools?include=base_token,quote_token&page=1');
    if (!data?.data || !Array.isArray(data.data)) return [];

    const included = data.included ?? [];
    const results: GeckoNewPool[] = [];

    for (const d of data.data) {
        const pair = adaptPoolData(d, included);
        if (!pair) continue;

        const attr = d.attributes;
        results.push({
            pairAddress:   pair.pairAddress,
            tokenAddress:  pair.baseToken.address,
            tokenSymbol:   pair.baseToken.symbol,
            tokenName:     pair.baseToken.name,
            liquidityUsd:  pair.liquidity.usd,
            volumeH24:     pair.volume.h24,
            priceUsd:      pair.priceUsd,
            priceChangeH1: parseFloat(attr?.price_change_percentage?.h1 || '0'),
            pairCreatedAt: pair.pairCreatedAt ?? Date.now(),
            buyTxH1:       attr?.transactions?.h1?.buys  ?? 0,
            sellTxH1:      attr?.transactions?.h1?.sells ?? 0,
            fdvUsd:        parseFloat(attr?.fdv_usd || '0'),
        });
    }
    return results;
}

// ─── On-chain Price Fallback (Uniswap V3 slot0) ──────────────────────────────

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

            const token0IsNewToken = tokenAddress.toLowerCase() < WETH.toLowerCase();
            const sqrtPrice = Number(sqrtPriceX96) / Number(2n ** 96n);
            const rawRatio  = sqrtPrice * sqrtPrice;

            let priceInWeth: number;
            if (token0IsNewToken) {
                priceInWeth = rawRatio * Math.pow(10, tokenDecimals - 18);
            } else {
                priceInWeth = Math.pow(10, tokenDecimals - 18) / rawRatio;
            }

            if (priceInWeth > 0 && isFinite(priceInWeth)) return priceInWeth;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Best-effort token price in ETH.
 *   1. GeckoTerminal (cached, parallel ETH price fetch)
 *   2. On-chain slot0 fallback (works for brand-new tokens)
 */
export async function getTokenPriceEth(
    publicClient: PublicClient,
    tokenAddress: string,
    tokenDecimals: number
): Promise<number | null> {
    const dexPrice = await getDexPriceEth(tokenAddress);
    if (dexPrice !== null) return dexPrice;

    console.log(`   ⛓️  GeckoTerminal miss — reading on-chain price for ${tokenAddress.slice(0, 10)}...`);
    return getOnChainPriceEth(publicClient, tokenAddress, tokenDecimals);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
