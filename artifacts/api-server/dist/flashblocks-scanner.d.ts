import { EventEmitter } from 'events';
export declare class FlashblocksScanner extends EventEmitter {
    private ws;
    private currentWsUrl;
    private reconnectAttempts;
    private isConnected;
    private pendingTransactions;
    private keepAliveInterval;
    private readonly RPC_ENDPOINTS;
    private readonly CONFIG;
    constructor();
    connect(): Promise<void>;
    private findFastestEndpoint;
    private pingWebSocket;
    private establishConnection;
    private subscribeToMempool;
    private subscribeToPoolEvents;
    private startKeepAlive;
    private handleMessage;
    private onNewTransaction;
    private onPoolCreated;
    private validatePool;
    private getPoolLiquidity;
    private checkTokenSafety;
    private calculateSafetyScore;
    private handleDisconnect;
    getConfig(): {
        flashblocksEnabled: boolean;
        MAX_TRADE_ETH: number;
        MIN_LIQUIDITY_ETH: number;
        MAX_LIQUIDITY_ETH: number;
        MAX_POOL_AGE_SECONDS: number;
        MAX_GAS_PRICE_GWEI: number;
        MIN_SAFETY_SCORE: number;
        MAX_BUY_TAX_PERCENT: number;
        MAX_SELL_TAX_PERCENT: number;
        SCAN_INTERVAL_MS: number;
    };
    isConnectedToBase(): boolean;
    disconnect(): void;
}
export default FlashblocksScanner;
//# sourceMappingURL=flashblocks-scanner.d.ts.map