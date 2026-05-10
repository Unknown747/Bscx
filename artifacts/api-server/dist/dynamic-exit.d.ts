/**
 * dynamic-exit.ts
 * Strategi exit dinamis berbasis momentum harga & volume
 * Menggunakan OHLCV dari GeckoTerminal untuk deteksi reversal
 */
export type ExitSignal = 'HOLD' | 'SELL_25_PERCENT' | 'SELL_50_PERCENT' | 'SELL_ALL_PANIC' | 'SELL_ALL_TRAILING' | 'SELL_ALL_TIMEOUT';
export interface ExitContext {
    tokenAddress: string;
    entryPriceEth: number;
    currentValueEth: number;
    peakValueEth: number;
    openedAt: number;
    maxHoldMinutes: number;
    trailingActivatePct: number;
    trailingFromPeakPct: number;
    stopLossPct: number;
}
export declare function calculateExit(ctx: ExitContext): Promise<ExitSignal>;
declare const _default: {
    calculateExit: typeof calculateExit;
};
export default _default;
//# sourceMappingURL=dynamic-exit.d.ts.map