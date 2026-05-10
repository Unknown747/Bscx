"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.gtCache = void 0;
exports.getEthPriceUsd = getEthPriceUsd;
exports.getGeckoPairsForToken = getGeckoPairsForToken;
exports.getBestDexPair = getBestDexPair;
exports.getDexUniV3Pairs = getDexUniV3Pairs;
exports.getDexPairs = getDexPairs;
exports.getDexPriceEth = getDexPriceEth;
exports.getDexLiquidityEth = getDexLiquidityEth;
exports.getGeckoNewPools = getGeckoNewPools;
exports.getGeckoTrendingPools = getGeckoTrendingPools;
exports.getOnChainPriceEth = getOnChainPriceEth;
exports.getTokenPriceEth = getTokenPriceEth;
const axios_1 = __importDefault(require("axios"));
// ─── Constants ───────────────────────────────────────────────────────────────
const WETH = '0x4200000000000000000000000000000000000006';
const UNI_V3_FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const FEE_TIERS = [500, 3000, 10000];
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const GT_BASE = 'https://api.geckoterminal.com/api/v2';
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';
// ─── ABIs ────────────────────────────────────────────────────────────────────
const FACTORY_ABI = [{
        name: 'getPool', type: 'function',
        inputs: [
            { name: 'tokenA', type: 'address' },
            { name: 'tokenB', type: 'address' },
            { name: 'fee', type: 'uint24' },
        ],
        outputs: [{ type: 'address' }],
        stateMutability: 'view'
    }];
const POOL_SLOT0_ABI = [{
        name: 'slot0', type: 'function',
        inputs: [],
        outputs: [
            { name: 'sqrtPriceX96', type: 'uint160' },
            { name: 'tick', type: 'int24' },
            { name: 'observationIndex', type: 'uint16' },
            { name: 'observationCardinality', type: 'uint16' },
            { name: 'observationCardinalityNext', type: 'uint16' },
            { name: 'feeProtocol', type: 'uint8' },
            { name: 'unlocked', type: 'bool' },
        ],
        stateMutability: 'view'
    }];
