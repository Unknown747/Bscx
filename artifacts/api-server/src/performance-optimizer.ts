/**
 * performance-optimizer.ts
 * Cache harga & batch API calls untuk mengurangi latency dan rate limit hits
 */

import axios from 'axios';

const CACHE_TTL_MS  = 3000;   // 3 detik — cukup untuk position monitor
const GECKO_BASE    = 'https://api.geckoterminal.com/api/v2';
const GECKO_HEADERS = { Accept: 'application/json;version=20230302' };

interface PriceEntry {
    priceUsd: number;
    priceEth: number;
    timestamp: number;
}

interface PoolEntry {
    poolAddress: string;
    liquidityUsd: number;
    timestamp: number;
}

// ── In-memory stores ──────────────────────────────────────────────────────────
const priceCache = new Map<string, PriceEntry>();
const poolCache  = new Map<string, PoolEntry>();
let ethPriceUsd  = 3000;       // updated periodically
let ethPriceAt   = 0;

// ── ETH price refresh (every 60s) ─────────────────────────────────────────────
async function refreshEthPrice(): Promise<void> {
    try {
        const res = await axios.get(
            'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
            { timeout: 5000 }
        );
        const price = res.data?.ethereum?.usd;
        if (price && price > 0) { ethPriceUsd = price; ethPriceAt = Date.now(); }
    } catch {
        // keep previous value
    }
}
refreshEthPrice();
setInterval(refreshEthPrice, 60_000);

// ── Best pool for token (cached 30s) ─────────────────────────────────────────
export async function getBestPool(tokenAddress: string): Promise<PoolEntry | null> {
    const key    = tokenAddress.toLowerCase();
    const cached = poolCache.get(key);
    if (cached && Date.now() - cached.timestamp < 30_000) return cached;

    try {
        const res = await axios.get(
            `${GECKO_BASE}/networks/base/tokens/${tokenAddress}/pools?page=1`,
            { headers: GECKO_HEADERS, timeout: 6000 }
        );
        const pools: any[] = res.data?.data ?? [];
        if (!pools.length) return null;

        const best = pools.reduce((b: any, p: any) => {
            const liq = parseFloat(p.attributes?.reserve_in_usd ?? '0');
            return liq > parseFloat(b.attributes?.reserve_in_usd ?? '0') ? p : b;
        }, pools[0]);

        const entry: PoolEntry = {
            poolAddress:  best.attributes?.address ?? '',
            liquidityUsd: parseFloat(best.attributes?.reserve_in_usd ?? '0'),
            timestamp:    Date.now(),
        };
        poolCache.set(key, entry);
        return entry;
    } catch {
        return null;
    }
}

// ── Token price (cached 3s) ───────────────────────────────────────────────────
export async function getCachedTokenPrice(tokenAddress: string): Promise<PriceEntry | null> {
    const key    = tokenAddress.toLowerCase();
    const cached = priceCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached;

    const pool = await getBestPool(tokenAddress);
    if (!pool?.poolAddress) return null;

    try {
        const res = await axios.get(
            `${GECKO_BASE}/networks/base/pools/${pool.poolAddress}`,
            { headers: GECKO_HEADERS, timeout: 6000 }
        );
        const attrs     = res.data?.data?.attributes ?? {};
        const priceUsd  = parseFloat(attrs.token_price_usd ?? '0');
        const priceEth  = ethPriceUsd > 0 ? priceUsd / ethPriceUsd : 0;
        const entry: PriceEntry = { priceUsd, priceEth, timestamp: Date.now() };
        priceCache.set(key, entry);
        return entry;
    } catch {
        return null;
    }
}

// ── Batch price fetch ─────────────────────────────────────────────────────────
export async function batchGetPrices(tokenAddresses: string[]): Promise<Map<string, PriceEntry>> {
    const result = new Map<string, PriceEntry>();
    const uncached: string[] = [];

    for (const addr of tokenAddresses) {
        const key    = addr.toLowerCase();
        const cached = priceCache.get(key);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
            result.set(key, cached);
        } else {
            uncached.push(addr);
        }
    }

    // Fetch uncached in parallel (max 5 concurrent)
    const chunks: string[][] = [];
    for (let i = 0; i < uncached.length; i += 5) chunks.push(uncached.slice(i, i + 5));

    for (const chunk of chunks) {
        await Promise.allSettled(
            chunk.map(async (addr) => {
                const entry = await getCachedTokenPrice(addr);
                if (entry) result.set(addr.toLowerCase(), entry);
            })
        );
    }

    return result;
}

// ── Sort wallets by profitability (for prioritisation) ────────────────────────
export function prioritizeWallets<T extends { address: string; winRate?: number; totalPnL?: number }>(wallets: T[], limit = 5): T[] {
    return [...wallets]
        .sort((a, b) => {
            const scoreA = (a.winRate ?? 0) * 0.6 + (a.totalPnL ?? 0) * 0.4;
            const scoreB = (b.winRate ?? 0) * 0.6 + (b.totalPnL ?? 0) * 0.4;
            return scoreB - scoreA;
        })
        .slice(0, limit);
}

// ── Clean stale entries ───────────────────────────────────────────────────────
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of priceCache) if (now - v.timestamp > 60_000) priceCache.delete(k);
    for (const [k, v] of poolCache)  if (now - v.timestamp > 120_000) poolCache.delete(k);
}, 60_000);

export function getCacheStats() {
    return {
        priceEntries: priceCache.size,
        poolEntries:  poolCache.size,
        ethPrice:     ethPriceUsd,
        ethPriceAge:  ethPriceAt ? Math.round((Date.now() - ethPriceAt) / 1000) : null,
    };
}
