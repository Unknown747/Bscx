import { FlashblocksScanner } from './flashblocks-scanner';
import { CopyTradeMonitor } from './copy-trade-monitor';
import { MultiAIProvider } from './multi-ai-provider';
import { SwapExecutor } from './swap-executor';
import type { Address } from 'viem';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import dotenv from 'dotenv';

dotenv.config();

// ============ ACTIVITY LOG TYPES ============
type LogType = 'buy-success' | 'buy-failed' | 'sell-success' | 'take-profit' | 'stop-loss' | 'copy-trade' | 'info';

interface LogEntry {
    id: string;
    type: LogType;
    message: string;
    detail?: string;
    timestamp: number;
}

const MAX_LOG_ENTRIES = 100;

// Mutable runtime config — mirrors env vars but can be updated via API
interface RuntimeConfig {
    totalCapital:    number;
    maxTradeAmount:  number;
    minLiquidity:    number;
    maxSlippage:     number;
    tp1Multiplier:   number;
    tp1Percentage:   number;
    tp2Multiplier:   number;
    tp2Percentage:   number;
    stopLoss:        number;
    maxPriorityFee:  number;
    maxFeePerGas:    number;
    copyEnabled:     boolean;
    copyAmount:      number;
    copyDelay:       number;
    copyMaxPerDay:   number;
    minSafetyScore:  number;
    maxPoolAgeSeconds: number;
    aiEnabled:       boolean;
}

export class AISniperBot extends EventEmitter {
    private scanner: FlashblocksScanner;
    private copyMonitor: CopyTradeMonitor;
    private ai: MultiAIProvider;
    private executor: SwapExecutor | null = null;
    private activityLog: LogEntry[] = [];
    private sentimentInterval: NodeJS.Timeout | null = null;

    // Single source of truth for all runtime config
    private runtimeConfig: RuntimeConfig = {
        totalCapital:     parseFloat(process.env.TOTAL_CAPITAL_ETH            || '0.006'),
        maxTradeAmount:   parseFloat(process.env.MAX_TRADE_AMOUNT             || '0.0006'),
        minLiquidity:     parseFloat(process.env.MIN_LIQUIDITY_ETH            || '0.15'),
        maxSlippage:      parseFloat(process.env.MAX_SLIPPAGE_PERCENT         || '15'),
        tp1Multiplier:    parseFloat(process.env.TAKE_PROFIT_1_MULTIPLIER     || '1.5'),
        tp1Percentage:    parseFloat(process.env.TAKE_PROFIT_1_PERCENTAGE     || '50'),
        tp2Multiplier:    parseFloat(process.env.TAKE_PROFIT_2_MULTIPLIER     || '2.5'),
        tp2Percentage:    parseFloat(process.env.TAKE_PROFIT_2_PERCENTAGE     || '50'),
        stopLoss:         parseFloat(process.env.STOP_LOSS_PERCENTAGE         || '30'),
        maxPriorityFee:   parseFloat(process.env.MAX_PRIORITY_FEE_GWEI        || '0.5'),
        maxFeePerGas:     parseFloat(process.env.MAX_FEE_PER_GAS_GWEI         || '1.5'),
        copyEnabled:      process.env.COPY_TRADING_ENABLED === 'true',
        copyAmount:       parseFloat(process.env.COPY_TRADING_AMOUNT          || '0.0003'),
        copyDelay:        parseFloat(process.env.COPY_TRADING_DELAY_SECONDS   || '2'),
        copyMaxPerDay:    parseInt  (process.env.COPY_TRADING_MAX_PER_DAY     || '10'),
        minSafetyScore:   parseInt  (process.env.MIN_SAFETY_SCORE             || '65'),
        maxPoolAgeSeconds:parseInt  (process.env.MAX_POOL_AGE_SECONDS         || '60'),
        aiEnabled:        process.env.AI_ENABLED === 'true'
    };

    private readonly CONFIG = {
        MIN_AI_CONFIDENCE:         parseInt(process.env.MIN_AI_CONFIDENCE        || '65'),
        AUTO_COPY_SCORE_THRESHOLD: parseInt(process.env.AUTO_COPY_SCORE_THRESHOLD || '75'),
        ENABLE_GROQ_PRIMARY:       true
    };

    constructor() {
        super();
        this.scanner     = new FlashblocksScanner();
        this.copyMonitor = new CopyTradeMonitor();
        this.ai          = new MultiAIProvider();

        // SwapExecutor requires a valid PRIVATE_KEY — init safely
        try {
            this.executor = new SwapExecutor();
        } catch (err: any) {
            console.warn(`⚠️  SwapExecutor disabled: ${err.message}`);
            console.warn('   Set a valid PRIVATE_KEY in .env to enable live trading.');
            this.addLog('info', 'Live trading dinonaktifkan', 'Set PRIVATE_KEY di .env untuk aktifkan');
        }

        this.setupEventHandlers();
    }