class GeckoTerminalCache {
    constructor() {
        this.cache = new Map();
        this.pending = new Map();
        this.lastReq = 0;
        this.TTL_MS = 6000; // 6 s TTL — GT updates every ~5 s
        this.MIN_DELAY_MS = 300; // ~3 req/s to stay within free tier
    }
    async get(path) {
        const url = `${GT_BASE}${path}`;
        const now = Date.now();
        const cached = this.cache.get(url);
        if (cached && cached.expiresAt > now)
            return cached.data;
        const inflight = this.pending.get(url);
        if (inflight)
            return inflight;
        const promise = this._doFetch(url);
        this.pending.set(url, promise);
        promise.finally(() => this.pending.delete(url));
        return promise;
    }
    async _doFetch(url, retries = 2) {
        const gap = this.lastReq + this.MIN_DELAY_MS - Date.now();
        if (gap > 0)
            await sleep(gap);
        this.lastReq = Date.now();
        try {
            const res = await axios_1.default.get(url, {
                timeout: 6000,
                headers: { 'Accept': 'application/json;version=20230302' }
            });
            this.cache.set(url, { data: res.data, expiresAt: Date.now() + this.TTL_MS });
            return res.data;
        }
        catch (err) {
            if (err?.response?.status === 429 && retries > 0) {
                await sleep(1200 * (3 - retries));
                return this._doFetch(url, retries - 1);
            }
            return null;
        }
    }
}
exports.gtCache = new GeckoTerminalCache();
// ─── ETH Price (cached 60 s, CoinGecko) ─────────────────────────────────────
let _ethCache = { value: 3000, expiresAt: 0 };
async function getEthPriceUsd() {
    if (Date.now() < _ethCache.expiresAt)
        return _ethCache.value;
    try {
        const res = await axios_1.default.get(COINGECKO_URL, { timeout: 3000 });
        const price = res.data?.ethereum?.usd || _ethCache.value;
        _ethCache = { value: price, expiresAt: Date.now() + 60000 };
        return price;
    }
    catch {
        return _ethCache.value;
    }
}
// ─── GeckoTerminal → NormalizedPair adapter ──────────────────────────────────
function adaptPoolData(gtData, included = []) {
    if (!gtData?.attributes)
        return null;
    const attr = gtData.attributes;
    // Resolve token info from "included" array (GT embeds tokens in multi-pool response)
    const relBase = gtData.relationships?.base_token?.data?.id;
    const relQuote = gtData.relationships?.quote_token?.data?.id;
    const baseInc = included.find((x) => x.id === relBase)?.attributes ?? {};
    const quoteInc = included.find((x) => x.id === relQuote)?.attributes ?? {};
    const baseAddr = baseInc.address || relBase?.split('_')[1] || '';
    const quoteAddr = quoteInc.address || relQuote?.split('_')[1] || '';
    const pairCreatedAt = attr.pool_created_at
        ? new Date(attr.pool_created_at).getTime()
        : undefined;
    // Extract Uniswap V3 fee tier — try direct attribute first, then parse pool name
    // GeckoTerminal pool names look like "TOKEN / WETH 0.05%" | "0.3%" | "1%"
    let feeTier;
    const rawFt = attr.fee_tier !== undefined ? parseInt(String(attr.fee_tier)) : NaN;
    if (rawFt === 500 || rawFt === 3000 || rawFt === 10000) {
        feeTier = rawFt;
    }
    else {
        const nameMatch = String(attr.name ?? '').match(/([\d.]+)%/);
        if (nameMatch) {
            const pct = parseFloat(nameMatch[1]);
            if (Math.abs(pct - 0.05) < 0.01)
                feeTier = 500;
            else if (Math.abs(pct - 0.3) < 0.01)
                feeTier = 3000;
            else if (Math.abs(pct - 1.0) < 0.01)
                feeTier = 10000;
        }
    }
    return {
        pairAddress: attr.address || '',
        baseToken: {
            address: baseAddr,
            name: baseInc.name || attr.name?.split(' / ')[0] || 'Unknown',
            symbol: baseInc.symbol || attr.name?.split(' / ')[0] || 'UNKNOWN',
        },
        quoteToken: {
            address: quoteAddr,
            name: quoteInc.name || 'Wrapped Ether',
            symbol: quoteInc.symbol || 'WETH',
        },
        priceUsd: String(attr.base_token_price_usd || '0'),
        priceNative: String(attr.base_token_price_native_currency || '0'),
        liquidity: { usd: parseFloat(attr.reserve_in_usd || '0') || 0 },
        volume: { h24: parseFloat(attr.volume_usd?.h24 || '0') || 0 },
        pairCreatedAt,
        chainId: 'base',
        dexId: 'uniswap_v3',
        feeTier,
    };
}
// ─── Get pools for a token address ───────────────────────────────────────────
async function getGeckoPairsForToken(tokenAddress) {
    const addr = tokenAddress.toLowerCase();
    const data = await exports.gtCache.get(`/networks/base/tokens/${addr}/pools?include=base_token,quote_token&page=1`);
    if (!data?.data || !Array.isArray(data.data))
        return [];
    const included = data.included ?? [];
    return data.data
        .map((d) => adaptPoolData(d, included))
        .filter((p) => p !== null);
}
/** Best pair (highest liquidity) for a token address. Returns null on miss. */
async function getBestDexPair(tokenAddress) {
    // Try token's pools first (most reliable)
    const pairs = await getGeckoPairsForToken(tokenAddress);
    if (pairs.length > 0) {
        return pairs.sort((a, b) => b.liquidity.usd - a.liquidity.usd)[0];
    }
    // Fallback: query the pool address directly (used when tokenAddress is actually a pool addr)
    const addr = tokenAddress.toLowerCase();
    const data = await exports.gtCache.get(`/networks/base/pools/${addr}?include=base_token,quote_token`);
    if (!data?.data)
        return null;
    return adaptPoolData(data.data, data.included ?? []);
}
/** Get all Base UniV3 pairs for a token (for fee-tier detection). */
async function getDexUniV3Pairs(tokenAddress) {
    return getGeckoPairsForToken(tokenAddress);
}
/** Legacy compatibility — returns array of normalized pairs. */
async function getDexPairs(tokenAddress) {
    return getGeckoPairsForToken(tokenAddress);
}
// ─── Price helpers ────────────────────────────────────────────────────────────
/**
 * Get token price in ETH from GeckoTerminal (cached).
 * Returns null if pair not yet indexed.
 */
