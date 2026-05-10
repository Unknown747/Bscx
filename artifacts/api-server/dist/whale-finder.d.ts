/**
 * whale-finder.ts
 *
 * Discovers profitable whale wallets on Base by:
 * 1. Fetching trending + new pools from GeckoTerminal
 * 2. Pulling recent TRADES from GeckoTerminal /pools/{pool}/trades (gives real tx_from_address)
 * 3. Building a cross-pool wallet map: wallets that buy in 2+ different tokens = candidates
 * 4. Scoring on trade volume, unique-pool count, recency, and buy/sell activity
 * 5. Persisting candidates in SQLite; sending Telegram notification for approval
 *
 * Manual scans always run immediately (no cooldown).
 * Auto-scans respect a 15-minute cooldown.
 */
export interface WhaleCandidate {
    address: string;
    estimatedWinRate: number;
    tradeCount: number;
    avgProfitPct: number;
    totalVolumeEth: number;
    lastActiveMs: number;
    discoveredAt: number;
    score: number;
    tokens: string[];
    status: 'pending' | 'approved' | 'rejected' | 'monitoring';
    approvedAt?: number;
}
export interface SimulationResult {
    walletAddress: string;
    tokenAddress: string;
    tokenSymbol: string;
    simulated: boolean;
    estimatedProfit: number;
    estimatedRisk: 'LOW' | 'MEDIUM' | 'HIGH';
    winRate: number;
    tradeCount: number;
    summary: string;
}
/**
 * @param forceManual  When true, bypass the 15-minute auto-scan cooldown.
 *                     Always pass true for API-triggered manual scans.
 */
export declare function runWhaleScan(forceManual?: boolean): Promise<WhaleCandidate[]>;
export declare function getPendingCandidates(): WhaleCandidate[];
export declare function getAllCandidates(): WhaleCandidate[];
export declare function approveCandidate(address: string): WhaleCandidate | null;
export declare function monitorCandidate(address: string): WhaleCandidate | null;
export declare function rejectCandidate(address: string): void;
export declare function simulateCopyTrade(walletAddress: string, tokenAddress: string): Promise<SimulationResult>;
export declare function formatWhaleTelegramMsg(candidate: WhaleCandidate, index: number): string;
//# sourceMappingURL=whale-finder.d.ts.map