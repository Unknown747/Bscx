import { FlashblocksScanner } from './flashblocks-scanner';
import { CopyTradeMonitor } from './copy-trade-monitor';
import { MultiAIProvider } from './multi-ai-provider';
import dotenv from 'dotenv';

dotenv.config();

class AISniperBot {
    private scanner: FlashblocksScanner;
    private copyMonitor: CopyTradeMonitor;
    private ai: MultiAIProvider;
    private activeAnalyses: Map<string, any> = new Map();

    // Konfigurasi modal 100rb
    private readonly CONFIG = {
        TOTAL_CAPITAL: 0.006,
        MIN_AI_CONFIDENCE: 65,
        MAX_RISK_LEVEL: 'HIGH' as const,
        AUTO_COPY_SCORE_THRESHOLD: 75,
        ENABLE_GROQ_PRIMARY: true  // Gunakan Groq sebagai primary
    };

    constructor() {
        this.scanner = new FlashblocksScanner();
        this.copyMonitor = new CopyTradeMonitor();
        this.ai = new MultiAIProvider();

        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        // ============ EVENT: Pool Baru Ditemukan ============
        this.scanner.on('pool-ready', async (pool) => {
            console.log(`\n🎯 New pool: ${pool.poolAddress}`);
            const startTime = Date.now();

            // AI Analysis dengan Groq (tercepat - 88ms)
            const analysis = await this.ai.analyzeToken(pool.token0, {
                liquidity: pool.liquidity,
                volume24h: pool.volume24h || 0,
                ageSeconds: (Date.now() - pool.createdAt) / 1000
            });

            const aiLatency = Date.now() - startTime;
            console.log(`   🤖 AI Decision (${aiLatency}ms): ${analysis.recommendation}`);
            console.log(`   📊 Confidence: ${analysis.confidence}% | Risk: ${analysis.riskLevel}`);

            // Cek apakah harus beli
            if (this.shouldBuy(analysis)) {
                const amount = this.calculatePositionSize(analysis);
                console.log(`   ✅ AI APPROVED: BUY ${amount} ETH`);
                console.log(`   💡 Reason: ${analysis.reasoning}`);
                await this.executeBuy(pool, amount);
            } else {
                console.log(`   ❌ AI REJECTED: ${analysis.reasoning}`);
            }
        });

        // ============ EVENT: Copy Trade Opportunity ============
        this.copyMonitor.on('copy-opportunity', async (opportunity) => {
            console.log(`\n🐋 Copy opportunity from ${opportunity.walletName}`);

            // Analisis wallet dengan Gemini (kualitas terbaik)
            const walletAnalysis = await this.ai.analyzeWallet(
                opportunity.walletAddress,
                {
                    totalTrades: opportunity.totalTrades || 50,
                    winRate: opportunity.winRate || 60,
                    avgHoldTime: 300,
                    avgProfit: 25
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

        // ============ Periodic Market Sentiment ============
        setInterval(async () => {
            const sentiment = await this.ai.getMarketSentiment();
            console.log(`\n📊 Market Sentiment: ${sentiment.sentiment}/100`);
            console.log(`   ⛽ Gas Advice: ${sentiment.gasAdvice}`);
            console.log(`   ⏰ Best Time: ${sentiment.bestTime}`);
        }, 300000); // setiap 5 menit
    }

    private shouldBuy(analysis: any): boolean {
        if (analysis.recommendation !== 'BUY') return false;
        if (analysis.confidence < this.CONFIG.MIN_AI_CONFIDENCE) return false;
        if (analysis.riskLevel === 'CRITICAL') return false;
        if (analysis.predictedProfit < 20) return false; // Minimal 20% expected gain
        return true;
    }

    private calculatePositionSize(analysis: any): number {
        let basePercentage = 0.1; // 10% dari modal untuk modal kecil

        // Adjust berdasarkan confidence
        if (analysis.confidence > 80) basePercentage = 0.15;
        else if (analysis.confidence > 70) basePercentage = 0.12;

        // Adjust berdasarkan risk
        if (analysis.riskLevel === 'LOW') basePercentage *= 1.2;
        else if (analysis.riskLevel === 'HIGH') basePercentage *= 0.7;

        const amount = this.CONFIG.TOTAL_CAPITAL * basePercentage;
        return Math.min(amount, 0.001); // Max 0.001 ETH per trade untuk modal 100rb
    }

    private async executeBuy(pool: any, amount: number): Promise<void> {
        console.log(`   💰 Executing buy: ${amount} ETH`);
        // Implementasi actual swap di sini
        // Gunakan viem atau ethers untuk execute transaction
    }

    private async executeCopyTrade(opportunity: any): Promise<void> {
        console.log(`   🐋 Executing copy trade: ${opportunity.tokenSymbol}`);
        // Implementasi copy trade di sini
    }

    // ============ PERFORMANCE REPORT ============
    async printPerformanceReport(): Promise<void> {
        const aiStats = this.ai.getStats();
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📊 AI PERFORMANCE REPORT');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        for (const [provider, stats] of Object.entries(aiStats.providers)) {
            if (stats) {
                const s = stats as { success: number; fail: number; avgLatency: number };
                console.log(`${provider.toUpperCase()}:`);
                console.log(`   Success: ${s.success} | Fail: ${s.fail}`);
                console.log(`   Avg Latency: ${s.avgLatency.toFixed(0)}ms`);
            }
        }

        console.log(`\nCurrent Provider: ${aiStats.currentProvider}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }

    async start(): Promise<void> {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🤖 AI-POWERED BASE SNIPER (Groq + Gemini)');
        console.log(`💰 Modal: ${this.CONFIG.TOTAL_CAPITAL} ETH (100rb)`);
        console.log(`⚡ Primary AI: Groq (${this.CONFIG.ENABLE_GROQ_PRIMARY ? 'ACTIVE' : 'DISABLED'})`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Health check AI providers
        const health = await this.ai.healthCheck();
        console.log('🔍 AI Provider Status:');
        console.log(`   Groq: ${health.groq ? '✅' : '❌'}`);
        console.log(`   Gemini: ${health.gemini ? '✅' : '❌'}`);
        console.log(`   HuggingFace: ${health.huggingface ? '✅' : '❌'}\n`);

        // Start scanner dan monitor
        await this.scanner.connect();
        this.copyMonitor.start();

        // Periodic performance report
        setInterval(() => this.printPerformanceReport(), 3600000); // setiap jam

        console.log('✅ AI SNIPER RUNNING\n');
    }

    async stop(): Promise<void> {
        this.scanner.disconnect();
        this.copyMonitor.stop();
        console.log('🛑 AI Sniper stopped');
    }
}

// Start bot
const bot = new AISniperBot();
bot.start().catch(console.error);

export default bot;
