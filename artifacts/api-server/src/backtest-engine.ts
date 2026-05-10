/**
 * backtest-engine.ts — Historical Backtest Mode
 * Replay data OHLCV GeckoTerminal untuk simulasi strategi TP/SL.
 * Mendukung: profit ladder TP, trailing stop, fixed stop loss.
 */

import axios from 'axios';

const GECKO_BASE    = 'https://api.geckoterminal.com/api/v2';
const GECKO_HEADERS = { Accept: 'application/json;version=20230302' };

export interface BacktestConfig {
    tp1Multiplier:       number;  // e.g. 1.5
    tp1Percentage:       number;  // e.g. 30 (sell 30% at TP1)
    tp2Multiplier:       number;  // e.g. 2.5
    tp2Percentage:       number;  // e.g. 30 (sell 30% at TP2)
    stopLossPct:         number;  // e.g. 20 (exit if -20%)
    trailingActivatePct: number;  // e.g. 50 (activate trail after +50%)
    trailingFromPeakPct: number;  // e.g. 15 (trail 15% from peak)
    maxHoldCandles:      number;  // e.g. 30 (30 candles timeout)
    liquidityDropExit:   number;  // e.g. 50 (exit if liquidity drops 50%)
}

export interface BacktestTrade {
    entryIndex:   number;
    entryPrice:   number;
    exitPrice:    number;
    profitPct:    number;
    holdCandles:  number;
    exitReason:   'TP1' | 'TP2' | 'TrailingTP3' | 'StopLoss' | 'Timeout';
    tp1Hit:       boolean;
    tp2Hit:       boolean;
}

export interface BacktestResult {
    tokenAddress: string;
    poolAddress:  string;
    timeframe:    string;
    totalTrades:  number;
    wins:         number;
    losses:       number;
    winRate:      number;
    avgProfit:    number;
    totalReturn:  number;
    maxDrawdown:  number;
    bestTrade:    number;
    worstTrade:   number;
    sharpe:       number;
    trades:       BacktestTrade[];
    config:       BacktestConfig;
    candleCount:  number;
    note:         string;
}

const DEFAULT_CONFIG: BacktestConfig = {
    tp1Multiplier:       1.5,
    tp1Percentage:       30,
    tp2Multiplier:       2.5,
    tp2Percentage:       30,
    stopLossPct:         20,
    trailingActivatePct: 50,
    trailingFromPeakPct: 15,
    maxHoldCandles:      30,
    liquidityDropExit:   50,
};

async function getBestPool(tokenAddress: string): Promise<string | null> {
    try {
        const res = await axios.get(
            `${GECKO_BASE}/networks/base/tokens/${tokenAddress}/pools?page=1`,
            { headers: GECKO_HEADERS, timeout: 8000 },
        );
        const pools: any[] = res.data?.data ?? [];
        if (!pools.length) return null;
        const best = pools.reduce((a: any, b: any) =>
            parseFloat(b.attributes?.reserve_in_usd ?? '0') >
            parseFloat(a.attributes?.reserve_in_usd ?? '0') ? b : a, pools[0]);
        return best.attributes?.address ?? null;
    } catch {
        return null;
    }
}

async function fetchOHLCV(poolAddress: string, timeframe: '1h' | '15m' = '1h', limit = 168): Promise<any[]> {
    try {
        const aggregate = timeframe === '1h' ? 60 : 15;
        const resolution = timeframe === '1h' ? 'hour' : 'minute';
        const res = await axios.get(
            `${GECKO_BASE}/networks/base/pools/${poolAddress}/ohlcv/${resolution}?aggregate=${aggregate}&limit=${limit}&currency=usd`,
            { headers: GECKO_HEADERS, timeout: 10000 },
        );
        const raw: number[][] = res.data?.data?.attributes?.ohlcv_list ?? [];
        return [...raw].reverse().map(([ts, o, h, l, c, v]) => ({
            ts: ts * 1000, o, h, l, c, v,
        }));
    } catch {
        return [];
    }
}

