"use strict";
/**
 * dynamic-exit.ts
 * Strategi exit optimal untuk modal kecil di Base Network microcap.
 *
 * FILOSOFI: "Ambil profit cepat, potong rugi lebih cepat"
 * - Microcap sering pump 30-80% lalu langsung dump — jangan tunggu 2x
 * - Setelah partial sell, modal sudah aman — biarkan sisa runner
 * - Volume collapse adalah sinyal rug paling awal — exit sebelum harga jatuh
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
async function getCachedOHLCV(tokenAddr) {
    const key = tokenAddr.toLowerCase();
    const cached = ohlcvCache.get(key);
    if (cached && cached.expiresAt > Date.now())
        return cached.candles;
    try {
        const poolsRes = await axios_1.default.get(`${GECKO_BASE}/networks/base/tokens/${tokenAddr}/pools?page=1`, { headers: GECKO_HEADERS, timeout: 5000 });
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
        const ohlcvRes = await axios_1.default.get(`${GECKO_BASE}/networks/base/pools/${poolAddress}/ohlcv/minute?aggregate=1&limit=20&currency=usd`, { headers: GECKO_HEADERS, timeout: 5000 });
        const rawList = ohlcvRes.data?.data?.attributes?.ohlcv_list ?? [];
        const candles = [...rawList].reverse().map(([ts, o, h, l, c, v]) => ({ ts: ts * 1000, o, h, l, c, v }));
        ohlcvCache.set(key, { candles, expiresAt: Date.now() + 4000 });
        return candles;
    }
    catch {
        return [];
    }
}
async function getPriceMomentum1m(tokenAddr) {
    const candles = await getCachedOHLCV(tokenAddr);
    if (candles.length < 2)
        return null;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    if (!prev.c || prev.c === 0)
        return null;
    return ((last.c - prev.c) / prev.c) * 100;
}
async function getVolumeMomentum(tokenAddr, lookback = 3) {
    const candles = await getCachedOHLCV(tokenAddr);
    if (candles.length < lookback * 2)
        return null;
    const recent = candles.slice(-lookback).reduce((s, c) => s + c.v, 0);
    const prior = candles.slice(-lookback * 2, -lookback).reduce((s, c) => s + c.v, 0);
    if (!prior)
        return null;
    return ((recent - prior) / prior) * 100;
}
// Deteksi berapa banyak red candle berturut-turut (indikasi distribusi/dump)
async function countConsecutiveRedCandles(tokenAddr) {
    const candles = await getCachedOHLCV(tokenAddr);
    if (candles.length < 2)
        return 0;
    let count = 0;
    for (let i = candles.length - 1; i >= 0; i--) {
        if (candles[i].c < candles[i].o)
            count++;
        else
            break;
    }
    return count;
}
// ── Core exit decision ────────────────────────────────────────────────────────
async function calculateExit(ctx) {
    const profitPct = ((ctx.currentValueEth - ctx.entryPriceEth) / ctx.entryPriceEth) * 100;
    const holdMins = (Date.now() - ctx.openedAt) / 60000;
    const peakDrop = ctx.peakValueEth > 0
        ? ((ctx.peakValueEth - ctx.currentValueEth) / ctx.peakValueEth) * 100
        : 0;
    // ── HARD STOP LOSS ────────────────────────────────────────────────────────
    if (profitPct <= -ctx.stopLossPct) {
        return 'SELL_ALL_PANIC';
    }
    // ── DEAD COIN EARLY EXIT (3 menit+ rugi + volume hilang) ─────────────────
    // Koin yang turun dan volumenya menghilang tidak akan recover
    if (holdMins >= 3 && profitPct < -3) {
        const volume = await getVolumeMomentum(ctx.tokenAddress);
        if (volume !== null && volume < -50)
            return 'SELL_ALL_PANIC';
    }
    // ── PANIC EXIT jika momentum berbalik setelah profit besar ───────────────
    if (profitPct > 25) {
        const [momentum, volume, redCandles] = await Promise.all([
            getPriceMomentum1m(ctx.tokenAddress),
            getVolumeMomentum(ctx.tokenAddress),
            countConsecutiveRedCandles(ctx.tokenAddress),
        ]);
        // 3+ red candle berturut = distribusi aktif → keluar semua
        if (redCandles >= 3)
            return 'SELL_ALL_PANIC';
        // Momentum sangat negatif = dump tajam → keluar semua
        if (momentum !== null && momentum < -8)
            return 'SELL_ALL_PANIC';
        // Momentum negatif + volume collapse = distribusi diam-diam → jual 50%
        if (momentum !== null && volume !== null && momentum < -3 && volume < -40) {
            return 'SELL_50_PERCENT';
        }
    }
    // ── TIERED PROFIT TAKING ──────────────────────────────────────────────────
    // Level 4: +100% → jual semua sebelum distribusi besar
    if (profitPct >= 100)
        return 'SELL_ALL_PANIC';
    // Level 3: +60% → jual 50% sisa (sudah aman, biarkan 50% runner)
    if (profitPct >= 60)
        return 'SELL_50_PERCENT';
    // Level 2: +40% → jual 40% sisa posisi
    if (profitPct >= 40)
        return 'SELL_40_PERCENT';
    // Level 1: +25% → jual 30% (ambil modal + kecil profit, biarkan runner)
    if (profitPct >= 25)
        return 'SELL_30_PERCENT';
    // ── DYNAMIC TRAILING STOP — makin profit, makin ketat ────────────────────
    if (profitPct >= ctx.trailingActivatePct) {
        let trail = ctx.trailingFromPeakPct;
        if (profitPct > 80)
            trail = Math.max(3, trail - 6); // sangat ketat setelah 80%
        else if (profitPct > 50)
            trail = Math.max(4, trail - 4);
        else if (profitPct > 30)
            trail = Math.max(5, trail - 2);
        if (peakDrop >= trail)
            return 'SELL_ALL_TRAILING';
    }
    // ── TIMEOUT: microcap yang tidak pump dalam waktu limit biasanya tidak pump
    if (holdMins >= ctx.maxHoldMinutes)
        return 'SELL_ALL_TIMEOUT';
    return 'HOLD';
}
exports.default = { calculateExit };
//# sourceMappingURL=dynamic-exit.js.map