/**
 * microcap-risk-manager.ts
 * Manajemen risiko untuk modal kecil (0.006 ETH)
 * - Daily loss limit, consecutive loss protection, cooldown setelah profit besar
 * - Dynamic position sizing: 12% dari modal aktif
 */
export interface RiskState {
    todayLossEth: number;
    consecutiveLosses: number;
    cooldownUntil: number;
    totalCapital: number;
    tradesBlockedToday: number;
    lastTradeResult: 'profit' | 'loss' | null;
    dailyResetAt: number;
}
export interface TradeGateResult {
    allowed: boolean;
    reason?: string;
}
export declare class MicroCapRiskManager {
    private todayLossEth;
    private consecutiveLosses;
    private cooldownUntil;
    private totalCapital;
    private tradesBlockedToday;
    private lastTradeResult;
    private dailyResetAt;
    constructor(initialCapital?: number);
    private nextMidnightUtc;
    private scheduleDailyReset;
    beforeTrade(token?: {
        liquidityUSD?: number;
        createdAt?: number;
    }): TradeGateResult;
    afterTrade(profitETH: number): void;
    getPositionSize(balanceEth?: number): number;
    updateCapital(balanceEth: number): void;
    getState(): RiskState;
    isInCooldown(): boolean;
}
export default MicroCapRiskManager;
//# sourceMappingURL=microcap-risk-manager.d.ts.map