function simulateTrade(
    candles: any[],
    entryIndex: number,
    entryPrice: number,
    cfg: BacktestConfig,
): BacktestTrade | null {
    if (entryIndex >= candles.length - 1) return null;

    let remaining  = 1.0;    // fraction of position remaining
    let peakPrice  = entryPrice;
    let tp1Hit     = false;
    let tp2Hit     = false;
    let exitPrice  = entryPrice;
    let exitReason: BacktestTrade['exitReason'] = 'Timeout';
    let holdCandles = 0;
    let totalPnl   = 0;
    let partialPnl = 0;

    for (let i = entryIndex + 1; i < candles.length && holdCandles < cfg.maxHoldCandles; i++) {
        const candle = candles[i];
        holdCandles++;

        // Track high & low in candle
        const highMult = candle.h / entryPrice;
        const lowMult  = candle.l / entryPrice;
        const closeMult = candle.c / entryPrice;

        // ── TP1 (sell tp1Percentage% of position) ──
        if (!tp1Hit && highMult >= cfg.tp1Multiplier) {
            const soldPct  = cfg.tp1Percentage / 100;
            partialPnl    += soldPct * ((cfg.tp1Multiplier - 1) * 100);
            remaining     -= soldPct;
            tp1Hit         = true;
        }

        // ── TP2 (sell tp2Percentage% of original position) ──
        if (tp1Hit && !tp2Hit && highMult >= cfg.tp2Multiplier) {
            const soldPct  = cfg.tp2Percentage / 100;
            partialPnl    += soldPct * ((cfg.tp2Multiplier - 1) * 100);
            remaining     -= soldPct;
            tp2Hit         = true;
        }

        // Track peak for trailing stop
        if (candle.h > peakPrice) peakPrice = candle.h;

        const profitAtPeak = ((peakPrice - entryPrice) / entryPrice) * 100;

        // ── Trailing stop (remaining after TP1+TP2) ──
        if (profitAtPeak >= cfg.trailingActivatePct && remaining > 0) {
            const dropFromPeak = ((peakPrice - candle.l) / peakPrice) * 100;
            if (dropFromPeak >= cfg.trailingFromPeakPct) {
                exitPrice  = candle.l;
                const profitAtExit = ((exitPrice - entryPrice) / entryPrice) * 100;
                totalPnl   = partialPnl + remaining * profitAtExit;
                exitReason = tp1Hit && tp2Hit ? 'TrailingTP3' : tp1Hit ? 'TrailingTP3' : 'TrailingTP3';
                return { entryIndex, entryPrice, exitPrice, profitPct: totalPnl / 1, holdCandles, exitReason, tp1Hit, tp2Hit };
            }
        }

        // ── Stop loss (on low of candle) ──
        if (lowMult <= (1 - cfg.stopLossPct / 100)) {
            exitPrice  = entryPrice * (1 - cfg.stopLossPct / 100);
            totalPnl   = partialPnl + remaining * (-cfg.stopLossPct);
            exitReason = 'StopLoss';
            return { entryIndex, entryPrice, exitPrice, profitPct: totalPnl, holdCandles, exitReason, tp1Hit, tp2Hit };
        }

        // ── Timeout exit ──
        if (holdCandles >= cfg.maxHoldCandles) {
            exitPrice  = candle.c;
            const closePnl = ((exitPrice - entryPrice) / entryPrice) * 100;
            totalPnl   = partialPnl + remaining * closePnl;
            exitReason = tp2Hit ? 'TrailingTP3' : tp1Hit ? 'TP2' : 'Timeout';
            return { entryIndex, entryPrice, exitPrice, profitPct: totalPnl, holdCandles, exitReason, tp1Hit, tp2Hit };
        }
    }

    // End of data — exit at last close
    const last     = candles[Math.min(entryIndex + holdCandles, candles.length - 1)];
    exitPrice      = last?.c ?? entryPrice;
    const closePnl = ((exitPrice - entryPrice) / entryPrice) * 100;
    totalPnl       = partialPnl + remaining * closePnl;
    exitReason     = tp2Hit ? 'TrailingTP3' : tp1Hit ? 'TP2' : 'Timeout';

    return { entryIndex, entryPrice, exitPrice, profitPct: totalPnl, holdCandles, exitReason, tp1Hit, tp2Hit };
}

