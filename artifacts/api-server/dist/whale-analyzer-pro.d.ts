/**
 * whale-analyzer-pro.ts
 * Analisis whale lanjutan: Sharpe ratio, entry timing, MEV detection
 * Menggunakan data GeckoTerminal (sesuai arsitektur bot yang ada)
 */
export interface WhaleQualityScore {
    totalScore: number;
    sharpeRatio: number;
    avgEntryTiming: number;
    realizedPnL7d: number;
    buyToSellRatio: number;
    mevDetected: boolean;
    uniquePoolCount: number;
    tradeCount: number;
    avgVolumeUsd: number;
}
export declare function analyzeWhale(walletAddress: string): Promise<WhaleQualityScore>;
//# sourceMappingURL=whale-analyzer-pro.d.ts.map