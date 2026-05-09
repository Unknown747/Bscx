import { EventEmitter } from 'events';
import axios from 'axios';
import { getBestDexPair } from './price-oracle';
import { simulateCopyTrade, type SimulationResult } from './whale-finder';

// ============ TYPES ============
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

interface CopyTradeOpportunity {
    walletAddress: string;
    walletName: string;
    tokenAddress: string;
    tokenSymbol: string;
    buyAmount: number;
    timestamp: number;
    txHash: string;
    simulation?: SimulationResult;
}

export class CopyTradeMonitor extends EventEmitter {
    private wallets: WalletTarget[] = [];
    private scanInterval: NodeJS.Timeout | null = null;
    private resetInterval: NodeJS.Timeout | null = null;
    private recentTrades: Map<string, number> = new Map();
    private isScanning = false;

    private readonly CONFIG = {
        COPY_INVEST_AMOUNT:          0.002,
        COPY_DELAY_SECONDS:          2,
        MAX_COPY_PER_DAY:            10,
        MIN_WALLET_SCORE:            60,
        BLACKLIST_TOKENS:            new Set<string>(),
        SCAN_INTERVAL_MS:            2000,
        MIN_WIN_RATE_TO_STAY_ACTIVE: 30,
        MIN_TRADES_BEFORE_SCORE:     5,
        // Simulation gate: skip copy if estimated profit is too low
        MIN_SIM_PROFIT_PCT:          10,
        SIMULATION_ENABLED:          true,
    };

    private dailyCopyCount = 0;
    private lastResetDate  = new Date().toDateString();

    constructor() {
        super();
        this.wallets = [];
    }