export async function runBacktest(
    tokenAddress: string,
    timeframe: '1h' | '15m' = '1h',
    config: Partial<BacktestConfig> = {},
): Promise<BacktestResult> {
    const cfg        = { ...DEFAULT_CONFIG, ...config };
    const poolAddress = await getBestPool(tokenAddress);

    if (!poolAddress) {
        return {
            tokenAddress, poolAddress: '', timeframe,
            totalTrades: 0, wins: 0, losses: 0, winRate: 0, avgProfit: 0,
            totalReturn: 0, maxDrawdown: 0, bestTrade: 0, worstTrade: 0, sharpe: 0,
            trades: [], config: cfg, candleCount: 0,
            note: 'Pool tidak ditemukan di GeckoTerminal',
        };
    }

    const limit  = timeframe === '1h' ? 168 : 200; // 7 days of 1h OR ~2 days of 15m
    const candles = await fetchOHLCV(poolAddress, timeframe, limit);

    if (candles.length < 10) {
        return {
            tokenAddress, poolAddress, timeframe,
            totalTrades: 0, wins: 0, losses: 0, winRate: 0, avgProfit: 0,
            totalReturn: 0, maxDrawdown: 0, bestTrade: 0, worstTrade: 0, sharpe: 0,
            trades: [], config: cfg, candleCount: candles.length,
            note: `Data OHLCV tidak cukup (${candles.length} candles)`,
        };
    }

    const trades: BacktestTrade[] = [];
    // Simulate entry every N candles (don't overlap too much)
    const entryStep = Math.max(1, Math.floor(cfg.maxHoldCandles / 4));

    let i = 0;
    while (i < candles.length - 2) {
        const entryPrice = candles[i].c;
        if (entryPrice > 0) {
            const trade = simulateTrade(candles, i, entryPrice, cfg);
            if (trade) {
                trades.push(trade);
                i += trade.holdCandles || entryStep;
                continue;
            }
        }
        i += entryStep;
    }

    if (trades.length === 0) {
        return {
            tokenAddress, poolAddress, timeframe,
            totalTrades: 0, wins: 0, losses: 0, winRate: 0, avgProfit: 0,
            totalReturn: 0, maxDrawdown: 0, bestTrade: 0, worstTrade: 0, sharpe: 0,
            trades: [], config: cfg, candleCount: candles.length,
            note: 'Tidak ada trade yang dapat disimulasikan',
        };
    }

    const wins    = trades.filter(t => t.profitPct > 0).length;
    const losses  = trades.length - wins;
    const winRate = (wins / trades.length) * 100;
    const profits = trades.map(t => t.profitPct);
    const avgProfit    = profits.reduce((a, b) => a + b, 0) / profits.length;
    const bestTrade    = Math.max(...profits);
    const worstTrade   = Math.min(...profits);
    const totalReturn  = profits.reduce((a, b) => a + b, 0);

    // Max drawdown
    let peak = 0, maxDrawdown = 0, cumulative = 0;
    for (const p of profits) {
        cumulative += p;
        if (cumulative > peak) peak = cumulative;
        const dd = peak - cumulative;
        if (dd > maxDrawdown) maxDrawdown = dd;
    }

    // Sharpe ratio (simplified, assumes 0% risk-free rate)
    const mean   = avgProfit;
    const variance = profits.reduce((s, p) => s + (p - mean) ** 2, 0) / profits.length;
    const stdDev = Math.sqrt(variance);
    const sharpe = stdDev > 0 ? mean / stdDev : 0;

    return {
        tokenAddress, poolAddress, timeframe,
        totalTrades: trades.length,
        wins, losses,
        winRate:     Math.round(winRate * 10) / 10,
        avgProfit:   Math.round(avgProfit * 100) / 100,
        totalReturn: Math.round(totalReturn * 100) / 100,
        maxDrawdown: Math.round(maxDrawdown * 100) / 100,
        bestTrade:   Math.round(bestTrade * 100) / 100,
        worstTrade:  Math.round(worstTrade * 100) / 100,
        sharpe:      Math.round(sharpe * 100) / 100,
        trades,
        config:       cfg,
        candleCount:  candles.length,
        note:        `${candles.length} candle ${timeframe} dari GeckoTerminal`,
    };
}

export default { runBacktest };