    // ============ ACTIVITY LOG ============
    private addLog(type: LogType, message: string, detail?: string): void {
        const entry: LogEntry = {
            id:        randomBytes(6).toString('hex'),
            type,
            message,
            detail,
            timestamp: Date.now()
        };
        this.activityLog.unshift(entry); // newest first
        if (this.activityLog.length > MAX_LOG_ENTRIES) {
            this.activityLog.length = MAX_LOG_ENTRIES;
        }
    }

    getActivityLog(): LogEntry[] {
        return this.activityLog;
    }

    private setupEventHandlers(): void {
        // ============ EVENT: Pool Baru Ditemukan ============
        this.scanner.on('pool-ready', async (pool) => {
            console.log(`\n🎯 New pool: ${pool.poolAddress}`);
            const startTime = Date.now();

            const analysis = await this.ai.analyzeToken(pool.token0, {
                liquidity:  pool.liquidity,
                volume24h:  pool.volume24h,
                ageSeconds: (Date.now() - pool.createdAt) / 1000
            });

            const aiLatency = Date.now() - startTime;
            console.log(`   🤖 AI Decision (${aiLatency}ms): ${analysis.recommendation}`);
            console.log(`   📊 Confidence: ${analysis.confidence}% | Risk: ${analysis.riskLevel}`);

            if (this.shouldBuy(analysis)) {
                const amount = this.calculatePositionSize(analysis);
                console.log(`   ✅ AI APPROVED: BUY ${amount} ETH`);
                console.log(`   💡 Reason: ${analysis.reasoning}`);
                this.addLog('info', `AI approved: BUY ${amount} ETH`, `${analysis.confidence}% confidence · ${analysis.riskLevel} risk`);
                await this.executeBuy(pool.token0 as Address, amount);
            } else {
                console.log(`   ❌ AI REJECTED: ${analysis.reasoning}`);
                this.addLog('info', `AI rejected pool ${pool.poolAddress.slice(0, 10)}...`, analysis.reasoning);
            }
        });

        // ============ EVENT: Copy Trade Opportunity ============
        this.copyMonitor.on('copy-opportunity', async (opportunity) => {
            console.log(`\n🐋 Copy opportunity from ${opportunity.walletName}`);

            const walletAnalysis = await this.ai.analyzeWallet(
                opportunity.walletAddress,
                {
                    totalTrades: opportunity.totalTrades || 50,
                    winRate:     opportunity.winRate     || 60,
                    avgHoldTime: 300,
                    avgProfit:   25
                }
            );

            console.log(`   🧠 Wallet Score: ${walletAnalysis.score}/100`);
            console.log(`   📈 Pattern: ${walletAnalysis.tradingPattern}`);

            if (walletAnalysis.shouldCopy && walletAnalysis.score > this.CONFIG.AUTO_COPY_SCORE_THRESHOLD) {
                console.log(`   ✅ COPY APPROVED: ${walletAnalysis.reason}`);
                this.addLog('copy-trade', `Copy dari ${opportunity.walletName}`, `${opportunity.tokenSymbol} · score ${walletAnalysis.score}/100`);
                await this.executeCopyTrade(opportunity);
            } else {
                console.log(`   ❌ COPY REJECTED: ${walletAnalysis.reason}`);
                this.addLog('info', `Copy ditolak: ${opportunity.walletName}`, walletAnalysis.reason);
            }
        });

        // Forward swap events + record to activity log
        if (this.executor) {
            this.executor.on('buy-success', (d) => {
                this.emit('buy-success', d);
                this.addLog('buy-success', `BUY ${d.tokenSymbol}`, `TX: ${d.txHash?.slice(0, 18)}...`);
            });
            this.executor.on('buy-failed', (d) => {
                this.emit('buy-failed', d);
                this.addLog('buy-failed', `BUY gagal: ${d.tokenAddress?.slice(0, 10)}...`, d.error);
            });
            this.executor.on('sell-success', (d) => {
                this.emit('sell-success', d);
                this.addLog('sell-success', `SELL ${d.tokenSymbol} (${d.percentSold}%)`, `TX: ${d.txHash?.slice(0, 18)}...`);
            });
            this.executor.on('take-profit', (d) => {
                this.emit('take-profit', d);
                this.addLog('take-profit', `TP${d.level} ${d.tokenSymbol} @ ${d.multiplier?.toFixed(2)}x`, 'Auto take profit triggered');
            });
            this.executor.on('stop-loss', (d) => {
                this.emit('stop-loss', d);
                this.addLog('stop-loss', `Stop Loss ${d.tokenSymbol} @ ${d.profitPct?.toFixed(1)}%`, 'Auto stop loss triggered');
            });
        }

        // ============ Periodic Market Sentiment (every 5 min) ============
        // Store reference so we can clear it in stop()
        this.sentimentInterval = setInterval(async () => {
            const sentiment = await this.ai.getMarketSentiment();
            console.log(`\n📊 Market Sentiment: ${sentiment.sentiment}/100`);
            console.log(`   ⛽ Gas Advice: ${sentiment.gasAdvice}`);
            console.log(`   ⏰ Best Time: ${sentiment.bestTime}`);
        }, 300_000);
    }

