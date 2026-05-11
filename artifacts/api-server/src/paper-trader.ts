/**
 * paper-trader.ts
 * Paper trading simulation engine for Base Sniper Ultimate.
 *
 * Records virtual buy/sell events using real GeckoTerminal prices.
 * No on-chain transactions — purely for performance evaluation.
 */

import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';
import { getBestDexPair, getEthPriceUsd } from './price-oracle';
import {
    dbSavePaperPosition, dbDeletePaperPosition, dbGetPaperPositions,
    dbInsertPaperTrade, dbGetPaperTrades, dbResetPaperTrading,
    dbGetPaperConfig, dbSetPaperConfig,
    type PaperPositionRow, type PaperTradeRow,
} from './db';

export interface PaperConfig {
    enabled:       boolean;
    virtualBalance: number;  // starting virtual ETH balance
    tradeSize:     number;   // ETH per paper trade
    tp1Multiplier: number;   // e.g. 2.0 = 2x
    tp1Percentage: number;   // % to sell at TP1
    tp2Multiplier: number;   // e.g. 5.0 = 5x
    stopLoss:      number;   // % drop from entry to trigger SL (e.g. 20 = 20%)
    maxPositions:  number;
}

export interface PaperStats {
    enabled:           boolean;
    virtualBalance:    number;
    startingBalance:   number;
    totalProfitEth:    number;
    totalProfitPct:    number;
    openPositions:     number;
    closedTrades:      number;
    wins:              number;
    losses:            number;
    winRate:           number;
    bestTradePct:      number;
    worstTradePct:     number;
    avgHoldMs:         number;
}

const DEFAULT_CONFIG: PaperConfig = {
    enabled:        false,
    virtualBalance: 0.5,
    tradeSize:      0.01,
    tp1Multiplier:  2.0,
    tp1Percentage:  50,
    tp2Multiplier:  5.0,
    stopLoss:       20,
    maxPositions:   10,
};

const MONITOR_INTERVAL_MS = 60_000; // poll every 60 seconds

export class PaperTrader extends EventEmitter {
    private config: PaperConfig;
    private positions = new Map<string, PaperPositionRow>();
    private monitorTimer: NodeJS.Timeout | null = null;
    private virtualBalance = 0;