    // ============ START MONITORING ============
    start(): void {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🐋 COPY TRADE MONITOR ACTIVE');
        console.log(`💰 Copy Amount: ${this.CONFIG.COPY_INVEST_AMOUNT} ETH per trade`);
        console.log(`👥 Monitoring: ${this.wallets.length} whale wallets`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        if (!this.scanInterval) {
            this.scanInterval = setInterval(() => {
                this.scanWallets();
            }, this.CONFIG.SCAN_INTERVAL_MS);
        }

        this.resetDailyCounter();
    }

    private resetDailyCounter(): void {
        if (this.resetInterval) return;
        this.resetInterval = setInterval(() => {
            const today = new Date().toDateString();
            if (today !== this.lastResetDate) {
                this.dailyCopyCount = 0;
                this.lastResetDate  = today;
                console.log('📅 Daily copy counter reset');
            }
        }, 60000);
    }

    // ============ SCAN WALLET TRANSACTIONS ============
    private async scanWallets(): Promise<void> {
        if (this.isScanning) return;
        this.isScanning = true;

        for (const wallet of this.wallets) {
            if (!wallet.isActive || wallet.pendingValidation) continue;

            try {
                const recentTxs = await this.getRecentTransactions(wallet.address);
                const newBuys   = this.filterNewBuys(recentTxs, wallet);

                for (const buy of newBuys) {
                    await this.processCopyOpportunity(buy, wallet);
                }
            } catch { /* silent fail per wallet */ }
        }

        // Clean up old recentTrades
        const cutoff = Date.now() - 60000;
        for (const [hash, time] of this.recentTrades) {
            if (time < cutoff) this.recentTrades.delete(hash);
        }

        this.isScanning = false;
    }

    private async getRecentTransactions(address: string): Promise<any[]> {
        try {
            const response = await axios.get(
                `https://base.blockscout.com/api/v2/addresses/${address}/transactions`,
                { params: { filter: 'to', limit: 5 }, timeout: 5000 }
            );
            return response.data?.items ?? [];
        } catch {
            return [];
        }
    }

    private filterNewBuys(transactions: any[], wallet: WalletTarget): any[] {
        const newBuys = [];
        const now = Date.now();

        for (const tx of transactions) {
            if (!this.isBuyTransaction(tx)) continue;

            const txHash  = tx.hash || tx.id;
            const txTime  = this.getTxTimestamp(tx);

            if (this.recentTrades.has(txHash))    continue;
            if (txTime === 0)                      continue;
            if (now - txTime > 30000)              continue;

            const tokenAddress = this.extractTokenAddress(tx);
            if (tokenAddress === wallet.lastBuyToken) continue;

            newBuys.push(tx);
            this.recentTrades.set(txHash, now);
        }

        return newBuys;
    }

    private isBuyTransaction(tx: any): boolean {
        const input = tx.input || tx.data || '';
        return input.startsWith('0x414bf389') || input.startsWith('0xbc651188');
    }

    private getTxTimestamp(tx: any): number {
        if (tx.timestamp) return new Date(tx.timestamp).getTime();
        if (tx.time)      return new Date(tx.time).getTime();
        return 0;
    }

    private extractTokenAddress(tx: any): string {
        const data  = tx.input || tx.data || '';
        const match = data.match(/0x[a-fA-F0-9]{40}/);
        return match ? match[0] : '';
    }

    // ============ PROCESS COPY OPPORTUNITY ============
    private async processCopyOpportunity(tx: any, wallet: WalletTarget): Promise<void> {
        const tokenAddress = this.extractTokenAddress(tx);
        if (!tokenAddress) return;

        if (this.CONFIG.BLACKLIST_TOKENS.has(tokenAddress)) {
            console.log(`   ⚠️ Skipping blacklisted token: ${tokenAddress.slice(0, 10)}...`);
            return;
        }

        if (this.dailyCopyCount >= this.CONFIG.MAX_COPY_PER_DAY) {
            console.log('📊 Daily copy limit reached');
            return;
        }

        const tokenInfo = await this.getTokenInfo(tokenAddress);
        if (!tokenInfo) return;

        // ── Token age filter ──
        if (tokenInfo.pairCreatedAt) {
            const ageHours = (Date.now() - tokenInfo.pairCreatedAt) / 3_600_000;
            if (ageHours > 24) {
                console.log(`   ⏳ Skip: ${tokenInfo.symbol} terlalu tua (${ageHours.toFixed(1)}h)`);
                return;
            }
        }

        const isSafe = await this.quickSafetyCheck(tokenAddress);
        if (!isSafe) {
            console.log(`   🛡️ Token failed safety check`);
            this.CONFIG.BLACKLIST_TOKENS.add(tokenAddress);
            return;
        }

        // ── Simulation gate — estimate profit before copying ──
        let simulation: SimulationResult | undefined;
        if (this.CONFIG.SIMULATION_ENABLED) {
            try {
                simulation = await simulateCopyTrade(wallet.address, tokenAddress);
                console.log(`   🔮 Simulation: est. ${simulation.estimatedProfit >= 0 ? '+' : ''}${simulation.estimatedProfit}% | risk: ${simulation.estimatedRisk} | WR: ${simulation.winRate}%`);

                if (simulation.estimatedProfit < this.CONFIG.MIN_SIM_PROFIT_PCT && simulation.estimatedRisk === 'HIGH') {
                    console.log(`   ⛔ Copy BLOCKED by simulation gate (profit too low, risk too high)`);
                    this.emit('simulation-blocked', {
                        walletAddress: wallet.address,
                        walletName:    wallet.name,
                        tokenAddress,
                        tokenSymbol:   tokenInfo.symbol,
                        simulation
                    });
                    return;
                }
            } catch { /* if simulation fails, proceed anyway */ }
        }

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`🐋 COPY TRADE TRIGGERED!`);
        console.log(`👤 From: ${wallet.name} (${wallet.address.slice(0, 10)}...)`);
        console.log(`🪙 Token: ${tokenInfo.symbol} (${tokenAddress.slice(0, 10)}...)`);
        console.log(`💰 Amount: ${this.CONFIG.COPY_INVEST_AMOUNT} ETH`);
        if (simulation) console.log(`🔮 Sim: +${simulation.estimatedProfit}% est. | ${simulation.estimatedRisk} risk`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        wallet.lastBuyTime  = Date.now();
        wallet.lastBuyToken = tokenAddress;
        this.dailyCopyCount++;

        this.emit('copy-opportunity', {
            walletAddress: wallet.address,
            walletName:    wallet.name,
            tokenAddress,
            tokenSymbol:   tokenInfo.symbol,
            buyAmount:     this.CONFIG.COPY_INVEST_AMOUNT,
            timestamp:     Date.now(),
            txHash:        tx.hash || tx.id,
            simulation,
        } as CopyTradeOpportunity);

        setTimeout(() => {
            this.emit('execute-copy', {
                tokenAddress,
                tokenSymbol:  tokenInfo.symbol,
                amount:       this.CONFIG.COPY_INVEST_AMOUNT,
                sourceWallet: wallet.name,
                simulation,
            });
        }, this.CONFIG.COPY_DELAY_SECONDS * 1000);
    }

    private async getTokenInfo(tokenAddress: string): Promise<{ symbol: string; name: string; pairCreatedAt?: number } | null> {
        try {
            const pair = await getBestDexPair(tokenAddress);
            if (pair) {
                return {
                    symbol:       pair.baseToken?.symbol || 'UNKNOWN',
                    name:         pair.baseToken?.name   || 'Unknown Token',
                    pairCreatedAt: pair.pairCreatedAt ?? undefined,
                };
            }
            return { symbol: 'UNKNOWN', name: 'Unknown Token' };
        } catch {
            return null;
        }
    }

    private async quickSafetyCheck(tokenAddress: string): Promise<boolean> {
        try {
            const response = await axios.get(
                `https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${tokenAddress}`,
                { timeout: 5000 }
            );
            const data = response.data?.result?.[tokenAddress.toLowerCase()];
            if (!data) return false;
            if (data.is_honeypot === '1')             return false;
            if (parseFloat(data.buy_tax  || '0') > 15) return false;
            if (parseFloat(data.sell_tax || '0') > 15) return false;
            return true;
        } catch {
            return false;
        }
    }

    // ============ RUNTIME CONFIG UPDATE ============
    updateConfig(updates: {
        copyEnabled?:  boolean;
        copyAmount?:   number;
        copyDelay?:    number;
        minLiquidity?: number;
    }): void {
        const c = this.CONFIG as any;
        if (updates.copyAmount != null) c.COPY_INVEST_AMOUNT = updates.copyAmount;
        if (updates.copyDelay  != null) c.COPY_DELAY_SECONDS = updates.copyDelay;

        if (updates.copyEnabled === true  && !this.scanInterval) this.start();
        if (updates.copyEnabled === false && this.scanInterval)  this.stop();

        console.log('⚙️  CopyTradeMonitor config updated');
    }

    // ============ PUBLIC METHODS ============
    addWallet(address: string, name: string, pendingValidation = false): void {
        const existing = this.wallets.find(w => w.address.toLowerCase() === address.toLowerCase());
        if (existing) return;
        this.wallets.push({
            address,
            name,
            lastBuyTime:       0,
            lastBuyToken:      '',
            totalPnL:          0,
            winRate:           0,
            isActive:          !pendingValidation,
            copiedTrades:      0,
            wins:              0,
            losses:            0,
            autoPaused:        false,
            pendingValidation,
        });
        console.log(`✅ Added wallet: ${name} (${address.slice(0, 10)}...) ${pendingValidation ? '[PENDING VALIDATION]' : ''}`);
    }

    removeWallet(address: string): void {
        const idx = this.wallets.findIndex(w => w.address.toLowerCase() === address.toLowerCase());
        if (idx !== -1) {
            this.wallets.splice(idx, 1);
            console.log(`❌ Removed wallet: ${address.slice(0, 10)}...`);
        }
    }

    toggleWallet(address: string, active: boolean): void {
        const w = this.wallets.find(w => w.address.toLowerCase() === address.toLowerCase());
        if (w) {
            w.isActive = active;
            if (active) w.autoPaused = false;
            console.log(`${active ? '✅' : '⏸️'} Wallet ${active ? 'activated' : 'paused'}: ${address.slice(0, 10)}...`);
        }
    }

    recordTradeOutcome(walletAddress: string | undefined, profitPct: number | null): void {
        if (!walletAddress) return;
        const w = this.wallets.find(w => w.address.toLowerCase() === walletAddress.toLowerCase());
        if (!w) return;

        w.copiedTrades++;
        const isWin = (profitPct ?? 0) > 0;
        if (isWin) w.wins++; else w.losses++;

        if (profitPct !== null) {
            w.totalPnL = parseFloat(((w.totalPnL || 0) + profitPct).toFixed(2));
        }

        const total  = w.wins + w.losses;
        w.winRate    = total > 0 ? parseFloat(((w.wins / total) * 100).toFixed(1)) : 0;

        if (
            total >= this.CONFIG.MIN_TRADES_BEFORE_SCORE &&
            w.winRate < this.CONFIG.MIN_WIN_RATE_TO_STAY_ACTIVE &&
            !w.autoPaused
        ) {
            w.isActive   = false;
            w.autoPaused = true;
            console.log(`⏸️  Auto-paused whale ${w.name}: win rate ${w.winRate}% < ${this.CONFIG.MIN_WIN_RATE_TO_STAY_ACTIVE}%`);
        }

        console.log(`📊 Whale ${w.name}: ${w.wins}W/${w.losses}L (${w.winRate}% WR) | P&L: ${w.totalPnL >= 0 ? '+' : ''}${w.totalPnL.toFixed(1)}%`);
    }

    renameWallet(address: string, name: string): void {
        const w = this.wallets.find(w => w.address.toLowerCase() === address.toLowerCase());
        if (w) {
            w.name = name;
            console.log(`✏️  Renamed wallet ${address.slice(0, 10)}... → "${name}"`);
        }
    }

    getWallets(): WalletTarget[] {
        return this.wallets.map(w => ({ ...w }));
    }

    getStats(): object {
        return {
            activeWallets: this.wallets.filter(w => w.isActive).length,
            dailyCopies:   this.dailyCopyCount,
            maxCopies:     this.CONFIG.MAX_COPY_PER_DAY,
            copyAmount:    this.CONFIG.COPY_INVEST_AMOUNT,
            delaySeconds:  this.CONFIG.COPY_DELAY_SECONDS,
        };
    }

    stop(): void {
        if (this.scanInterval) { clearInterval(this.scanInterval); this.scanInterval = null; }
        if (this.resetInterval) { clearInterval(this.resetInterval); this.resetInterval = null; }
        console.log('🛑 Copy Trade Monitor stopped');
    }
}

export default CopyTradeMonitor;
