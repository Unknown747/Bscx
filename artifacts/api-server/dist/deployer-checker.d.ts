/**
 * deployer-checker.ts
 *
 * Serial rugger detection: checks how many contracts a token's deployer
 * has created within a rolling time window.
 *
 * Uses Blockscout's free API (no key required) with local caching
 * to avoid blocking trades on rate limits.
 */
export interface DeployerCheckResult {
    deployer: string | null;
    deployCount: number;
    isSerialRugger: boolean;
    windowHours: number;
    skipped: boolean;
}
export declare function getTokenDeployer(tokenAddress: string): Promise<string | null>;
export declare function checkSerialDeployer(tokenAddress: string, maxDeploys: number, windowHours: number): Promise<DeployerCheckResult>;
//# sourceMappingURL=deployer-checker.d.ts.map