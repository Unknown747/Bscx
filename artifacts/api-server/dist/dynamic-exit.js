"use strict";
/**
 * dynamic-exit.ts
 * Strategi exit dinamis berbasis momentum harga & volume
 * Menggunakan OHLCV dari GeckoTerminal untuk deteksi reversal
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateExit = calculateExit;
const axios_1 = __importDefault(require("axios"));
const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';
const GECKO_HEADERS = { Accept: 'application/json;version=20230302' };
// ── OHLCV Cache ───────────────────────────────────────────────────────────────
const ohlcvCache = new Map();
async function getCachedOHLCV(tokenAddress) {
    const key = tokenAddress.toLowerCase();
    const cached = ohlcvCache.get(key);
    if (cached && cached.expiresAt > Date.now())
        return cached.candles;
    try {
        const poolsRes = await axios_1.default.get(`${GECKO_BASE}/networks/base/tokens/${tokenAddress}/pools?page=1`, { headers: GECKO_HEADERS, timeout: 6000 });
        const pools = poolsRes.data?.data ?? [];
        if (!pools.length)
            return [];
        const bestPool = pools.reduce((best, p) => {
            const liq = parseFloat(p.attributes?.reserve_in_usd ?? '0');
            return liq > parseFloat(best.attributes?.reserve_in_usd ?? '0') ? p : best;
        }, pools[0]);
        const poolAddress = bestPool.attributes?.address;
        if (!poolAddress)
            return [];
        const ohlcvRes = await axios_1.default.get(`${GECKO_BASE}/networks/base/pools/${poolAddress}/ohlcv/minute?aggregate=1&limit=20&currency=usd`, { headers: GECKO_HEADERS, timeout: 6000 });
        const rawList = ohlcvRes.data?.data?.attributes?.ohlcv_list ?? [];
        const candles = [...rawList].reverse().map(([ts, o, h, l, c, v]) => ({ ts: ts * 1000, o, h, l, c, v }));
        ohlcvCache.set(key, { candles, expiresAt: Date.now() + 4000 });
        return candles;
    }
    catch {
        return [];
    }
}
// ── 1-minute price momentum (%) ───────────────────────────────────────────────
async function getPriceMomentum1m(tokenAddress) {
    const candles = await getCachedOHLCV(tokenAddress);
    if (candles.length < 2)
        return null;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    if (!prev.c || prev.c === 0)
        return null;
    return ((last.c - prev.c) / prev.c) * 100;
}
// ── Volume momentum vs prior period ──────────────────────────────────────────
async function getVolumeMomentum(tokenAddress, lookback = 3) {
    const candles = await getCachedOHLCV(tokenAddress);
    if (candles.length < lookback * 2)
        return null;
    const recent = candles.slice(-lookback).reduce((s, c) => s + c.v, 0);
    const prior = candles.slice(-lookback * 2, -lookback).reduce((s, c) => s + c.v, 0);
    if (!prior)
        return null;
    return ((recent - prior) / prior) * 100;
}
// ── Core exit decision ────────────────────────────────────────────────────────
async function calculateExit(ctx) {
    const profitPct = ((ctx.currentValueEth - ctx.entryPriceEth) / ctx.entryPriceEth) * 100;
    const holdMins = (Date.now() - ctx.openedAt) / 60000;
    const peakDrop = ctx.peakValueEth > 0
        ? ((ctx.peakValueEth - ctx.currentValueEth) / ctx.peakValueEth) * 100
        : 0;
    // ── Hard stop loss ────────────────────────────────────────────────────────
    if (profitPct <= -ctx.stopLossPct) {
        return 'SELL_ALL_PANIC';
    }
    // ── Panic sell on big profit with reversal ────────────────────────────────
    if (profitPct > 30) {
        const momentum = await getPriceMomentum1m(ctx.tokenAddress);
        const volume = await getVolumeMomentum(ctx.tokenAddress);
        if (momentum !== null && momentum < -5)
            return 'SELL_ALL_PANIC';
        if (momentum !== null && volume !== null && momentum < -2 && volume < -30)
            return 'SELL_50_PERCENT';
    }
    // ── Scaling out (tiered) ──────────────────────────────────────────────────
    if (profitPct >= 150)
        return 'SELL_ALL_PANIC';
    if (profitPct >= 80)
        return 'SELL_50_PERCENT';
    if (profitPct >= 40)
        return 'SELL_25_PERCENT';
    // ── Dynamic trailing stop ─────────────────────────────────────────────────
    if (profitPct >= ctx.trailingActivatePct) {
        // Tighten trail as profit grows
        let trail = ctx.trailingFromPeakPct;
        if (profitPct > 50)
            trail = Math.max(5, trail - 4);
        else if (profitPct > 20)
            trail = Math.max(8, trail - 2);
        if (peakDrop >= trail)
            return 'SELL_ALL_TRAILING';
    }
    // ── Timeout exit ──────────────────────────────────────────────────────────
    if (holdMins >= ctx.maxHoldMinutes && profitPct > 0)
        return 'SELL_ALL_TIMEOUT';
    return 'HOLD';
}
exports.default = { calculateExit };
//# sourceMappingURL=dynamic-exit.js.map