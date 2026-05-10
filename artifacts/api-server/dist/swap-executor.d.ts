import { type Address, type Hex } from 'viem';
import { EventEmitter } from 'events';
export interface SwapParams {
    tokenAddress: Address;
    amountInEth: number;
    slippagePercent?: number;
    feeTier?: 500 | 3000 | 10000;
    sourceWallet?: string;
}
export interface SwapResult {
    success: boolean;
    txHash?: Hex;
    amountIn: bigint;
    amountOut: bigint;
    gasUsed?: bigint;
    error?: string;
}
interface OpenPosition {
    tokenAddress: Address;
    tokenSymbol: string;
    amountIn: bigint;
    amountOut: bigint;
    entryPrice: number;
    openedAt: number;
    txHash: Hex;
    takeProfit1Hit: boolean;
    takeProfit2Hit: boolean;
    takeProfit3Hit: boolean;
    peakValueEth: number;
    dcaDone: boolean;
    sourceWallet?: string;
    initialLiquidityUsd: number;
    tp1SoldPct: number;
    tp2SoldPct: number;
    dynamicSell50Done?: boolean;
    dynamicSell25Done?: boolean;
}
export declare class SwapExecutor extends EventEmitter {
    private walletClient;
    private publicClient;
    private account;
    private openPositions;
    private knownTokens;
    private positionMonitorInterval;
    private isReady;
    private readonly CONFIG;
    constructor();
    private getGasPrice;
    getBalance(): Promise<{
        eth: string;
        wei: bigint;
    }>;
    buy(params: SwapParams): Promise<SwapResult>;
    sell(tokenAddress: Address, percentToSell?: number): Promise<SwapResult>;
    private startPositionMonitor;
    private checkPosition;
    getLivePnL(): Promise<Array<{
        tokenAddress: string;
        tokenSymbol: string;
        entryEth: number;
        currentValueEth: number | null;
        profitPct: number | null;
        multiplier: number | null;
        holdMs: number;
    }>>;
    private decimalsCache;
    private getTokenDecimals;
    private estimateTokenValueEth;
    private getTokenSymbol;
    private getBestFeeTier;
    private checkPriceImpact;
    addKnownToken(addr: string): void;
    getKnownTokens(): Address[];
    getPortfolioData(): Promise<{
        ethBalance: string;
        ethValueUsd: number;
        tokens: Array<{
            address: string;
            symbol: string;
            balance: string;
            decimals: number;
            priceUsd: number | null;
            valueEth: number | null;
            valueUsd: number | null;
            change24h: number | null;
        }>;
        totalValueEth: number;
        totalValueUsd: number;
    }>;
    sendEth(to: Address, amountEth: number): Promise<{
        success: boolean;
        txHash?: string;
        error?: string;
    }>;
    sendToken(tokenAddress: Address, to: Address, amountHuman: number, decimals: number): Promise<{
        success: boolean;
        txHash?: string;
        error?: string;
    }>;
    updateConfig(updates: {
        maxSlippage?: number;
        tp1Multiplier?: number;
        tp1Percentage?: number;
        tp2Multiplier?: number;
        tp2Percentage?: number;
        stopLoss?: number;
        maxPriorityFee?: number;
        maxFeePerGas?: number;
        dcaEnabled?: boolean;
        gasMode?: string;
    }): void;
    getOpenPositions(): OpenPosition[];
    hasPosition(tokenAddress: string): boolean;
    sellAllPositions(): Promise<void>;
    getWalletAddress(): Address;
    stop(): void;
}
export default SwapExecutor;
//# sourceMappingURL=swap-executor.d.ts.map