    // ============ TRADE DECISION LOGIC ============
    private shouldBuy(analysis: any): boolean {
        if (analysis.recommendation !== 'BUY')               return false;
        if (analysis.confidence      < this.CONFIG.MIN_AI_CONFIDENCE) return false;
        if (analysis.riskLevel      === 'CRITICAL')           return false;
        if (analysis.predictedProfit < 20)                    return false;
        return true;
    }

    private calculatePositionSize(analysis: any): number {
        let pct = 0.10; // 10% default

        if      (analysis.confidence > 80) pct = 0.15;
        else if (analysis.confidence > 70) pct = 0.12;

        if      (analysis.riskLevel === 'LOW')  pct *= 1.2;
        else if (analysis.riskLevel === 'HIGH') pct *= 0.7;

        // Cap at maxTradeAmount from runtime config
        return Math.min(this.runtimeConfig.totalCapital * pct, this.runtimeConfig.maxTradeAmount);
    }

    // ============ EXECUTION ============
    private async executeBuy(tokenAddress: Address, amountEth: number): Promise<void> {
        if (!this.executor) {
            console.warn('   ⚠️  Live trading disabled (no PRIVATE_KEY)');
            return;
        }

        const result = await this.executor.buy({ tokenAddress, amountInEth: amountEth });

        if (result.success) {
            console.log(`   ✅ BUY SUCCESS | TX: ${result.txHash}`);
        } else {
            console.error(`   ❌ BUY FAILED: ${result.error}`);
        }
    }

    private async executeCopyTrade(opportunity: any): Promise<void> {
        if (!this.executor) {
            console.warn('   ⚠️  Live trading disabled (no PRIVATE_KEY)');
            return;
        }

        // Use runtime config so updates from POST /api/settings take effect immediately
        const copyAmount = this.runtimeConfig.copyAmount;

        const result = await this.executor.buy({
            tokenAddress: opportunity.tokenAddress as Address,
            amountInEth:  copyAmount
        });

        if (result.success) {
            console.log(`   ✅ COPY TRADE SUCCESS | TX: ${result.txHash}`);
        } else {
            console.error(`   ❌ COPY TRADE FAILED: ${result.error}`);
        }
    }

    // ============ PERFORMANCE REPORT ============
    async printPerformanceReport(): Promise<void> {
        const aiStats = this.ai.getStats();
        const positions = this.executor?.getOpenPositions() ?? [];

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📊 AI PERFORMANCE REPORT');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        for (const [provider, stats] of Object.entries(aiStats.providers)) {
            if (stats) {
                const s = stats as { success: number; fail: number; avgLatency: number };
                console.log(`${provider.toUpperCase()}: ✓${s.success} ✗${s.fail} | ~${s.avgLatency.toFixed(0)}ms`);
            }
        }

        console.log(`\nCurrent Provider: ${aiStats.currentProvider}`);
        console.log(`Open Positions:   ${positions.length}`);

