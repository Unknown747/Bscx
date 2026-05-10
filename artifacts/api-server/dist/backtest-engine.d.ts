/**
 * backtest-engine.ts — Historical Backtest Mode
 * Replay data OHLCV GeckoTerminal untuk simulasi strategi TP/SL.
 * Mendukung: profit ladder TP, trailing stop, fixed stop loss.
 */
export interface BacktestConfig {
    tp1Multiplier: number;
    tp1Percentage: number;
    tp2Multiplier: number;
    tp2Percentage: number;
    stopLossPct: number;
    trailingActivatePct: number;
    trailingFromPeakPct: number;
    maxHoldCandles: number;
    liquidityDropExit: number;
}
export interface BacktestTrade {
    entryIndex: number;
    entryPrice: number;
    exitPrice: number;
    profitPct: number;
    holdCandles: number;
    exitReason: 'TP1' | 'TP2' | 'TrailingTP3' | 'StopLoss' | 'Timeout';
    tp1Hit: boolean;
    tp2Hit: boolean;
}
export interface BacktestResult {
    tokenAddress: string;
    poolAddress: string;
    timeframe: string;
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgProfit: number;
    totalReturn: number;
    maxDrawdown: number;
    bestTrade: number;
    worstTrade: number;
    sharpe: number;
    trades: BacktestTrade[];
    config: BacktestConfig;
    candleCount: number;
    note: string;
}
export declare function runBacktest(tokenAddress: string, timeframe?: '1h' | '15m', config?: Partial<BacktestConfig>): Promise<BacktestResult>;
declare const _default: {
    runBacktest: typeof runBacktest;
};
export default _default;
//# sourceMappingURL=backtest-engine.d.ts.map