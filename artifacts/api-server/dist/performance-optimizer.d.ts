/**
 * performance-optimizer.ts
 * Cache harga & batch API calls untuk mengurangi latency dan rate limit hits
 */
interface PriceEntry {
    priceUsd: number;
    priceEth: number;
    timestamp: number;
}
interface PoolEntry {
    poolAddress: string;
    liquidityUsd: number;
    timestamp: number;
}
export declare function getEthPriceSync(): number;
export declare function getBestPool(tokenAddress: string): Promise<PoolEntry | null>;
export declare function getCachedTokenPrice(tokenAddress: string): Promise<PriceEntry | null>;
export declare function batchGetPrices(tokenAddresses: string[]): Promise<Map<string, PriceEntry>>;
export declare function prioritizeWallets<T extends {
    address: string;
    winRate?: number;
    totalPnL?: number;
}>(wallets: T[], limit?: number): T[];
export declare function getCacheStats(): {
    priceEntries: number;
    poolEntries: number;
    ethPrice: number;
    ethPriceAge: number | null;
};
export {};
//# sourceMappingURL=performance-optimizer.d.ts.map