import { FlashblocksScanner } from './flashblocks-scanner';
import { CopyTradeMonitor } from './copy-trade-monitor';
import { MultiAIProvider } from './multi-ai-provider';
import { SwapExecutor } from './swap-executor';
import type { Address } from 'viem';
import dotenv from 'dotenv';

dotenv.config();

export class AISniperBot {
    private scanner: FlashblocksScanner;
    private copyMonitor: CopyTradeMonitor;
    private ai: MultiAIProvider;
    private executor: SwapExecutor | null = null;

    private readonly CONFIG = {
        TOTAL_CAPITAL:              parseFloat(process.env.TOTAL_CAPITAL_ETH           || '0.006'),
        MIN_AI_CONFIDENCE:          parseInt  (process.env.MIN_AI_CONFIDENCE           || '65'),
        AUTO_COPY_SCORE_THRESHOLD:  parseInt  (process.env.AUTO_COPY_SCORE_THRESHOLD   || '75'),
        ENABLE_GROQ_PRIMARY:        true
    };

    constructor() {
        this.scanner     = new FlashblocksScanner();
        this.copyMonitor = new CopyTradeMonitor();
        this.ai          = new MultiAIProvider();

        // SwapExecutor requires a valid PRIVATE_KEY — init safely
        try {
            this.executor = new SwapExecutor();
        } catch (err: any) {
            console.warn(`⚠️  SwapExecutor disabled: ${err.message}`);
            console.warn('   Set a valid PRIVATE_KEY in .env to enable live trading.');
        }

        this.setupEventHandlers();
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
                await this.executeBuy(pool.token0 as Address, amount);
            } else {
                console.log(`   ❌ AI REJECTED: ${analysis.reasoning}`);
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
                await this.executeCopyTrade(opportunity);
            } else {
                console.log(`   ❌ COPY REJECTED: ${walletAnalysis.reason}`);
            }
        });

        // Forward swap events to bot-level emitter
        if (this.executor) {
            this.executor.on('buy-success',  (d) => this.emit('buy-success',  d));
            this.executor.on('buy-failed',   (d) => this.emit('buy-failed',   d));
            this.executor.on('sell-success', (d) => this.emit('sell-success', d));
            this.executor.on('take-profit',  (d) => this.emit('take-profit',  d));
            this.executor.on('stop-loss',    (d) => this.emit('stop-loss',    d));
        }

        // ============ Periodic Market Sentiment (every 5 min) ============
        setInterval(async () => {
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

        // Cap at 0.001 ETH for safety with small capital
        return Math.min(this.CONFIG.TOTAL_CAPITAL * pct, 0.001);
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

        const copyAmount = parseFloat(process.env.COPY_TRADING_AMOUNT || '0.0003');

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
        console.log(`💰 Modal: ${this.CONFIG.TOTAL_CAPITAL} ETH (~100rb)`);
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

        if (process.env.COPY_TRADING_ENABLED === 'true') {
            this.copyMonitor.start();
        }

        // Hourly performance report
        setInterval(() => this.printPerformanceReport(), 3_600_000);

        console.log('✅ AI SNIPER RUNNING\n');
    }

    async stop(): Promise<void> {
        this.scanner.disconnect();
        this.copyMonitor.stop();
        this.executor?.stop();
        console.log('🛑 AI Sniper stopped');
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
