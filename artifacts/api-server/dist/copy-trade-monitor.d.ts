import { EventEmitter } from 'events';
interface WalletTarget {
    address: string;
    name: string;
    lastBuyTime: number;
    lastBuyToken: string;
    totalPnL: number;
    winRate: number;
    isActive: boolean;
    copiedTrades: number;
    wins: number;
    losses: number;
    autoPaused: boolean;
    pendingValidation?: boolean;
}
export declare class CopyTradeMonitor extends EventEmitter {
    private wallets;
    private scanInterval;
    private resetInterval;
    private recentTrades;
    private isScanning;
    private readonly CONFIG;
    private dailyCopyCount;
    private lastResetDate;
    private balanceProvider;
    private whaleHoldings;
    constructor();
    start(): void;
    private resetDailyCounter;
    setBalanceProvider(fn: () => Promise<number>): void;
    private calculateCopyAmount;
    private scanWallets;
    private getRecentTransactions;
    private filterNewBuys;
    private readonly WETH_BASE;
    private isBuyTransaction;
    private isSellTransaction;
    private filterNewSells;
    private getTxTimestamp;
    private extractTokenAddress;
    private processCopyOpportunity;
    private getTokenInfo;
    private quickSafetyCheck;
    updateConfig(updates: {
        copyEnabled?: boolean;
        copyAmount?: number;
        copyDelay?: number;
        minLiquidity?: number;
    }): void;
    addWallet(address: string, name: string, pendingValidation?: boolean): void;
    removeWallet(address: string): void;
    toggleWallet(address: string, active: boolean): void;
    recordTradeOutcome(walletAddress: string | undefined, profitPct: number | null): void;
    renameWallet(address: string, name: string): void;
    getWallets(): WalletTarget[];
    getStats(): object;
    stop(): void;
}
export default CopyTradeMonitor;
//# sourceMappingURL=copy-trade-monitor.d.ts.map