        if (positions.length > 0) {
            for (const p of positions) {
                const holdMins = ((Date.now() - p.openedAt) / 60000).toFixed(1);
                console.log(`  • ${p.tokenSymbol} | held ${holdMins}m`);
            }
        }

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }

    // ============ LIFECYCLE ============
    async start(): Promise<void> {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🤖 AI-POWERED BASE SNIPER (Groq + Gemini)');
        console.log(`💰 Modal: ${this.runtimeConfig.totalCapital} ETH (~100rb)`);
        console.log(`💼 Wallet: ${this.executor?.getWalletAddress() ?? 'NOT CONFIGURED'}`);
        console.log(`⚡ Primary AI: Groq (${this.CONFIG.ENABLE_GROQ_PRIMARY ? 'ACTIVE' : 'DISABLED'})`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Health check AI providers
        const health = await this.ai.healthCheck();
        console.log('🔍 AI Provider Status:');
        console.log(`   Groq:        ${health.groq        ? '✅' : '❌'}`);
        console.log(`   Gemini:      ${health.gemini      ? '✅' : '❌'}`);
        console.log(`   HuggingFace: ${health.huggingface ? '✅' : '❌'}\n`);

        await this.scanner.connect();

        // Use runtime config (not env) so hot-reload via POST /api/settings works
        if (this.runtimeConfig.copyEnabled) {
            this.copyMonitor.start();
        }

        // Hourly performance report
        setInterval(() => this.printPerformanceReport(), 3_600_000);

        console.log('✅ AI SNIPER RUNNING\n');
    }

    async stop(): Promise<void> {
        if (this.sentimentInterval) {
            clearInterval(this.sentimentInterval);
            this.sentimentInterval = null;
        }
        this.scanner.disconnect();
        this.copyMonitor.stop();
        this.executor?.stop();
        console.log('🛑 AI Sniper stopped');
    }

    // ============ RUNTIME CONFIG UPDATE ============
    updateRuntimeConfig(s: Partial<RuntimeConfig>): void {
        // Update the single source-of-truth runtimeConfig object
        if (s.totalCapital     != null) this.runtimeConfig.totalCapital     = s.totalCapital;
        if (s.maxTradeAmount   != null) this.runtimeConfig.maxTradeAmount   = s.maxTradeAmount;
        if (s.minLiquidity     != null) this.runtimeConfig.minLiquidity     = s.minLiquidity;
        if (s.maxSlippage      != null) this.runtimeConfig.maxSlippage      = s.maxSlippage;
        if (s.tp1Multiplier    != null) this.runtimeConfig.tp1Multiplier    = s.tp1Multiplier;
        if (s.tp1Percentage    != null) this.runtimeConfig.tp1Percentage    = s.tp1Percentage;
        if (s.tp2Multiplier    != null) this.runtimeConfig.tp2Multiplier    = s.tp2Multiplier;
        if (s.tp2Percentage    != null) this.runtimeConfig.tp2Percentage    = s.tp2Percentage;
        if (s.stopLoss         != null) this.runtimeConfig.stopLoss         = s.stopLoss;
        if (s.maxPriorityFee   != null) this.runtimeConfig.maxPriorityFee   = s.maxPriorityFee;
        if (s.maxFeePerGas     != null) this.runtimeConfig.maxFeePerGas     = s.maxFeePerGas;
        if (s.copyEnabled      != null) this.runtimeConfig.copyEnabled      = s.copyEnabled;
        if (s.copyAmount       != null) this.runtimeConfig.copyAmount       = s.copyAmount;
        if (s.copyDelay        != null) this.runtimeConfig.copyDelay        = s.copyDelay;
        if (s.copyMaxPerDay    != null) this.runtimeConfig.copyMaxPerDay    = s.copyMaxPerDay;
        if (s.minSafetyScore   != null) this.runtimeConfig.minSafetyScore   = s.minSafetyScore;
        if (s.maxPoolAgeSeconds!= null) this.runtimeConfig.maxPoolAgeSeconds= s.maxPoolAgeSeconds;
        if (s.aiEnabled        != null) this.runtimeConfig.aiEnabled        = s.aiEnabled;

        // Push trading params to SwapExecutor
        if (this.executor) {
            this.executor.updateConfig({
                maxSlippage:    this.runtimeConfig.maxSlippage,
                tp1Multiplier:  this.runtimeConfig.tp1Multiplier,
                tp1Percentage:  this.runtimeConfig.tp1Percentage,
                tp2Multiplier:  this.runtimeConfig.tp2Multiplier,
                tp2Percentage:  this.runtimeConfig.tp2Percentage,
                stopLoss:       this.runtimeConfig.stopLoss,
                maxPriorityFee: this.runtimeConfig.maxPriorityFee,
                maxFeePerGas:   this.runtimeConfig.maxFeePerGas
            });
        }

        // Push copy trading params to CopyTradeMonitor
        this.copyMonitor.updateConfig({
            copyEnabled:  this.runtimeConfig.copyEnabled,
            copyAmount:   this.runtimeConfig.copyAmount,
            copyDelay:    this.runtimeConfig.copyDelay,
            minLiquidity: this.runtimeConfig.minLiquidity
        });

        this.addLog('info', 'Pengaturan diperbarui via UI', `Capital: ${this.runtimeConfig.totalCapital} ETH`);
        console.log('⚙️  Runtime config updated:', this.runtimeConfig);
    }

    // Expose runtime config for /api/config endpoint
    getRuntimeConfig(): RuntimeConfig {
        return { ...this.runtimeConfig };
    }

    // ============ KEY MANAGEMENT ============
    updateKeys(keys: { privateKey?: string; groqKey?: string; geminiKey?: string; huggingfaceKey?: string }): void {
        // Update AI provider keys hot
        const aiKeys: { groq?: string; gemini?: string; huggingface?: string } = {};
        if (keys.groqKey)        aiKeys.groq        = keys.groqKey;
        if (keys.geminiKey)      aiKeys.gemini      = keys.geminiKey;
        if (keys.huggingfaceKey) aiKeys.huggingface = keys.huggingfaceKey;
        if (Object.keys(aiKeys).length > 0) this.ai.updateKeys(aiKeys);

        // Re-init SwapExecutor if private key changed
        if (keys.privateKey) {
            process.env.PRIVATE_KEY = keys.privateKey;
            try {
                if (this.executor) this.executor.stop();
                const { SwapExecutor } = require('./swap-executor');
                this.executor = new SwapExecutor();
                // Re-wire executor events
                this.executor.on('buy-success',  (d: any) => { this.emit('buy-success',  d); this.addLog('buy-success',  `BUY ${d.tokenSymbol}`,                       `TX: ${d.txHash?.slice(0, 18)}...`); });
                this.executor.on('buy-failed',   (d: any) => { this.emit('buy-failed',   d); this.addLog('buy-failed',   `BUY gagal: ${d.tokenAddress?.slice(0, 10)}...`, d.error); });
                this.executor.on('sell-success', (d: any) => { this.emit('sell-success', d); this.addLog('sell-success', `SELL ${d.tokenSymbol} (${d.percentSold}%)`,     `TX: ${d.txHash?.slice(0, 18)}...`); });
                this.executor.on('take-profit',  (d: any) => { this.emit('take-profit',  d); this.addLog('take-profit',  `TP${d.level} ${d.tokenSymbol} @ ${d.multiplier?.toFixed(2)}x`, 'Auto take profit triggered'); });
                this.executor.on('stop-loss',    (d: any) => { this.emit('stop-loss',    d); this.addLog('stop-loss',    `Stop Loss ${d.tokenSymbol} @ ${d.profitPct?.toFixed(1)}%`,    'Auto stop loss triggered'); });
                console.log('✅ SwapExecutor re-initialized with new private key');
                this.addLog('info', 'Wallet terhubung', `Address: ${this.executor.getWalletAddress()}`);
            } catch (err: any) {
                console.warn(`⚠️  SwapExecutor re-init failed: ${err.message}`);
                this.addLog('info', 'Wallet gagal terhubung', err.message);
            }
        }
    }

    // ============ LIVE PnL ============
    async getLivePnL() {
        if (!this.executor) return [];
        return this.executor.getLivePnL();
    }

    // ============ COPY WALLET MANAGEMENT ============
    getCopyWallets() { return this.copyMonitor.getWallets(); }

    addCopyWallet(address: string, name: string): void {
        this.copyMonitor.addWallet(address, name);
        this.addLog('info', `Whale ditambahkan: ${name}`, address);
    }

    removeCopyWallet(address: string): void {
        this.copyMonitor.removeWallet(address);
        this.addLog('info', `Whale dihapus`, address);
    }

    toggleCopyWallet(address: string, active: boolean): void {
        this.copyMonitor.toggleWallet(address, active);
        this.addLog('info', `Whale ${active ? 'diaktifkan' : 'dijeda'}`, address);
    }

    renameCopyWallet(address: string, name: string): void {
        this.copyMonitor.renameWallet(address, name);
    }

    getKeyStatus(): { privateKey: boolean; groqKey: boolean; geminiKey: boolean; huggingfaceKey: boolean; appPassword: boolean } {
        const ai = this.ai.getKeyStatus();
        return {
            privateKey:     !!this.executor,
            groqKey:        ai.groq,
            geminiKey:      ai.gemini,
            huggingfaceKey: ai.huggingface,
            appPassword:    !!(process.env.APP_PASSWORD)
        };
    }

    getStatus() {
        return {
            connected:     this.scanner.isConnectedToBase(),
            copyStats:     this.copyMonitor.getStats(),
            config:        this.scanner.getConfig(),
            aiStats:       this.ai.getStats(),
            openPositions: this.executor?.getOpenPositions() ?? [],
            wallet:        this.executor?.getWalletAddress() ?? null,
            timestamp:     Date.now()
        };
    }
}

export default AISniperBot;
