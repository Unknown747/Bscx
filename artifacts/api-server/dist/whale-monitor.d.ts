/**
 * whale-monitor.ts
 *
 * Monitors "approved-for-monitoring" whale wallets.
 * PRIMARY: Blockscout API — baca riwayat tx langsung dari blockchain Base
 * FALLBACK: GeckoTerminal pool trades — jika Blockscout tidak tersedia
 *
 * Poll interval: 10 menit
 */
export declare class WhaleMonitorService {
    private pollTimer;
    private readonly POLL_MS;
    start(): void;
    stop(): void;
    poll(): Promise<void>;
    private pollWithBasescan;
    private pollWithGecko;
    private fetchWalletTradesDirect;
    private fetchNewPoolTrades;
    private fetchTrades;
    private updateStatsGecko;
}
export declare const whaleMonitor: WhaleMonitorService;
//# sourceMappingURL=whale-monitor.d.ts.map