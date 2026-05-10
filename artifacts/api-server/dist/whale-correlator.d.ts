/**
 * whale-correlator.ts — Whale Correlation Map
 * Deteksi apakah 2+ whale membeli token yang sama dalam window waktu tertentu.
 * Sinyal kuat: multiple whale bergerak bersama = coordinated play.
 */
interface CorrelationSignal {
    tokenAddress: string;
    tokenSymbol: string;
    whaleCount: number;
    whales: {
        address: string;
        name: string;
        timestamp: number;
        amountEth: number;
    }[];
    firstBuyAt: number;
    lastBuyAt: number;
    confidence: number;
    windowMinutes: number;
}
export declare function recordWhaleBuy(walletAddress: string, walletName: string, tokenAddress: string, tokenSymbol: string, buyAmountEth?: number): void;
export declare function getActiveCorrelations(): CorrelationSignal[];
export declare function checkTokenCorrelation(tokenAddress: string): CorrelationSignal | null;
export declare function getCorrelationBonus(tokenAddress: string): number;
declare const _default: {
    recordWhaleBuy: typeof recordWhaleBuy;
    getActiveCorrelations: typeof getActiveCorrelations;
    checkTokenCorrelation: typeof checkTokenCorrelation;
    getCorrelationBonus: typeof getCorrelationBonus;
};
export default _default;
//# sourceMappingURL=whale-correlator.d.ts.map