async function getDexPriceEth(tokenAddress) {
    const [pair, ethPrice] = await Promise.all([
        getBestDexPair(tokenAddress),
        getEthPriceUsd(),
    ]);
    if (!pair)
        return null;
    const priceUsd = parseFloat(pair.priceUsd || '0');
    if (!priceUsd || !ethPrice)
        return null;
    return priceUsd / ethPrice;
}
/** Get pool liquidity in ETH. Returns null when not yet indexed. */
async function getDexLiquidityEth(tokenOrPoolAddress) {
    const [pair, ethPrice] = await Promise.all([
        getBestDexPair(tokenOrPoolAddress),
        getEthPriceUsd(),
    ]);
    if (!pair || !ethPrice)
        return null;
    const liqUsd = pair.liquidity.usd;
    return liqUsd > 0 ? liqUsd / ethPrice : null;
}
async function getGeckoNewPools() {
    const data = await exports.gtCache.get('/networks/base/new_pools?include=base_token,quote_token&page=1');
    if (!data?.data || !Array.isArray(data.data))
        return [];
    const included = data.included ?? [];
    const results = [];
    for (const d of data.data) {
        const pair = adaptPoolData(d, included);
        if (!pair)
            continue;
        // Only WETH-paired tokens
        const isWethPair = pair.quoteToken.symbol?.toUpperCase().includes('WETH') ||
            pair.quoteToken.address?.toLowerCase() === WETH.toLowerCase();
        if (!isWethPair && !pair.baseToken.symbol?.toUpperCase().includes('WETH'))
            continue;
        const attr = d.attributes;
        results.push({
            pairAddress: pair.pairAddress,
            tokenAddress: pair.baseToken.address,
            tokenSymbol: pair.baseToken.symbol,
            tokenName: pair.baseToken.name,
            liquidityUsd: pair.liquidity.usd,
            volumeH24: pair.volume.h24,
            priceUsd: pair.priceUsd,
            priceChangeH1: parseFloat(attr?.price_change_percentage?.h1 || '0'),
            pairCreatedAt: pair.pairCreatedAt ?? Date.now(),
            buyTxH1: attr?.transactions?.h1?.buys ?? 0,
            sellTxH1: attr?.transactions?.h1?.sells ?? 0,
            fdvUsd: parseFloat(attr?.fdv_usd || '0'),
        });
    }
    return results;
}
async function getGeckoTrendingPools() {
    const data = await exports.gtCache.get('/networks/base/trending_pools?include=base_token,quote_token&page=1');
    if (!data?.data || !Array.isArray(data.data))
        return [];
    const included = data.included ?? [];
    const results = [];
    for (const d of data.data) {
        const pair = adaptPoolData(d, included);
        if (!pair)
            continue;
        const attr = d.attributes;
        results.push({
            pairAddress: pair.pairAddress,
            tokenAddress: pair.baseToken.address,
            tokenSymbol: pair.baseToken.symbol,
            tokenName: pair.baseToken.name,
            liquidityUsd: pair.liquidity.usd,
            volumeH24: pair.volume.h24,
            priceUsd: pair.priceUsd,
            priceChangeH1: parseFloat(attr?.price_change_percentage?.h1 || '0'),
            pairCreatedAt: pair.pairCreatedAt ?? Date.now(),
            buyTxH1: attr?.transactions?.h1?.buys ?? 0,
            sellTxH1: attr?.transactions?.h1?.sells ?? 0,
            fdvUsd: parseFloat(attr?.fdv_usd || '0'),
        });
    }
    return results;
}
// ─── On-chain Price Fallback (Uniswap V3 slot0) ──────────────────────────────
async function getOnChainPriceEth(publicClient, tokenAddress, tokenDecimals) {
    try {
        for (const fee of FEE_TIERS) {
            const poolAddress = await publicClient.readContract({
                address: UNI_V3_FACTORY,
                abi: FACTORY_ABI,
                functionName: 'getPool',
                args: [tokenAddress, WETH, fee],
            });
            if (!poolAddress || poolAddress.toLowerCase() === ZERO_ADDR)
                continue;
            const slot0 = await publicClient.readContract({
                address: poolAddress,
                abi: POOL_SLOT0_ABI,
                functionName: 'slot0',
            });
            const sqrtPriceX96 = slot0[0];
            if (sqrtPriceX96 === 0n)
                continue;
            const token0IsNewToken = tokenAddress.toLowerCase() < WETH.toLowerCase();
            const sqrtPrice = Number(sqrtPriceX96) / Number(2n ** 96n);
            const rawRatio = sqrtPrice * sqrtPrice;
            let priceInWeth;
            if (token0IsNewToken) {
                priceInWeth = rawRatio * Math.pow(10, tokenDecimals - 18);
            }
            else {
                priceInWeth = Math.pow(10, tokenDecimals - 18) / rawRatio;
            }
            if (priceInWeth > 0 && isFinite(priceInWeth))
                return priceInWeth;
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * Best-effort token price in ETH.
 *   1. GeckoTerminal (cached, parallel ETH price fetch)
 *   2. On-chain slot0 fallback (works for brand-new tokens)
 */
async function getTokenPriceEth(publicClient, tokenAddress, tokenDecimals) {
    const dexPrice = await getDexPriceEth(tokenAddress);
    if (dexPrice !== null)
        return dexPrice;
    console.log(`   ⛓️  GeckoTerminal miss — reading on-chain price for ${tokenAddress.slice(0, 10)}...`);
    return getOnChainPriceEth(publicClient, tokenAddress, tokenDecimals);
}
// ─── Utilities ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
//# sourceMappingURL=price-oracle.js.map