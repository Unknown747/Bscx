/**
 * token-safety.ts — Full Token Safety Checker
 * Menggunakan GoPlus Labs + Honeypot.is untuk analisis risiko token
 * Chain: Base (chainId 8453)
 */
export interface SafetyReport {
    tokenAddress: string;
    safe: boolean;
    score: number;
    flags: string[];
    details: {
        isHoneypot: boolean;
        buyTax: number;
        sellTax: number;
        hasMintFunction: boolean;
        ownershipRenounced: boolean;
        ownerBalance: number;
        isProxy: boolean;
        tradingCooldown: boolean;
        cannotSell: boolean;
        cannotBuy: boolean;
        liquidityLocked: boolean;
        topHolderConcentration: number;
        honeypotIs?: boolean;
    };
    checkedAt: number;
}
export declare function checkTokenSafety(tokenAddress: string): Promise<SafetyReport>;
export declare function clearSafetyCache(tokenAddress?: string): void;
declare const _default: {
    checkTokenSafety: typeof checkTokenSafety;
    clearSafetyCache: typeof clearSafetyCache;
};
export default _default;
//# sourceMappingURL=token-safety.d.ts.map