/**
 * basescan-monitor.ts
 *
 * Membaca riwayat transaksi wallet langsung dari blockchain Base
 * menggunakan Blockscout API (gratis, tanpa API key).
 *
 * Strategi:
 * 1. Fetch ERC-20 token transfers via Blockscout V2 API
 * 2. Kelompokkan per token, bedakan buy (terima token) vs sell (kirim token)
 * 3. FIFO matching buy↔sell untuk hitung realized PnL
 * 4. Track cursor (next_page_params) per wallet agar tidak re-fetch dari awal
 */
export interface TradePair {
    tokenAddress: string;
    tokenSymbol: string;
    buyTimestamp: number;
    sellTimestamp: number;
    buyValueEth: number;
    sellValueEth: number;
    pnlPct: number;
    isWin: boolean;
    txBuy: string;
    txSell: string;
}
export interface BlockscoutResult {
    walletAddress: string;
    totalTxs: number;
    tradePairs: TradePair[];
    tradesObserved: number;
    winsObserved: number;
    lossesObserved: number;
    avgPnlPct: number;
    lastTradeMs: number;
    tradesPerDay: number;
    dataSource: 'blockscout' | 'fallback';
    error?: string;
}
/**
 * Menganalisis riwayat transaksi wallet dari Blockscout dan
 * mengembalikan statistik trading yang akurat.
 */
export declare function analyzeWalletOnChain(walletAddress: string, sinceMs?: number): Promise<BlockscoutResult>;
/**
 * Fetch 10 transaksi terbaru untuk live feed (selalu fresh, tanpa cursor cache)
 */
export interface RecentTrade {
    txHash: string;
    direction: 'buy' | 'sell';
    tokenAddress: string;
    tokenSymbol: string;
    tokenIcon: string;
    amount: number;
    amountFmt: string;
    timestampMs: number;
    blockNumber: number;
    explorerUrl: string;
}
export declare function fetchRecentTrades(walletAddress: string, limit?: number): Promise<RecentTrade[]>;
/**
 * Reset cursor cache untuk wallet — re-scan dari awal
 */
export declare function resetWalletCache(walletAddress: string): void;
/**
 * Blockscout selalu tersedia (no key needed) — tapi cek konektivitas
 */
export declare function isBasescanAvailable(): boolean;
//# sourceMappingURL=basescan-monitor.d.ts.map