    constructor(config?: Partial<PaperConfig>) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...(config ?? {}) };
        this.loadState();
    }

    // ── State persistence ──────────────────────────────────────────────────────

    private loadState(): void {
        try {
            const enabledVal = dbGetPaperConfig('enabled');
            if (enabledVal !== null) this.config.enabled = enabledVal === 'true';

            const balVal = dbGetPaperConfig('virtual_balance');
            this.virtualBalance = balVal !== null
                ? parseFloat(balVal)
                : this.config.virtualBalance;

            const cfgVal = dbGetPaperConfig('config');
            if (cfgVal) {
                const saved = JSON.parse(cfgVal);
                this.config = { ...this.config, ...saved };
            }

            const positions = dbGetPaperPositions();
            for (const p of positions) {
                this.positions.set(p.tokenAddress.toLowerCase(), p);
            }
            if (positions.length > 0) {
                console.log(`📄 Paper trader: restored ${positions.length} open position(s)`);
            }
        } catch (e: any) {
            console.warn('⚠️  Paper trader: could not load state:', e?.message);
        }
    }

    /**
     * Call this AFTER initDb() to restore persisted state.
     * The constructor-time loadState() fires before the DB is ready and silently
     * returns empty data. This method re-runs it once the DB is fully initialised
     * and starts position monitoring if paper trading was previously enabled.
     */
    reloadState(): void {
        this.positions.clear();
        this.loadState();
        if (this.config.enabled && !this.monitorTimer) {
            this.startMonitor();
            console.log('📄 Paper trader: monitoring resumed after DB reload');
        }
    }

    private saveConfig(): void {
        try {
            dbSetPaperConfig('enabled', String(this.config.enabled));
            dbSetPaperConfig('virtual_balance', String(this.virtualBalance));
            dbSetPaperConfig('config', JSON.stringify(this.config));
        } catch { /* non-critical */ }
    }

    // ── Enable / Disable ───────────────────────────────────────────────────────

    setEnabled(enabled: boolean): void {
        this.config.enabled = enabled;
        if (enabled && !this.monitorTimer) {
            this.startMonitor();
            console.log('📄 Paper trader ENABLED');
        } else if (!enabled && this.monitorTimer) {
            clearInterval(this.monitorTimer);
            this.monitorTimer = null;
            console.log('📄 Paper trader DISABLED');
        }
        this.saveConfig();
    }

    isEnabled(): boolean { return this.config.enabled; }

    // ── Config update ──────────────────────────────────────────────────────────

    updateConfig(updates: Partial<PaperConfig>): void {
        this.config = { ...this.config, ...updates };
        if (updates.virtualBalance !== undefined) {
            this.virtualBalance = updates.virtualBalance;
        }
        this.saveConfig();
    }

    getConfig(): PaperConfig { return { ...this.config }; }

    // ── Start / Stop monitor ───────────────────────────────────────────────────

    start(): void {
        if (!this.config.enabled) return;
        this.startMonitor();
    }

    stop(): void {
        if (this.monitorTimer) {
            clearInterval(this.monitorTimer);
            this.monitorTimer = null;
        }
    }

    private startMonitor(): void {
        if (this.monitorTimer) return;
        this.monitorTimer = setInterval(() => this.monitorPositions(), MONITOR_INTERVAL_MS);
    }

    // ── Open a virtual position ────────────────────────────────────────────────

    async openPosition(
        tokenAddress: string,
        tokenSymbol:  string,
        source:       string,
        dexUrl?:      string,
    ): Promise<boolean> {
        if (!this.config.enabled) return false;

        const addr = tokenAddress.toLowerCase();
        if (this.positions.has(addr)) {
            console.log(`📄 Paper trader: already holding ${tokenSymbol} — skip`);
            return false;
        }
        if (this.positions.size >= this.config.maxPositions) {
            console.log(`📄 Paper trader: max positions (${this.config.maxPositions}) reached — skip`);
            return false;
        }
        if (this.virtualBalance < this.config.tradeSize) {
            console.log(`📄 Paper trader: virtual balance too low (${this.virtualBalance.toFixed(4)} ETH) — skip`);
            return false;
        }

        let entryPriceUsd = 0;
        let entryPriceEth = 0;
        try {
            const pair = await getBestDexPair(tokenAddress);
            if (!pair) {
                console.log(`📄 Paper trader: no price for ${tokenSymbol} — skip`);
                return false;
            }
            entryPriceUsd = parseFloat(pair.priceUsd || '0');
            entryPriceEth = parseFloat(pair.priceNative || '0');
            if (entryPriceUsd <= 0) {
                console.log(`📄 Paper trader: zero price for ${tokenSymbol} — skip`);
                return false;
            }
        } catch (e: any) {
            console.warn(`📄 Paper trader: price fetch error for ${tokenSymbol}: ${e?.message}`);
            return false;
        }

        const virtualEthIn  = Math.min(this.config.tradeSize, this.virtualBalance);
        const ethPriceUsd   = await getEthPriceUsd().catch(() => 3000);
        const virtualUsdIn  = virtualEthIn * ethPriceUsd;
        const tokensBought  = entryPriceUsd > 0 ? virtualUsdIn / entryPriceUsd : 0;

        const position: PaperPositionRow = {
            tokenAddress:  addr,
            tokenSymbol,
            entryPriceUsd,
            entryPriceEth,
            virtualEthIn,
            tokensBought,
            remainingPct:  100,
            openedAt:      Date.now(),
            peakPriceUsd:  entryPriceUsd,
            tp1Hit:        false,
            tp2Hit:        false,
            source,
            dexUrl:        dexUrl ?? '',
        };

        this.positions.set(addr, position);
        this.virtualBalance -= virtualEthIn;
        dbSavePaperPosition(position);
        this.saveConfig();

        console.log(`📄 Paper BUY: ${tokenSymbol} @ $${entryPriceUsd.toExponential(3)} | virtual: ${virtualEthIn.toFixed(4)} ETH | balance left: ${this.virtualBalance.toFixed(4)} ETH`);
        this.emit('paper-buy', { tokenAddress: addr, tokenSymbol, entryPriceUsd, virtualEthIn, source });
        return true;
    }

    // ── Monitor open positions ─────────────────────────────────────────────────

    async monitorPositions(): Promise<void> {
        if (this.positions.size === 0) return;

        for (const [addr, pos] of [...this.positions.entries()]) {
            try {
                const pair = await getBestDexPair(addr);
                if (!pair) continue;

                const currentPriceUsd = parseFloat(pair.priceUsd || '0');
                if (currentPriceUsd <= 0) continue;

                // Update peak
                if (currentPriceUsd > pos.peakPriceUsd) {
                    pos.peakPriceUsd = currentPriceUsd;
                    dbSavePaperPosition(pos);
                }

                const multiplier = currentPriceUsd / pos.entryPriceUsd;

                // ── Stop Loss ──
                const slThreshold = 1 - (this.config.stopLoss / 100);
                if (multiplier <= slThreshold) {
                    await this.closePosition(addr, 'stop-loss', pos.remainingPct, currentPriceUsd);
                    continue;
                }

                // ── TP2 ──
                if (!pos.tp2Hit && pos.tp1Hit && multiplier >= this.config.tp2Multiplier) {
                    await this.closePosition(addr, 'take-profit', pos.remainingPct, currentPriceUsd, 2);
                    continue;
                }

                // ── TP1 ──
                if (!pos.tp1Hit && multiplier >= this.config.tp1Multiplier) {
                    const tp1SellPct = this.config.tp1Percentage;
                    await this.closePartial(addr, 'take-profit', tp1SellPct, currentPriceUsd, 1);
                }

            } catch (e: any) {
                console.warn(`📄 Paper monitor error for ${pos.tokenSymbol}: ${e?.message}`);
            }
        }
    }

    // ── Close partial position (TP1) ──────────────────────────────────────────

    private async closePartial(
        tokenAddress: string,
        reason:       string,
        sellPct:      number,
        exitPriceUsd: number,
        tpLevel?:     number,
    ): Promise<void> {
        const pos = this.positions.get(tokenAddress);
        if (!pos) return;

        const ethPriceUsd   = await getEthPriceUsd().catch(() => 3000);
        const fraction      = sellPct / 100;
        const ethIn         = pos.virtualEthIn * fraction;
        const usdValueIn    = ethIn * ethPriceUsd;
        const profitPct     = (exitPriceUsd / pos.entryPriceUsd - 1) * 100;
        const usdValueOut   = usdValueIn * (1 + profitPct / 100);
        const ethOut        = usdValueOut / ethPriceUsd;
        const profitEth     = ethOut - ethIn;

        const trade: PaperTradeRow = {
            id:            randomBytes(8).toString('hex'),
            tokenAddress:  pos.tokenAddress,
            tokenSymbol:   pos.tokenSymbol,
            entryPriceUsd: pos.entryPriceUsd,
            exitPriceUsd,
            virtualEthIn:  ethIn,
            virtualEthOut: ethOut,
            profitPct,
            profitEth,
            holdMs:        Date.now() - pos.openedAt,
            closedAt:      Date.now(),
            reason,
            tpLevel,
            source:        pos.source,
            dexUrl:        pos.dexUrl,
        };

        dbInsertPaperTrade(trade);
        this.virtualBalance += ethOut;

        // Update position — mark TP1 hit, reduce remainingPct
        pos.tp1Hit      = true;
        pos.remainingPct = pos.remainingPct - sellPct;
        pos.virtualEthIn = pos.virtualEthIn * (1 - fraction);
        dbSavePaperPosition(pos);
        this.saveConfig();

        const pctLabel = profitPct >= 0 ? `+${profitPct.toFixed(1)}%` : `${profitPct.toFixed(1)}%`;
        console.log(`📄 Paper TP${tpLevel ?? ''}: ${pos.tokenSymbol} ${pctLabel} | ${sellPct}% sold | eth out: ${ethOut.toFixed(5)}`);
        this.emit('paper-close', { ...trade, partial: true });
    }

    // ── Close full position ────────────────────────────────────────────────────

    async closePosition(
        tokenAddress: string,
        reason:       string,
        sellPct:      number,
        exitPriceUsd: number,
        tpLevel?:     number,
    ): Promise<void> {
        const pos = this.positions.get(tokenAddress);
        if (!pos) return;

        const ethPriceUsd   = await getEthPriceUsd().catch(() => 3000);
        const ethIn         = pos.virtualEthIn;
        const usdValueIn    = ethIn * ethPriceUsd;
        const profitPct     = (exitPriceUsd / pos.entryPriceUsd - 1) * 100;
        const usdValueOut   = usdValueIn * (1 + profitPct / 100);
        const ethOut        = Math.max(0, usdValueOut / ethPriceUsd);
        const profitEth     = ethOut - ethIn;

        const trade: PaperTradeRow = {
            id:            randomBytes(8).toString('hex'),
            tokenAddress:  pos.tokenAddress,
            tokenSymbol:   pos.tokenSymbol,
            entryPriceUsd: pos.entryPriceUsd,
            exitPriceUsd,
            virtualEthIn:  ethIn,
            virtualEthOut: ethOut,
            profitPct,
            profitEth,
            holdMs:        Date.now() - pos.openedAt,
            closedAt:      Date.now(),
            reason,
            tpLevel,
            source:        pos.source,
            dexUrl:        pos.dexUrl,
        };

        dbInsertPaperTrade(trade);
        this.virtualBalance += ethOut;

        this.positions.delete(tokenAddress);
        dbDeletePaperPosition(tokenAddress);
        this.saveConfig();

        const pctLabel = profitPct >= 0 ? `+${profitPct.toFixed(1)}%` : `${profitPct.toFixed(1)}%`;
        const emoji    = reason === 'stop-loss' ? '🛑' : '🎯';
        console.log(`📄 Paper ${emoji} ${reason}: ${pos.tokenSymbol} ${pctLabel} | eth out: ${ethOut.toFixed(5)}`);
        this.emit('paper-close', { ...trade, partial: false });
    }

    // ── Manual close ──────────────────────────────────────────────────────────

    async manualClose(tokenAddress: string): Promise<boolean> {
        const addr = tokenAddress.toLowerCase();
        const pos  = this.positions.get(addr);
        if (!pos) return false;

        try {
            const pair = await getBestDexPair(addr);
            const exitPriceUsd = pair ? parseFloat(pair.priceUsd || '0') : pos.entryPriceUsd;
            await this.closePosition(addr, 'manual', pos.remainingPct, exitPriceUsd);
            return true;
        } catch {
            await this.closePosition(addr, 'manual', pos.remainingPct, pos.entryPriceUsd);
            return true;
        }
    }

    // ── Reset ─────────────────────────────────────────────────────────────────

    reset(): void {
        this.positions.clear();
        this.virtualBalance = this.config.virtualBalance;
        dbResetPaperTrading();
        this.saveConfig();
        console.log(`📄 Paper trader reset — virtual balance: ${this.virtualBalance} ETH`);
    }

    // ── Stats / data accessors ────────────────────────────────────────────────

    getStats(): PaperStats {
        const trades       = dbGetPaperTrades(1000);
        const wins         = trades.filter(t => t.profitPct > 0).length;
        const losses       = trades.filter(t => t.profitPct <= 0).length;
        const totalProfit  = trades.reduce((s, t) => s + t.profitEth, 0);
        const totalPnlPct  = trades.reduce((s, t) => s + t.profitPct, 0);
        const avgPct       = trades.length > 0 ? totalPnlPct / trades.length : 0;
        const avgHoldMs    = trades.length > 0 ? trades.reduce((s, t) => s + t.holdMs, 0) / trades.length : 0;
        const bestPct      = trades.length > 0 ? Math.max(...trades.map(t => t.profitPct)) : 0;
        const worstPct     = trades.length > 0 ? Math.min(...trades.map(t => t.profitPct)) : 0;
        const winRate      = trades.length > 0 ? (wins / trades.length) * 100 : 0;

        return {
            enabled:          this.config.enabled,
            virtualBalance:   this.virtualBalance,
            startingBalance:  this.config.virtualBalance,
            totalProfitEth:   totalProfit,
            totalProfitPct:   avgPct,
            openPositions:    this.positions.size,
            closedTrades:     trades.length,
            wins,
            losses,
            winRate,
            bestTradePct:     bestPct,
            worstTradePct:    worstPct,
            avgHoldMs,
        };
    }

    getOpenPositions(): PaperPositionRow[] {
        return [...this.positions.values()];
    }

    getClosedTrades(limit = 200): PaperTradeRow[] {
        return dbGetPaperTrades(limit);
    }

    getVirtualBalance(): number { return this.virtualBalance; }
}

export const paperTrader = new PaperTrader();
