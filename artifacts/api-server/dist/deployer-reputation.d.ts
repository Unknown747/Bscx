/**
 * deployer-reputation.ts
 *
 * Scores a deployer wallet's reputation based on the survival rate of their
 * previously deployed tokens. Tokens are checked against GeckoTerminal — still
 * trading with meaningful liquidity = alive, zero liquidity = likely rug.
 *
 * Score 0-100:
 *   ≥ 65  → trusted
 *   35-64 → neutral
 *   < 35  → risky
 *   null  → unknown (fewer than 2 tokens checked, fail-open)
 */
export interface TokenCheck {
    address: string;
    alive: boolean | null;
    liquidityUsd: number;
    tokenName?: string;
    tokenSymbol?: string;
    pairUrl?: string;
}
export interface ReputationResult {
    score: number | null;
    label: 'trusted' | 'neutral' | 'risky' | 'unknown';
    totalTokens: number;
    aliveTokens: number;
    deadTokens: number;
    deployer: string;
    skipped: boolean;
    checkedAt: number;
    tokenChecks: TokenCheck[];
}
export declare function getDeployerReputation(deployerAddress: string): Promise<ReputationResult>;
export declare function getReputationForToken(tokenAddress: string): Promise<ReputationResult>;
//# sourceMappingURL=deployer-reputation.d.ts.map