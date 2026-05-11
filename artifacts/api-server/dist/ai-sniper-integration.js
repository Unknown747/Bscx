"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AISniperBot = void 0;
const flashblocks_scanner_1 = require("./flashblocks-scanner");
const multi_ai_provider_1 = require("./multi-ai-provider");
const swap_executor_1 = require("./swap-executor");
const gecko_token_scanner_1 = require("./gecko-token-scanner");
const deployer_checker_1 = require("./deployer-checker");
const deployer_reputation_1 = require("./deployer-reputation");
const token_safety_1 = require("./token-safety");
const backtest_engine_1 = require("./backtest-engine");
const price_oracle_1 = require("./price-oracle");
const db_1 = require("./db");
const smart_screener_1 = __importDefault(require("./smart-screener"));
const config_store_1 = require("./config-store");
const telegram_bot_1 = require("./telegram-bot");
const push_manager_1 = require("./push-manager");
const microcap_risk_manager_1 = require("./microcap-risk-manager");
const performance_optimizer_1 = require("./performance-optimizer");
const paper_trader_1 = require("./paper-trader");
const crypto_1 = require("crypto");
const events_1 = require("events");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const MAX_LOG_ENTRIES = 100;
function sanitizeTg(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtHoldTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0)
        return `${h}h ${m}m`;
    if (m > 0)
        return `${m}m ${s}s`;
    return `${s}s`;
}
function fmtUsd(eth, ethPrice) {
    return `$${(eth * ethPrice).toFixed(2)}`;
}
class AISniperBot extends events_1.EventEmitter {
    constructor() {
        super();
        this.executor = null;
        this.activityLog = [];
        this.telegramToken = process.env.TELEGRAM_BOT_TOKEN || '';
        this.telegramChatId = process.env.TELEGRAM_CHAT_ID || '';
        this.sentimentInterval = null;
        this.portfolioSummaryInterval = null;
        this.taxGuardInterval = null;
        this.tgBot = null;
        this.emergencyStopActive = false;
        this.dailyReportTimer = null;
        this.dailyReportInterval = null;
        this.narrativeCache = new Map();
        this.smartScreenerEnabled = false;
        this.runtimeConfig = {
            totalCapital: parseFloat(process.env.TOTAL_CAPITAL_ETH || '0.006'),
            maxTradeAmount: parseFloat(process.env.MAX_TRADE_AMOUNT || '0.0006'),
            minLiquidity: parseFloat(process.env.MIN_LIQUIDITY_ETH || '0.15'),
            maxSlippage: parseFloat(process.env.MAX_SLIPPAGE_PERCENT || '15'),
            tp1Multiplier: parseFloat(process.env.TAKE_PROFIT_1_MULTIPLIER || '1.25'),
            tp1Percentage: parseFloat(process.env.TAKE_PROFIT_1_PERCENTAGE || '40'),
            tp2Multiplier: parseFloat(process.env.TAKE_PROFIT_2_MULTIPLIER || '1.6'),
            tp2Percentage: parseFloat(process.env.TAKE_PROFIT_2_PERCENTAGE || '40'),
            stopLoss: parseFloat(process.env.STOP_LOSS_PERCENTAGE || '8'),
            maxPriorityFee: parseFloat(process.env.MAX_PRIORITY_FEE_GWEI || '0.005'),
            maxFeePerGas: parseFloat(process.env.MAX_FEE_PER_GAS_GWEI || '0.05'),
            minSafetyScore: parseInt(process.env.MIN_SAFETY_SCORE || '65'),
            maxPoolAgeSeconds: parseInt(process.env.MAX_POOL_AGE_SECONDS || '60'),
            aiEnabled: process.env.AI_ENABLED === 'true',
            dcaEnabled: process.env.DCA_ENABLED === 'true',
            serialRuggerEnabled: process.env.SERIAL_RUGGER_ENABLED !== 'false',
            serialRuggerMaxDeploys: parseInt(process.env.SERIAL_RUGGER_MAX_DEPLOYS || '3'),
            serialRuggerWindowHours: parseInt(process.env.SERIAL_RUGGER_WINDOW_HOURS || '24'),
            reputationEnabled: process.env.REPUTATION_ENABLED !== 'false',
            reputationMinScore: parseInt(process.env.REPUTATION_MIN_SCORE || '25'),
            dynamicSizingEnabled: process.env.DYNAMIC_SIZING_ENABLED !== 'false',
            tradeBalancePct: parseFloat(process.env.TRADE_BALANCE_PCT || '10'),
            geckoScannerEnabled: process.env.GECKO_SCANNER_ENABLED === 'true',
            blockHoneypot: process.env.BLOCK_HONEYPOT !== 'false',
            blockHighTax: process.env.BLOCK_HIGH_TAX !== 'false',
            maxTaxPercent: parseFloat(process.env.MAX_TAX_PERCENT || '15'),
            minAiConfidence: parseInt(process.env.MIN_AI_CONFIDENCE || '75'),
            enableFlashblocks: process.env.ENABLE_FLASHBLOCKS === 'true',
            gasMode: process.env.GAS_MODE || 'auto',
            maxDailyLossEth: parseFloat(process.env.MAX_DAILY_LOSS_ETH || '0.0015'),
            maxConsecutiveLosses: parseInt(process.env.MAX_CONSECUTIVE_LOSSES || '3'),
            cooldownAfterProfitMinutes: parseInt(process.env.COOLDOWN_AFTER_BIG_PROFIT_MINUTES || '15'),
            dailyLossCooldownHours: parseFloat(process.env.DAILY_LOSS_COOLDOWN_HOURS || '2'),
            tradingScheduleEnabled: process.env.TRADING_SCHEDULE_ENABLED === 'true',
            tradingStartHour: parseInt(process.env.TRADING_START_HOUR || '8'),
            tradingEndHour: parseInt(process.env.TRADING_END_HOUR || '23'),
            autoCompoundEnabled: process.env.AUTO_COMPOUND_ENABLED === 'true',
            smartScreenerEnabled: process.env.SMART_SCREENER_ENABLED === 'true',
        };
        this.CONFIG = {
            MIN_AI_CONFIDENCE: parseInt(process.env.MIN_AI_CONFIDENCE || '75'),
            MAX_OPEN_POSITIONS: parseInt(process.env.MAX_OPEN_POSITIONS || '3'),
            ENABLE_GROQ_PRIMARY: true
        };
        this.scanner = new flashblocks_scanner_1.FlashblocksScanner();
        this.ai = new multi_ai_provider_1.MultiAIProvider();
        this.riskManager = new microcap_risk_manager_1.MicroCapRiskManager(this.runtimeConfig.totalCapital);
        this.geckoScanner = new gecko_token_scanner_1.GeckoTokenScanner({
            minLiquidityUsd: this.runtimeConfig.minLiquidity * (0, performance_optimizer_1.getEthPriceSync)(),
        });
        // Initialize SmartScreener — config loaded from DB after initDb()
        this.smartScreener = new smart_screener_1.default();
        try {
            this.executor = new swap_executor_1.SwapExecutor();
            this.executor.loadPositionsFromDb();
        }
        catch (err) {
            console.warn(`⚠️  SwapExecutor disabled: ${err.message}`);
            this.addLog('info', 'Live trading dinonaktifkan', 'Set PRIVATE_KEY di .env untuk aktifkan');
        }
        this.setupEventHandlers();
    }
    // ============ SETTINGS PERSISTENCE ============
    loadPersistedSettings() {
        // ── Layer 1: trading-config.json (committed, survives redeploy) ──
        try {
            const fileCfg = (0, config_store_1.loadTradingConfig)();
            const configKeys = Object.keys(fileCfg).filter(k => k !== '_note');
            if (configKeys.length > 0) {
                this.runtimeConfig = { ...this.runtimeConfig, ...fileCfg };
                console.log(`⚙️  Loaded ${configKeys.length} settings from trading-config.json`);
            }
        }
        catch (e) {
            console.warn('⚠️  Could not load trading-config.json:', e?.message);
        }
        // ── Layer 2: SQLite DB (latest UI changes, highest priority) ──
        try {
            const dbCfg = (0, db_1.dbLoadRuntimeConfig)();
            if (dbCfg && typeof dbCfg === 'object') {
                this.runtimeConfig = { ...this.runtimeConfig, ...dbCfg };
                console.log('⚙️  Applied latest settings from DB (highest priority)');
            }
        }
        catch (e) {
            console.warn('⚠️  Could not load DB settings:', e?.message);
        }
        // ── Layer 3: Runtime keys (Telegram/AI keys set via UI, gitignored) ──
        try {
            const keys = (0, config_store_1.applyRuntimeKeys)();
            if (keys.telegramToken)
                this.telegramToken = keys.telegramToken;
            if (keys.telegramChatId)
                this.telegramChatId = keys.telegramChatId;
            // AI keys are applied to process.env by applyRuntimeKeys(), MultiAIProvider reads them
        }
        catch { /* non-critical */ }
        // ── Screener config ──
        try {
            const screenerCfg = (0, db_1.dbLoadScreenerConfig)();
            if (screenerCfg && typeof screenerCfg === 'object') {
                this.smartScreener.updateConfig(screenerCfg);
                console.log('🔍 Loaded screener config from DB');
            }
        }
        catch { /* non-critical */ }
        this.smartScreenerEnabled = this.runtimeConfig.smartScreenerEnabled;
        console.log(`⚙️  Final config: TP1=${this.runtimeConfig.tp1Multiplier}x SL=${this.runtimeConfig.stopLoss}% Screener=${this.smartScreenerEnabled}`);
    }
    // ============ ACTIVITY LOG ============
    addLog(type, message, detail) {
        const entry = {
            id: (0, crypto_1.randomBytes)(6).toString('hex'),
            type,
            message,
            detail,
            timestamp: Date.now()
        };
        this.activityLog.unshift(entry);
        if (this.activityLog.length > MAX_LOG_ENTRIES)
            this.activityLog.length = MAX_LOG_ENTRIES;
        // Persist to DB (non-blocking, best-effort)
        try {
            (0, db_1.dbInsertActivityLog)(entry);
        }
        catch { /* DB may not be ready */ }
    }
    getActivityLog() { return this.activityLog; }
    loadLogsFromDb() {
        try {
            const rows = (0, db_1.dbGetRecentActivityLogs)(200);
            // Merge with in-memory (in-memory entries are newer; rows are sorted newest-first)
            const inMemoryIds = new Set(this.activityLog.map(e => e.id));
            for (const row of rows) {
                if (!inMemoryIds.has(row.id)) {
                    this.activityLog.push(row);
                }
            }
            // Re-sort newest-first and cap
            this.activityLog.sort((a, b) => b.timestamp - a.timestamp);
            if (this.activityLog.length > MAX_LOG_ENTRIES)
                this.activityLog.length = MAX_LOG_ENTRIES;
            if (rows.length > 0)
                console.log(`📋 Restored ${rows.length} activity log(s) from DB`);
        }
        catch { /* non-critical */ }
    }
    // ============ TELEGRAM ============
    isWithinTradingHours() {
        if (!this.runtimeConfig.tradingScheduleEnabled)
            return true;
        const wibHour = (new Date().getUTCHours() + 7) % 24;
        const start = this.runtimeConfig.tradingStartHour;
        const end = this.runtimeConfig.tradingEndHour;
        if (start <= end)
            return wibHour >= start && wibHour < end;
        return wibHour >= start || wibHour < end; // Overnight span
    }
    async sendTelegram(message) {
        if (!this.telegramToken || !this.telegramChatId)
            return;
        try {
            const { default: axios } = await Promise.resolve().then(() => __importStar(require('axios')));
            await axios.post(`https://api.telegram.org/bot${this.telegramToken}/sendMessage`, {
                chat_id: this.telegramChatId,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            }, { timeout: 5000 });
        }
        catch { /* silent */ }
    }
    async testTelegram() {
        if (!this.telegramToken || !this.telegramChatId) {
            return { ok: false, error: 'Bot Token atau Chat ID belum diisi' };
        }
        try {
            const { default: axios } = await Promise.resolve().then(() => __importStar(require('axios')));
            const positions = this.executor?.getOpenPositions() ?? [];
            await axios.post(`https://api.telegram.org/bot${this.telegramToken}/sendMessage`, {
                chat_id: this.telegramChatId,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                text: `✅ <b>Base Sniper — Test Berhasil!</b>\n\n` +
                    `Bot terhubung dan siap mengirim notifikasi.\n\n` +
                    `📊 <b>Fitur Aktif:</b>\n` +
                    `  ✅ GeckoTerminal Scanner aktif\n` +
                    `  ${this.runtimeConfig.geckoScannerEnabled ? '✅' : '⏸'} Token Scanner (GeckoTerminal)\n` +
                    `  ${this.runtimeConfig.dynamicSizingEnabled ? '✅' : '⏸'} Dynamic Position Sizing\n` +
                    `  ${this.runtimeConfig.smartScreenerEnabled ? '✅' : '⏸'} Smart Screener\n\n` +
                    `⚡ Posisi aktif: ${positions.length}`
            }, { timeout: 5000 });
            return { ok: true };
        }
        catch (err) {
            const detail = err?.response?.data?.description || err?.message || 'Unknown error';
            return { ok: false, error: detail };
        }
    }
    // ============ DYNAMIC POSITION SIZING ============
    /**
     * Calculate trade amount based on current ETH balance.
     * Scales automatically: more balance → larger trades.
     * Min: 0.001 ETH (gas floor). Max: 30% of balance.
     */
    async calculateDynamicAmount(aiConfidence) {
        if (!this.runtimeConfig.dynamicSizingEnabled || !this.executor) {
            return this.runtimeConfig.maxTradeAmount;
        }
        try {
            const balance = await this.executor.getBalance();
            const balanceEth = parseFloat(balance.eth);
            if (balanceEth <= 0)
                return this.runtimeConfig.maxTradeAmount;
            // Base: tradeBalancePct % of balance
            const basePct = this.runtimeConfig.tradeBalancePct / 100;
            let amount = balanceEth * basePct;
            // AI confidence adjustment (only when provided)
            if (aiConfidence !== undefined) {
                const multiplier = aiConfidence >= 90 ? 1.5 : aiConfidence >= 85 ? 1.25 : aiConfidence >= 80 ? 1.0 : 0.6;
                amount *= multiplier;
            }
            const GAS_RESERVE = 0.0002;
            const spendable = Math.max(0, balanceEth - GAS_RESERVE);
            if (spendable <= 0) {
                console.log(`   ⚠️  Dynamic sizing: saldo tidak cukup untuk trade (${balanceEth.toFixed(5)} ETH)`);
                return 0;
            }
            // Always stay within 7–10% of spendable balance
            const minTrade = spendable * 0.07;
            const maxTrade = spendable * 0.10;
            const result = Math.max(minTrade, Math.min(maxTrade, amount));
            console.log(`   💰 Dynamic sizing: balance=${balanceEth.toFixed(5)} ETH → trade=${result.toFixed(5)} ETH (${(result / balanceEth * 100).toFixed(1)}%)`);
            return result;
        }
        catch {
            return this.runtimeConfig.maxTradeAmount;
        }
    }
    // ============ HONEYPOT CHECK ============
    async checkHoneypot(tokenAddress) {
        try {
            const { default: axios } = await Promise.resolve().then(() => __importStar(require('axios')));
            const res = await axios.get(`https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${tokenAddress}`, { timeout: 6000 });
            const data = res.data?.result?.[tokenAddress.toLowerCase()];
            if (!data)
                return { safe: false, reason: 'Token tidak ditemukan di GoPlus — belum terverifikasi' };
            const sellTax = parseFloat(data.sell_tax || '0');
            const buyTax = parseFloat(data.buy_tax || '0');
            const creatorPct = parseFloat(data.creator_percent || '0') * 100;
            const holderCount = parseInt(data.holder_count || '0');
            if (this.runtimeConfig.blockHoneypot && data.is_honeypot === '1')
                return { safe: false, reason: '🍯 Honeypot detected' };
            if (data.cannot_sell_all === '1')
                return { safe: false, reason: 'Cannot sell all — rug risk' };
            const taxLimit = this.runtimeConfig.maxTaxPercent;
            if (this.runtimeConfig.blockHighTax && sellTax > taxLimit)
                return { safe: false, reason: `Sell tax too high: ${sellTax}%`, sellTax };
            if (this.runtimeConfig.blockHighTax && buyTax > taxLimit)
                return { safe: false, reason: `Buy tax too high: ${buyTax}%`, buyTax };
            if (creatorPct > 20)
                return { safe: false, reason: `Creator holds too much: ${creatorPct.toFixed(0)}%` };
            if (holderCount < 50 && holderCount > 0)
                return { safe: false, reason: `Too few holders: ${holderCount}` };
            const warnings = [];
            if (data.is_mintable === '1' && data.owner_address)
                warnings.push('Mintable');
            if (sellTax > 5)
                warnings.push(`Sell tax ${sellTax}%`);
            if (buyTax > 5)
                warnings.push(`Buy tax ${buyTax}%`);
            if (creatorPct > 10)
                warnings.push(`Creator ${creatorPct.toFixed(0)}%`);
            if (warnings.length > 0)
                console.log(`   ⚠️  Token warnings: ${warnings.join(', ')}`);
            return { safe: true, sellTax, buyTax };
        }
        catch {
            console.warn('   ⚠️  GoPlus API tidak tersedia — token dilewati untuk keamanan');
            return { safe: false, reason: 'GoPlus tidak tersedia — skip untuk keamanan' };
        }
    }
    setupEventHandlers() {
        // ─── New pool from Flashblocks ───
        this.scanner.on('pool-ready', async (pool) => {
            if (this.riskManager.isCircuitBreakerTripped()) {
                console.log(`🚫 [Flashblocks] Circuit breaker active (${this.riskManager.getCircuitBreakerReason()}) — skipping pool-ready`);
                return;
            }
            const openCount = this.executor?.getOpenPositions().length ?? 0;
            if (openCount >= this.CONFIG.MAX_OPEN_POSITIONS) {
                console.log(`⚠️  [Flashblocks] Max positions reached (${openCount}/${this.CONFIG.MAX_OPEN_POSITIONS}) — skipping pool-ready`);
                return;
            }
            const tokenAddress = pool.token0;
            console.log(`\n🎯 New pool: ${pool.poolAddress}`);
            const analysis = await this.ai.analyzeToken(tokenAddress, {
                liquidity: pool.liquidity,
                volume24h: pool.volume24h,
                ageSeconds: (Date.now() - pool.createdAt) / 1000
            });
            console.log(`   🤖 AI: ${analysis.recommendation} (${analysis.confidence}%)`);
            if (this.shouldBuy(analysis)) {
                const amount = await this.calculateDynamicAmount(analysis.confidence);
                if (amount <= 0) {
                    console.log(`   ⛔ Saldo tidak cukup — skip buy`);
                    return;
                }
                console.log(`   ✅ AI APPROVED: BUY ${amount.toFixed(5)} ETH`);
                this.addLog('info', `AI approved: BUY ${amount.toFixed(5)} ETH`, `${analysis.confidence}% confidence`);
                await this.executeBuy(tokenAddress, amount);
            }
            else {
                console.log(`   ❌ AI REJECTED: ${analysis.reasoning}`);
                this.addLog('info', `AI rejected pool`, analysis.reasoning);
            }
        });
        // ─── SmartScreener buy signal ───
        this.smartScreener.on('buy-signal', async (signal) => {
            if (!this.smartScreenerEnabled)
                return;
            // ── Only act on STRONG_BUY — skip BUY/WATCH signals ──
            if (signal.signal !== 'STRONG_BUY') {
                console.log(`   ⏭️  [SmartScreener] ${signal.signal} skipped — hanya STRONG_BUY yang dieksekusi`);
                this.addLog('info', `📡 Screener: ${signal.signal} dilewati — ${signal.tokenSymbol}`, `score:${signal.score.total} | hanya STRONG_BUY (≥75) yang dieksekusi`);
                return;
            }
            // ── Hard circuit breaker: daily loss limit ──
            if (this.riskManager.isCircuitBreakerTripped()) {
                console.log(`🔴 [CircuitBreaker] Signal ignored — ${this.riskManager.getCircuitBreakerReason()}`);
                return;
            }
            // ── Hard circuit breaker: max open positions ──
            const openCount = this.executor?.getOpenPositions().length ?? 0;
            if (openCount >= this.CONFIG.MAX_OPEN_POSITIONS) {
                console.log(`⚠️  [CircuitBreaker] Max positions (${openCount}/${this.CONFIG.MAX_OPEN_POSITIONS}) — SmartScreener signal ignored`);
                return;
            }
            const tokenAddress = signal.tokenAddress;
            console.log(`\n📡 [SmartScreener] 🔥 STRONG_BUY — ${signal.tokenSymbol} (score: ${signal.score.total})`);
            // Always log the screener signal so the dashboard shows activity even without a wallet
            this.addLog('info', `📡 Screener: ${signal.signal} — ${signal.tokenSymbol}`, `score:${signal.score.total} liq:$${Math.round(signal.liquidityUsd).toLocaleString()} 1h:${signal.priceChangeH1 >= 0 ? '+' : ''}${signal.priceChangeH1.toFixed(1)}% addr:${signal.tokenAddress}`);
            // ── Optimization 4: Volume velocity filter ──────────────────────────
            // Skip if sell pressure dominates: buy ratio < 40% of total H1 transactions.
            // Uses tx counts as a proxy for buy/sell volume momentum.
            const totalTxH1 = signal.buyTxH1 + signal.sellTxH1;
            const buyRatioH1 = totalTxH1 > 0 ? signal.buyTxH1 / totalTxH1 : 0.5;
            if (totalTxH1 >= 5 && buyRatioH1 < 0.40) {
                const buyRatioPct = (buyRatioH1 * 100).toFixed(0);
                console.log(`   📉 Volume velocity: buy ratio ${buyRatioPct}% < 40% — momentum melemah, skip`);
                this.addLog('info', `📡 Screener dilewati — buy ratio H1 ${buyRatioPct}% terlalu rendah`, signal.tokenSymbol);
                return;
            }
            // ── Optimization 5: Deployer reputation pre-check ───────────────────
            // Run BEFORE the expensive AI call to save latency for bad deployers.
            if (this.runtimeConfig.serialRuggerEnabled) {
                try {
                    const sr = await (0, deployer_checker_1.checkSerialDeployer)(signal.tokenAddress, this.runtimeConfig.serialRuggerMaxDeploys, this.runtimeConfig.serialRuggerWindowHours);
                    if (sr.isSerialRugger) {
                        console.log(`   🚨 SERIAL RUGGER di screener signal — skip`);
                        this.addLog('info', `🚨 Screener diblokir: serial rugger`, signal.tokenSymbol);
                        this.addToBlacklist(signal.tokenAddress, 'Serial rugger (screener)');
                        return;
                    }
                }
                catch { /* non-critical — executeBuy will re-check */ }
            }
            if (this.runtimeConfig.reputationEnabled) {
                try {
                    const deployer = await (0, deployer_checker_1.getTokenDeployer)(signal.tokenAddress);
                    if (deployer) {
                        const rep = await (0, deployer_reputation_1.getDeployerReputation)(deployer);
                        if (rep.score !== null && rep.score < this.runtimeConfig.reputationMinScore) {
                            console.log(`   🔴 REPUTASI RENDAH di screener: ${rep.score}/100 — skip`);
                            this.addLog('info', `🔴 Screener diblokir: reputasi deployer ${rep.score}/100`, signal.tokenSymbol);
                            return;
                        }
                    }
                }
                catch { /* non-critical */ }
            }
            // Run AI analysis on top of screener signal
            const rawAnalysis = await this.ai.analyzeToken(tokenAddress, {
                liquidity: signal.liquidityUsd / ((0, performance_optimizer_1.getEthPriceSync)() || 3000),
                volume24h: signal.volumeH24,
                ageSeconds: signal.ageMinutes * 60,
                priceChangeH1: signal.priceChangeH1,
                buyTxH1: signal.buyTxH1,
                sellTxH1: signal.sellTxH1,
                fdvUsd: signal.fdvUsd,
            });
            // Ketika tidak ada AI key, rule-based sering mengembalikan HOLD karena
            // penalti "sudah lama" (>300d) dan "terkonsentrasi" — padahal screener
            // STRONG_BUY (≥75) sudah memverifikasi kualitas token secara mandiri.
            // Jika rule-based HOLD tapi confidence ≥45, percayai screener dan override ke BUY.
            const isRuleBased = typeof rawAnalysis.reasoning === 'string' && rawAnalysis.reasoning.startsWith('Rule-based:');
            // Threshold 15: tolak hanya jika confidence 0–14 (liq terlalu rendah / bsr negatif)
            // yang tidak akan lolos screener pun. Penalti "sudah lama" + "terkonsentrasi"
            // (rule-based) sudah di-handle oleh screener — tidak perlu double-hukum.
            const analysis = (isRuleBased && rawAnalysis.recommendation !== 'BUY' && rawAnalysis.confidence >= 15)
                ? { ...rawAnalysis, recommendation: 'BUY', predictedProfit: Math.max(rawAnalysis.predictedProfit ?? 0, 20) }
                : rawAnalysis;
            console.log(`   🤖 AI: ${analysis.recommendation} (${analysis.confidence}%)${isRuleBased ? ' [rule-based]' : ''}`);
            if (this.shouldBuy(analysis)) {
                const amount = await this.calculateDynamicAmount(analysis.confidence);
                if (amount <= 0) {
                    console.log(`   ⛔ Saldo tidak cukup — skip SmartScreener buy`);
                    return;
                }
                const label = signal.signal === 'STRONG_BUY' ? '🔥 STRONG BUY' : '📡 BUY';
                console.log(`   ✅ SmartScreener ${label}: ${amount.toFixed(5)} ETH for ${signal.tokenSymbol}`);
                this.addLog('info', `📡 SmartScreener ${label}: ${signal.tokenSymbol}`, `score:${signal.score.total} liq:$${Math.round(signal.liquidityUsd).toLocaleString()} 1h:${signal.priceChangeH1 >= 0 ? '+' : ''}${signal.priceChangeH1.toFixed(1)}% | AI: ${analysis.confidence}%`);
                // ── Optimization 3: Staged entry (60/40 split) ──────────────────
                // Buy 60% immediately. If position is still open and TP1 not yet hit
                // after 45 seconds, add the remaining 40% to average-in at a confirmed
                // entry rather than buying the full size in one shot.
                const firstAmt = parseFloat((amount * 0.60).toFixed(6));
                const secondAmt = parseFloat((amount * 0.40).toFixed(6));
                await this.sendTelegram(`📡 <b>SmartScreener ${label}!</b>\n` +
                    `Token: <code>${signal.tokenSymbol}</code>\n` +
                    `<code>${signal.tokenAddress}</code>\n\n` +
                    `📊 Score: <b>${signal.score.total}/100</b>\n` +
                    `💧 Liq: $${Math.round(signal.liquidityUsd).toLocaleString()} | Vol: $${Math.round(signal.volumeH24).toLocaleString()}\n` +
                    `📈 1h: ${signal.priceChangeH1 >= 0 ? '+' : ''}${signal.priceChangeH1.toFixed(1)}% | Buys: ${signal.buyTxH1}\n` +
                    `⏱️ Age: ${signal.ageMinutes}min | 🛡️ Safety: ${signal.score.safety}/25\n` +
                    `🤖 AI: ${analysis.confidence}% confidence\n` +
                    `💰 Entry bertahap: ${firstAmt.toFixed(5)} ETH (60%) + ${secondAmt.toFixed(5)} ETH (40%) dalam 45d`);
                // First tranche: 60%
                console.log(`   📊 Staged entry 1/2: ${firstAmt.toFixed(5)} ETH (60%) untuk ${signal.tokenSymbol}`);
                this.addLog('info', `📊 Entry bertahap 1/2: ${firstAmt.toFixed(5)} ETH (60%)`, `${signal.tokenSymbol} — tranche ke-2 dalam 45d`);
                await this.executeBuy(tokenAddress, firstAmt, undefined, 'smart-screener');
                // Second tranche: 40% after 45 seconds — only if still holding and TP1 not hit
                setTimeout(async () => {
                    try {
                        const pos = this.executor?.getOpenPositions().find((p) => p.tokenAddress.toLowerCase() === tokenAddress.toLowerCase());
                        if (pos && !pos.takeProfit1Hit) {
                            console.log(`   📊 Staged entry 2/2: ${secondAmt.toFixed(5)} ETH (40%) untuk ${signal.tokenSymbol}`);
                            this.addLog('info', `📊 Entry bertahap 2/2: ${secondAmt.toFixed(5)} ETH (40%)`, `${signal.tokenSymbol} — konfirmasi harga stabil`);
                            await this.executeBuy(tokenAddress, secondAmt, undefined, 'smart-screener-2nd');
                        }
                        else {
                            const reason = !pos ? 'posisi ditutup' : 'TP1 sudah terpicu';
                            console.log(`   📊 Staged entry 2/2 dilewati untuk ${signal.tokenSymbol} — ${reason}`);
                            this.addLog('info', `📊 Tranche ke-2 dilewati (${reason})`, signal.tokenSymbol);
                        }
                    }
                    catch (e) {
                        console.warn(`   ⚠️ Staged entry 2/2 error: ${e?.message}`);
                    }
                }, 45000);
            }
            else {
                console.log(`   ❌ AI rejected screener signal: ${analysis.reasoning}`);
                this.addLog('info', `📡 Screener rejected by AI: ${signal.tokenSymbol}`, analysis.reasoning);
            }
        });
        // ─── GeckoTerminal token opportunity ───
        this.geckoScanner.on('token-opportunity', async (opportunity) => {
            // ── Hard circuit breaker: daily loss limit ──
            if (this.riskManager.isCircuitBreakerTripped()) {
                console.log(`🔴 [CircuitBreaker] GeckoScanner signal ignored — ${this.riskManager.getCircuitBreakerReason()}`);
                return;
            }
            // ── Hard circuit breaker: max open positions ──
            const openCountGecko = this.executor?.getOpenPositions().length ?? 0;
            if (openCountGecko >= this.CONFIG.MAX_OPEN_POSITIONS) {
                console.log(`⚠️  [CircuitBreaker] Max positions (${openCountGecko}/${this.CONFIG.MAX_OPEN_POSITIONS}) — GeckoScanner signal ignored`);
                return;
            }
            const tokenAddress = opportunity.tokenAddress;
            console.log(`\n🦎 GeckoScanner opportunity: ${opportunity.tokenSymbol}`);
            const analysis = await this.ai.analyzeToken(tokenAddress, {
                liquidity: opportunity.liquidityEth,
                volume24h: opportunity.volumeH24,
                ageSeconds: opportunity.ageMinutes * 60,
                priceChangeH1: opportunity.priceChangeH1,
                buyTxH1: opportunity.buyTxH1,
                sellTxH1: opportunity.sellTxH1,
                fdvUsd: opportunity.fdvUsd,
            });
            console.log(`   🤖 AI: ${analysis.recommendation} (${analysis.confidence}%)`);
            if (this.shouldBuy(analysis)) {
                const amount = await this.calculateDynamicAmount(analysis.confidence);
                if (amount <= 0) {
                    console.log(`   ⛔ Saldo tidak cukup — skip GeckoScanner buy`);
                    return;
                }
                console.log(`   ✅ GeckoScanner BUY: ${amount.toFixed(5)} ETH for ${opportunity.tokenSymbol}`);
                this.addLog('info', `🦎 GeckoScanner buy: ${opportunity.tokenSymbol}`, `liq: $${opportunity.liquidityUsd.toLocaleString()} | ${analysis.confidence}% confidence`);
                await this.sendTelegram(`🦎 <b>GeckoTerminal Opp!</b>\n` +
                    `Token: <code>${opportunity.tokenSymbol}</code> (${opportunity.source})\n` +
                    `💧 Liq: $${opportunity.liquidityUsd.toLocaleString()}\n` +
                    `📈 1h: ${opportunity.priceChangeH1 >= 0 ? '+' : ''}${opportunity.priceChangeH1.toFixed(1)}%\n` +
                    `🤖 AI: ${analysis.confidence}% confidence\n` +
                    `💰 Buy: ${amount.toFixed(5)} ETH`);
                await this.executeBuy(tokenAddress, amount, undefined, 'gecko-scanner');
            }
        });
        // ─── Executor events ───
        this.wireExecutorEvents();
        // ─── Paper trading: wire to SmartScreener buy-signal ───
        this.smartScreener.on('buy-signal', async (signal) => {
            if (signal.signal === 'STRONG_BUY' || signal.signal === 'BUY') {
                await paper_trader_1.paperTrader.openPosition(signal.tokenAddress, signal.tokenSymbol || signal.tokenAddress.slice(0, 8), 'screener', signal.dexUrl);
            }
        });
        // ─── Paper trading: wire to GeckoScanner token-opportunity ───
        this.geckoScanner.on('token-opportunity', async (opportunity) => {
            const dexUrl = opportunity.pairAddress
                ? `https://www.geckoterminal.com/base/pools/${opportunity.pairAddress}`
                : undefined;
            await paper_trader_1.paperTrader.openPosition(opportunity.tokenAddress, opportunity.tokenSymbol || opportunity.tokenAddress.slice(0, 8), 'gecko', dexUrl);
        });
        // ─── Feature: Smart Screener STRONG_BUY Telegram notifications ───
        // ─── Log koin yang dilewati (stagnan / dump / tax naik) ke dashboard ───
        this.smartScreener.on('skipped', (d) => {
            this.addLog('info', `🧊 Dilewati: ${d.symbol}`, d.reason);
        });
        this.smartScreener.on('signal', (sig) => {
            // Persist all BUY-grade signals to DB for history tab
            if (sig.signal === 'STRONG_BUY' || sig.signal === 'BUY' || sig.signal === 'WATCH') {
                (0, db_1.dbSaveScreenerSignal)({
                    tokenAddr: sig.tokenAddress ?? '',
                    symbol: sig.tokenSymbol ?? sig.tokenAddress?.slice(0, 8) ?? '',
                    signal: sig.signal,
                    scoreTotal: sig.score?.total ?? 0,
                    liqUsd: sig.liquidityUsd ?? 0,
                    volH24: sig.volumeH24 ?? 0,
                    priceChgH1: sig.priceChangeH1 ?? 0,
                    buyTxH1: sig.buyTxH1 ?? 0,
                    ageMinutes: sig.ageMinutes ?? 0,
                    dexUrl: sig.dexUrl ?? '',
                    source: sig.source ?? '',
                    discoveredAt: sig.discoveredAt ?? Date.now(),
                });
            }
            if (sig.signal !== 'STRONG_BUY')
                return;
            this.addLog('info', `📡 STRONG BUY: ${sig.tokenSymbol || sig.tokenAddress?.slice(0, 8)}`, `Score: ${sig.score?.total ?? '?'}/100`);
            const sym = sanitizeTg(sig.tokenSymbol || 'UNKNOWN');
            const addr = sig.tokenAddress || '';
            const score = sig.score?.total ?? '?';
            const liqUsd = sig.liquidityUsd ? `$${Number(sig.liquidityUsd).toLocaleString('en', { maximumFractionDigits: 0 })}` : '?';
            const ch1h = sig.priceChangeH1 != null ? `${sig.priceChangeH1 >= 0 ? '+' : ''}${Number(sig.priceChangeH1).toFixed(1)}%` : '?';
            const ageMins = sig.ageMinutes != null ? `${sig.ageMinutes} menit` : '?';
            const buyTax = sig.buyTax != null ? `${sig.buyTax}%` : '?';
            const sellTax = sig.sellTax != null ? `${sig.sellTax}%` : '?';
            const geckoLink = sig.dexUrl ? `<a href="${sig.dexUrl}">GeckoTerminal</a>` : 'GeckoTerminal';
            const bscanLink = addr ? `<a href="https://basescan.org/token/${addr}">BaseScan</a>` : '';
            this.sendTelegram(`🔥 <b>STRONG BUY Signal!</b>\n\n` +
                `🪙 Token: <b>${sym}</b>\n` +
                (addr ? `<code>${addr}</code>\n` : '') +
                `📊 Score: <b>${score}/100</b>\n` +
                `💧 Likuiditas: <b>${liqUsd}</b>\n` +
                `📈 1 jam: <b>${ch1h}</b>\n` +
                `⏱️ Usia Pool: ${ageMins}\n` +
                `🛡️ Tax B/S: ${buyTax}/${sellTax}\n\n` +
                `🔗 ${geckoLink}${bscanLink ? ` | ${bscanLink}` : ''}`);
        });
        // ─── Periodic market sentiment ───
        this.sentimentInterval = setInterval(async () => {
            const sentiment = await this.ai.getMarketSentiment();
            console.log(`\n📊 Market Sentiment: ${sentiment.sentiment}/100 | Gas: ${sentiment.gasAdvice}`);
        }, 300000);
        // ─── Portfolio summary every 30 min ───
        this.portfolioSummaryInterval = setInterval(async () => {
            if (!this.telegramToken || !this.telegramChatId)
                return;
            try {
                const positions = this.executor?.getOpenPositions() ?? [];
                const history = this.getTradeHistory();
                const balance = await this.executor?.getBalance();
                const ethBal = balance?.eth ?? '?';
                const ethPrice = await (0, price_oracle_1.getEthPriceUsd)().catch(() => 3000);
                const balUsd = parseFloat(ethBal) * ethPrice;
                const wins = history.trades.filter((t) => (t.profitPct ?? 0) > 0).length;
                const losses = history.trades.filter((t) => (t.profitPct ?? 0) < 0).length;
                const totalPnl = history.trades.reduce((s, t) => s + (t.profitPct ?? 0), 0);
                const posLines = positions.length > 0
                    ? positions.map((p) => `  • ${p.tokenSymbol || p.tokenAddress?.slice(0, 8)}`).join('\n')
                    : '  (tidak ada posisi terbuka)';
                await this.sendTelegram(`📊 <b>Ringkasan 30 Menit</b>\n\n` +
                    `💰 Saldo: <b>${parseFloat(ethBal).toFixed(5)} ETH</b> (~$${balUsd.toFixed(2)})\n` +
                    `📂 Posisi aktif: ${positions.length}\n${posLines}\n\n` +
                    `📈 Trade: ${wins + losses} total (✅${wins} ❌${losses})\n` +
                    `💹 Total P&L: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(1)}%`);
            }
            catch { /* silent */ }
        }, 30 * 60000);
        // ─── Tax Guard: cek sell tax setiap 90 detik untuk posisi terbuka ───
        // Jika sell tax tiba-tiba naik (mis: 0% → 30%), langsung jual panik.
        // Ini melindungi dari "upgrade rug" — owner naikkan tax setelah bot beli.
        const TAX_GUARD_LIMIT = 15; // sell tax > 15% = jual langsung
        this.taxGuardInterval = setInterval(async () => {
            if (!this.executor)
                return;
            const positions = this.executor.getOpenPositions();
            if (positions.length === 0)
                return;
            for (const pos of positions) {
                try {
                    const { default: axios } = await Promise.resolve().then(() => __importStar(require('axios')));
                    const res = await axios.get(`https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${pos.tokenAddress}`, { timeout: 5000 });
                    const data = res.data?.result?.[pos.tokenAddress.toLowerCase()];
                    if (!data)
                        continue;
                    const sellTax = parseFloat(data.sell_tax || '0');
                    const isHoneypot = data.is_honeypot === '1';
                    const cannotSell = data.cannot_sell_all === '1';
                    if (isHoneypot || cannotSell || sellTax > TAX_GUARD_LIMIT) {
                        const reason = isHoneypot ? 'HONEYPOT terdeteksi!' :
                            cannotSell ? 'Cannot sell all — rug!' :
                                `Sell tax naik ke ${sellTax.toFixed(0)}%!`;
                        console.log(`\n🚨 [TaxGuard] ${pos.tokenSymbol || pos.tokenAddress.slice(0, 8)}: ${reason}`);
                        console.log(`   ⚡ Auto-exit PANIK — jual semua sekarang!`);
                        this.addLog('info', `🚨 TaxGuard EXIT: ${pos.tokenSymbol || pos.tokenAddress.slice(0, 8)}`, reason);
                        await this.sendTelegram(`🚨 <b>TAX GUARD — AUTO EXIT!</b>\n\n` +
                            `Token: <b>${sanitizeTg(pos.tokenSymbol || pos.tokenAddress.slice(0, 8))}</b>\n` +
                            `⚠️ ${sanitizeTg(reason)}\n` +
                            `⚡ Menjual semua posisi sekarang...`);
                        await this.executor.sell(pos.tokenAddress, 100);
                    }
                }
                catch { /* API error — lewati, jangan panic */ }
            }
        }, 90000);
    }
    wireExecutorEvents() {
        if (!this.executor)
            return;
        this.executor.on('buy-success', (d) => {
            this.emit('buy-success', d);
            this.addLog('buy-success', `BUY ${d.tokenSymbol}`, `TX: ${d.txHash?.slice(0, 18)}...`);
            const amtEth = d.amountIn ? parseFloat(d.amountIn.toString()) / 1e18 : 0;
            (0, push_manager_1.pushBuySuccess)(d.tokenSymbol || 'TOKEN', amtEth, d.txHash);
            const sourceWalletLine = d.sourceWallet ? `🐋 Copy dari: <b>${sanitizeTg(d.sourceWallet)}</b>\n` : '';
            const tokenAddrLine = d.tokenAddress
                ? `<code>${d.tokenAddress}</code> | <a href="https://basescan.org/token/${d.tokenAddress}">Info Token</a>\n`
                : '';
            (0, price_oracle_1.getEthPriceUsd)().then(ethPrice => {
                this.sendTelegram(`✅ <b>BUY Berhasil!</b>\n\n` +
                    sourceWalletLine +
                    `🪙 Token: <b>${sanitizeTg(d.tokenSymbol || 'UNKNOWN')}</b>\n` +
                    tokenAddrLine +
                    `\n💰 Modal: <b>${amtEth.toFixed(5)} ETH</b> (~${fmtUsd(amtEth, ethPrice)})\n` +
                    `🔗 <a href="https://basescan.org/tx/${d.txHash}">Lihat TX di Basescan</a>`);
            }).catch(() => {
                this.sendTelegram(`✅ <b>BUY Berhasil!</b>\n\n` +
                    sourceWalletLine +
                    `🪙 Token: <b>${sanitizeTg(d.tokenSymbol || 'UNKNOWN')}</b>\n` +
                    tokenAddrLine +
                    `\n💰 Modal: <b>${amtEth.toFixed(5)} ETH</b>\n` +
                    `🔗 <a href="https://basescan.org/tx/${d.txHash}">Lihat TX di Basescan</a>`);
            });
        });
        this.executor.on('buy-failed', (d) => {
            this.emit('buy-failed', d);
            this.addLog('buy-failed', `BUY gagal: ${d.tokenAddress?.slice(0, 10)}...`, d.error);
            this.sendTelegram(`❌ <b>BUY GAGAL</b>\n` +
                `Token: <code>${d.tokenAddress?.slice(0, 10)}...</code>\n` +
                `Alasan: ${sanitizeTg(d.error || 'Unknown error')}`);
        });
        this.executor.on('sell-success', (d) => {
            this.emit('sell-success', d);
            this.addLog('sell-success', `SELL ${d.tokenSymbol} (${d.percentSold}%)`, `TX: ${d.txHash?.slice(0, 18)}...`);
            // Update risk manager exactly once — after actual sell succeeds (not when exit is triggered)
            if ((d.percentSold ?? 100) >= 100 && d.profitPct != null) {
                const entryEth = d.entryEth ?? this.runtimeConfig.maxTradeAmount;
                const profitEth = (d.profitPct / 100) * entryEth;
                this.riskManager.afterTrade(profitEth);
            }
            const tradeSource = d.source || 'manual';
            (0, db_1.dbInsertTrade)({
                id: (0, crypto_1.randomBytes)(6).toString('hex'),
                tokenAddress: d.tokenAddress || '',
                tokenSymbol: d.tokenSymbol || 'UNKNOWN',
                entryEth: d.entryEth ?? 0,
                profitPct: d.profitPct ?? null,
                percentSold: d.percentSold ?? 100,
                closedAt: Date.now(),
                holdMs: d.holdMs ?? 0,
                txHash: d.txHash || '',
                reason: tradeSource,
                tpLevel: d.tpLevel,
            });
            if (tradeSource === 'manual') {
                this.sendTelegram(`💰 <b>SELL manual</b>\n` +
                    `Token: <code>${d.tokenSymbol}</code> (${d.percentSold}%)\n` +
                    `TX: <a href="https://basescan.org/tx/${d.txHash}">${d.txHash?.slice(0, 18)}...</a>`);
            }
        });
        this.executor.on('take-profit', (d) => {
            this.emit('take-profit', d);
            this.addLog('take-profit', `TP${d.level} ${d.tokenSymbol} @ ${d.multiplier?.toFixed(2)}x`, 'Auto take profit triggered');
            const tpProfitPct = d.profitPct ?? (d.multiplier ? (d.multiplier - 1) * 100 : 0);
            (0, push_manager_1.pushTakeProfit)(d.tokenSymbol || 'TOKEN', d.level, tpProfitPct, d.multiplier);
            // Trade is recorded by sell-success handler (single source of truth — prevents double recording)
            // ── Auto-compound: add profit back to totalCapital on full exit (TP2) ──
            if (this.runtimeConfig.autoCompoundEnabled && d.level === 2 && (d.profitPct ?? 0) > 0) {
                const entryEth = d.entryEth ?? this.runtimeConfig.maxTradeAmount;
                const profitEth = (d.profitPct / 100) * entryEth;
                const newCapital = parseFloat((this.runtimeConfig.totalCapital + profitEth).toFixed(6));
                this.runtimeConfig.totalCapital = newCapital;
                this.riskManager.updateLimits(this.runtimeConfig.maxDailyLossEth, this.runtimeConfig.maxConsecutiveLosses, this.runtimeConfig.cooldownAfterProfitMinutes, this.runtimeConfig.dailyLossCooldownHours);
                try {
                    (0, db_1.dbSaveRuntimeConfig)(this.runtimeConfig);
                }
                catch { /* non-critical */ }
                try {
                    (0, config_store_1.saveTradingConfig)({ totalCapital: newCapital });
                }
                catch { /* non-critical */ }
                this.addLog('info', `💰 Auto-compound +${profitEth.toFixed(5)} ETH`, `Modal baru: ${newCapital.toFixed(5)} ETH`);
                this.sendTelegram(`♻️ <b>Auto-Compound Aktif!</b>\n\n` +
                    `🪙 Token: <b>${sanitizeTg(d.tokenSymbol || 'UNKNOWN')}</b>\n` +
                    `🎯 TP2 Profit: <b>+${d.profitPct.toFixed(1)}%</b>\n` +
                    `📈 Profit dikompound: <b>+${profitEth.toFixed(5)} ETH</b>\n` +
                    `💼 Modal baru: <b>${newCapital.toFixed(5)} ETH</b>`);
            }
            const holdStrTp = d.holdMs ? fmtHoldTime(d.holdMs) : '?';
            const profitPctTp = d.profitPct ?? (d.multiplier ? (d.multiplier - 1) * 100 : 0);
            const srcLineTp = d.sourceWallet ? `🐋 Whale: <b>${sanitizeTg(d.sourceWallet)}</b>\n` : '';
            const addrLineTp = d.tokenAddress
                ? `<code>${d.tokenAddress}</code> | <a href="https://basescan.org/token/${d.tokenAddress}">Info Token</a>\n`
                : '';
            this.sendTelegram(`🎯 <b>TAKE PROFIT TP${d.level}!</b>\n\n` +
                `🪙 Token: <b>${sanitizeTg(d.tokenSymbol || 'UNKNOWN')}</b>\n` +
                addrLineTp +
                srcLineTp +
                `\n📈 Profit: <b>+${profitPctTp.toFixed(1)}%</b> (${d.multiplier?.toFixed(2) ?? '?'}x)\n` +
                `⏱️ Hold: ${holdStrTp}\n` +
                (d.txHash ? `🔗 <a href="https://basescan.org/tx/${d.txHash}">Lihat TX di Basescan</a>` : ''));
        });
        this.executor.on('stop-loss', (d) => {
            this.emit('stop-loss', d);
            this.addLog('stop-loss', `Stop Loss ${d.tokenSymbol} @ ${d.profitPct?.toFixed(1)}%`, d.reason || 'Auto stop loss triggered');
            (0, push_manager_1.pushStopLoss)(d.tokenSymbol || 'TOKEN', d.profitPct ?? 0, d.reason);
            // Risk manager is updated by sell-success handler (after actual TX confirms)
            if (d.tokenAddress) {
                (0, db_1.dbAddToBlacklist)(d.tokenAddress.toLowerCase(), 'Stop Loss auto-blacklist');
                this.addLog('info', `Auto-blacklisted: ${d.tokenSymbol}`, 'Hit stop loss');
            }
            // Trade is recorded by sell-success handler (single source of truth — prevents double recording)
            const isEmergency = d.reason?.startsWith('🚨');
            const isTimeout = d.reason?.startsWith('⏰');
            const isTrailing = d.reason?.includes('Trailing');
            const icon = isEmergency ? '🚨' : isTimeout ? '⏰' : '🛑';
            const title = isEmergency ? 'EMERGENCY EXIT (Rug!)' : isTimeout ? 'TIMEOUT EXIT' : isTrailing ? 'TRAILING STOP LOSS' : 'STOP LOSS';
            const holdStrSl = d.holdMs ? fmtHoldTime(d.holdMs) : '?';
            const srcLineSl = d.sourceWallet ? `🐋 Whale: <b>${sanitizeTg(d.sourceWallet)}</b>\n` : '';
            const addrLineSl = d.tokenAddress
                ? `<code>${d.tokenAddress}</code> | <a href="https://basescan.org/token/${d.tokenAddress}">Info Token</a>\n`
                : '';
            this.sendTelegram(`${icon} <b>${title}</b>\n\n` +
                `🪙 Token: <b>${sanitizeTg(d.tokenSymbol || 'UNKNOWN')}</b>\n` +
                addrLineSl +
                srcLineSl +
                `\n📉 P&L: <b>${(d.profitPct ?? 0) >= 0 ? '+' : ''}${d.profitPct?.toFixed(1) ?? '?'}%</b>\n` +
                `⏱️ Hold: ${holdStrSl}\n` +
                `💡 Reason: ${sanitizeTg(d.reason || 'Fixed SL')}\n` +
                (d.tokenAddress ? `🚫 <i>Token di-blacklist otomatis</i>` : ''));
        });
        this.executor.on('dca-signal', async (d) => {
            if (this.riskManager.isCircuitBreakerTripped()) {
                console.log(`🚫 [DCA] Circuit breaker active (${this.riskManager.getCircuitBreakerReason()}) — skipping DCA`);
                return;
            }
            const openCount = this.executor?.getOpenPositions().length ?? 0;
            if (openCount >= this.CONFIG.MAX_OPEN_POSITIONS) {
                console.log(`⚠️  [DCA] Max positions reached (${openCount}/${this.CONFIG.MAX_OPEN_POSITIONS}) — skipping DCA`);
                return;
            }
            console.log(`\n📉 DCA signal: ${d.tokenSymbol}`);
            const dcaAmount = await this.calculateDynamicAmount();
            this.addLog('info', `DCA: rebuy ${dcaAmount.toFixed(5)} ETH ${d.tokenSymbol}`, 'Auto DCA');
            await this.executeBuy(d.tokenAddress, dcaAmount);
            this.sendTelegram(`📉 <b>DCA triggered</b>\nToken: <code>${d.tokenSymbol}</code>\nAmount: ${dcaAmount.toFixed(5)} ETH`);
        });
    }
    // ============ TRADE DECISION ============
    shouldBuy(analysis) {
        if (!this.runtimeConfig.aiEnabled)
            return true; // AI disabled = always try
        if (analysis.recommendation !== 'BUY')
            return false;
        if (analysis.riskLevel === 'CRITICAL')
            return false;
        // Rule-based (tidak ada AI key) → threshold 15, screener sudah jadi quality gate.
        // Real AI key → gunakan minAiConfidence penuh dari config.
        const isRuleBased = typeof analysis.reasoning === 'string' && analysis.reasoning.startsWith('Rule-based:');
        const threshold = isRuleBased ? 15 : this.runtimeConfig.minAiConfidence;
        if (analysis.confidence < threshold)
            return false;
        // Dynamic profit threshold: semakin tinggi confidence, semakin longgar batas profit
        const minProfit = analysis.confidence >= 85 ? 5 : analysis.confidence >= 75 ? 10 : 15;
        if (analysis.predictedProfit < minProfit)
            return false;
        const openCount = this.executor?.getOpenPositions().length ?? 0;
        if (openCount >= this.CONFIG.MAX_OPEN_POSITIONS) {
            console.log(`   ⚠️  Position cap reached (${openCount}/${this.CONFIG.MAX_OPEN_POSITIONS}) — skip`);
            return false;
        }
        return true;
    }
    // ============ EXECUTION ============
    async executeBuy(tokenAddress, amountEth, sourceWallet, reason) {
        if (!this.executor) {
            console.warn('   ⚠️  Live trading disabled');
            return;
        }
        // ── Risk manager gate ──
        const riskGate = this.riskManager.beforeTrade({});
        if (!riskGate.allowed) {
            console.log(`   🚫 [RiskManager] ${riskGate.reason}`);
            this.addLog('info', `Trade diblokir risk manager`, riskGate.reason);
            if (this.tgBot) {
                const alertType = riskGate.reason?.includes('Daily') ? 'daily_loss' :
                    riskGate.reason?.includes('consecutive') ? 'consecutive_loss' :
                        riskGate.reason?.includes('Cooldown') ? 'cooldown' : 'blocked';
                this.tgBot.sendRiskAlert(alertType, riskGate.reason || '');
            }
            // If the circuit breaker just tripped, send a hard-stop Telegram alert
            if (this.riskManager.isCircuitBreakerTripped()) {
                const resetTime = new Date(this.riskManager.getState().dailyResetAt)
                    .toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
                await this.sendTelegram(`🔴 <b>CIRCUIT BREAKER AKTIF</b>\n\n` +
                    `${riskGate.reason}\n\n` +
                    `🛑 Semua sinyal baru akan <b>diabaikan</b> hingga reset tengah malam.\n` +
                    `⏰ Reset pada: <b>${resetTime} UTC</b>`);
            }
            return;
        }
        // ── Trading schedule gate ──
        if (!this.isWithinTradingHours()) {
            const s = this.runtimeConfig.tradingStartHour;
            const e = this.runtimeConfig.tradingEndHour;
            console.log(`   🕐 [Schedule] Diluar jam trading (${s}:00–${e}:00 WIB) — skip`);
            this.addLog('info', 'Trade diblokir jadwal', `Jam aktif: ${s.toString().padStart(2, '0')}:00–${e.toString().padStart(2, '0')}:00 WIB`);
            return;
        }
        if ((0, db_1.dbIsBlacklisted)(tokenAddress.toLowerCase())) {
            console.log(`   🚫 Token blacklisted — skip`);
            return;
        }
        // ── Serial rugger check ──
        if (this.runtimeConfig.serialRuggerEnabled) {
            const sr = await (0, deployer_checker_1.checkSerialDeployer)(tokenAddress, this.runtimeConfig.serialRuggerMaxDeploys, this.runtimeConfig.serialRuggerWindowHours);
            if (sr.isSerialRugger) {
                console.log(`   🚨 SERIAL RUGGER: ${sr.deployer} → skip`);
                this.addToBlacklist(tokenAddress, `Serial rugger`);
                return;
            }
        }
        // ── Reputation check ──
        if (this.runtimeConfig.reputationEnabled) {
            const deployer = await (0, deployer_checker_1.getTokenDeployer)(tokenAddress);
            if (deployer) {
                const rep = await (0, deployer_reputation_1.getDeployerReputation)(deployer);
                if (rep.score !== null && rep.score < this.runtimeConfig.reputationMinScore) {
                    console.log(`   🔴 LOW REPUTATION: ${rep.score}/100 → skip`);
                    this.addLog('info', `🔴 Reputasi deployer rendah: ${rep.score}/100`, '');
                    return;
                }
            }
        }
        // ── Honeypot check ──
        const safety = await this.checkHoneypot(tokenAddress);
        if (!safety.safe) {
            console.log(`   🚫 UNSAFE: ${safety.reason} — skip`);
            this.addLog('info', `Token tidak aman: ${safety.reason}`, tokenAddress);
            return;
        }
        const result = await this.executor.buy({ tokenAddress, amountInEth: amountEth, sourceWallet });
        if (result.success) {
            console.log(`   ✅ BUY SUCCESS | TX: ${result.txHash}`);
        }
        else {
            console.error(`   ❌ BUY FAILED: ${result.error}`);
        }
    }
    // ============ LIFECYCLE ============
    async start() {
        // Load persisted settings from DB before printing config
        this.loadPersistedSettings();
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🤖 AI-POWERED BASE SNIPER ULTIMATE');
        console.log(`💰 Modal: ${this.runtimeConfig.totalCapital} ETH`);
        console.log(`💼 Wallet: ${this.executor?.getWalletAddress() ?? 'NOT CONFIGURED'}`);
        console.log(`📊 Dynamic Sizing: ${this.runtimeConfig.dynamicSizingEnabled ? `✅ (${this.runtimeConfig.tradeBalancePct}% per trade)` : '❌'}`);
        console.log(`🦎 GeckoTerminal Scanner: ${this.runtimeConfig.geckoScannerEnabled ? '✅' : '❌'}`);
        console.log(`📡 Smart Screener: ${this.smartScreenerEnabled ? '✅' : '❌'}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        const health = this.ai.healthCheck();
        console.log(`🔍 AI: Groq=${health.groq ? '✅' : '❌'} Gemini=${health.gemini ? '✅' : '❌'} HF=${health.huggingface ? '✅' : '❌'}\n`);
        // ── Restore known tokens from DB trade history ──
        if (this.executor) {
            const WETH_BASE = '0x4200000000000000000000000000000000000006';
            this.executor.addKnownToken(WETH_BASE);
            const recentTrades = (0, db_1.dbGetTrades)(200);
            const restored = new Set();
            for (const t of recentTrades) {
                const addr = t.tokenAddress?.toLowerCase();
                if (addr && addr.startsWith('0x') && !restored.has(addr)) {
                    this.executor.addKnownToken(addr);
                    restored.add(addr);
                }
            }
            if (restored.size > 0) {
                console.log(`📦 Restored ${restored.size} token(s) from trade history into portfolio scanner`);
            }
        }
        // Restore activity logs from DB so they survive server restarts
        this.loadLogsFromDb();
        await this.scanner.connect();
        if (this.runtimeConfig.geckoScannerEnabled) {
            this.geckoScanner.start();
        }
        if (this.smartScreenerEnabled) {
            this.smartScreener.start();
        }
        this.tgBot = (0, telegram_bot_1.startTelegramBot)(this);
        setInterval(() => this.printPerformanceReport(), 3600000);
        // ── Feature 10: Schedule daily P&L report ──
        this.scheduleDailyReport();
        console.log('✅ AI SNIPER RUNNING\n');
    }
    async stop() {
        if (this.sentimentInterval) {
            clearInterval(this.sentimentInterval);
            this.sentimentInterval = null;
        }
        if (this.dailyReportTimer) {
            clearTimeout(this.dailyReportTimer);
            this.dailyReportTimer = null;
        }
        if (this.dailyReportInterval) {
            clearInterval(this.dailyReportInterval);
            this.dailyReportInterval = null;
        }
        this.tgBot?.stop();
        this.scanner.disconnect();
        this.geckoScanner.stop();
        this.smartScreener.stop();
        this.executor?.stop();
        console.log('🛑 AI Sniper stopped');
    }
    async printPerformanceReport() {
        const aiStats = this.ai.getStats();
        const positions = this.executor?.getOpenPositions() ?? [];
        console.log('\n📊 PERFORMANCE REPORT');
        for (const [provider, stats] of Object.entries(aiStats.providers)) {
            if (stats) {
                const s = stats;
                console.log(`${provider.toUpperCase()}: ✓${s.success} ✗${s.fail} | ~${s.avgLatency.toFixed(0)}ms`);
            }
        }
        console.log(`Open Positions: ${positions.length}`);
        console.log(`GeckoScanner seen: ${this.geckoScanner.getSeenCount()} tokens`);
    }
    // ============ RUNTIME CONFIG UPDATE ============
    updateRuntimeConfig(s) {
        const r = this.runtimeConfig;
        if (s.totalCapital != null)
            r.totalCapital = s.totalCapital;
        if (s.maxTradeAmount != null)
            r.maxTradeAmount = s.maxTradeAmount;
        if (s.minLiquidity != null)
            r.minLiquidity = s.minLiquidity;
        if (s.maxSlippage != null)
            r.maxSlippage = s.maxSlippage;
        if (s.tp1Multiplier != null)
            r.tp1Multiplier = s.tp1Multiplier;
        if (s.tp1Percentage != null)
            r.tp1Percentage = s.tp1Percentage;
        if (s.tp2Multiplier != null)
            r.tp2Multiplier = s.tp2Multiplier;
        if (s.tp2Percentage != null)
            r.tp2Percentage = s.tp2Percentage;
        if (s.stopLoss != null)
            r.stopLoss = s.stopLoss;
        if (s.maxPriorityFee != null)
            r.maxPriorityFee = s.maxPriorityFee;
        if (s.maxFeePerGas != null)
            r.maxFeePerGas = s.maxFeePerGas;
        if (s.minSafetyScore != null)
            r.minSafetyScore = s.minSafetyScore;
        if (s.maxPoolAgeSeconds != null)
            r.maxPoolAgeSeconds = s.maxPoolAgeSeconds;
        if (s.aiEnabled != null)
            r.aiEnabled = s.aiEnabled;
        if (s.dcaEnabled != null)
            r.dcaEnabled = s.dcaEnabled;
        if (s.serialRuggerEnabled != null)
            r.serialRuggerEnabled = s.serialRuggerEnabled;
        if (s.serialRuggerMaxDeploys != null)
            r.serialRuggerMaxDeploys = s.serialRuggerMaxDeploys;
        if (s.serialRuggerWindowHours != null)
            r.serialRuggerWindowHours = s.serialRuggerWindowHours;
        if (s.reputationEnabled != null)
            r.reputationEnabled = s.reputationEnabled;
        if (s.reputationMinScore != null)
            r.reputationMinScore = s.reputationMinScore;
        if (s.dynamicSizingEnabled != null)
            r.dynamicSizingEnabled = s.dynamicSizingEnabled;
        if (s.tradeBalancePct != null)
            r.tradeBalancePct = s.tradeBalancePct;
        if (s.geckoScannerEnabled != null) {
            r.geckoScannerEnabled = s.geckoScannerEnabled;
            if (s.geckoScannerEnabled)
                this.geckoScanner.start();
            else
                this.geckoScanner.stop();
        }
        if (s.blockHoneypot != null)
            r.blockHoneypot = s.blockHoneypot;
        if (s.blockHighTax != null)
            r.blockHighTax = s.blockHighTax;
        if (s.maxTaxPercent != null)
            r.maxTaxPercent = s.maxTaxPercent;
        if (s.minAiConfidence != null)
            r.minAiConfidence = s.minAiConfidence;
        if (s.enableFlashblocks != null)
            r.enableFlashblocks = s.enableFlashblocks;
        if (s.gasMode != null)
            r.gasMode = s.gasMode;
        if (s.maxDailyLossEth != null)
            r.maxDailyLossEth = s.maxDailyLossEth;
        if (s.maxConsecutiveLosses != null)
            r.maxConsecutiveLosses = s.maxConsecutiveLosses;
        if (s.cooldownAfterProfitMinutes != null)
            r.cooldownAfterProfitMinutes = s.cooldownAfterProfitMinutes;
        if (s.dailyLossCooldownHours != null)
            r.dailyLossCooldownHours = s.dailyLossCooldownHours;
        if (s.tradingScheduleEnabled != null)
            r.tradingScheduleEnabled = s.tradingScheduleEnabled;
        if (s.tradingStartHour != null)
            r.tradingStartHour = s.tradingStartHour;
        if (s.tradingEndHour != null)
            r.tradingEndHour = s.tradingEndHour;
        if (s.autoCompoundEnabled != null)
            r.autoCompoundEnabled = s.autoCompoundEnabled;
        // Smart Screener — independent toggle (does NOT affect geckoScannerEnabled)
        if (s.smartScreenerEnabled != null) {
            r.smartScreenerEnabled = s.smartScreenerEnabled;
            this.smartScreenerEnabled = s.smartScreenerEnabled;
            if (s.smartScreenerEnabled)
                this.smartScreener.start();
            else
                this.smartScreener.stop();
        }
        // Propagate limits to risk manager
        this.riskManager.updateLimits(r.maxDailyLossEth, r.maxConsecutiveLosses, r.cooldownAfterProfitMinutes, r.dailyLossCooldownHours);
        if (this.executor) {
            this.executor.updateConfig({
                maxSlippage: r.maxSlippage,
                tp1Multiplier: r.tp1Multiplier,
                tp1Percentage: r.tp1Percentage,
                tp2Multiplier: r.tp2Multiplier,
                tp2Percentage: r.tp2Percentage,
                stopLoss: r.stopLoss,
                maxPriorityFee: r.maxPriorityFee,
                maxFeePerGas: r.maxFeePerGas,
                dcaEnabled: r.dcaEnabled,
                gasMode: r.gasMode,
            });
        }
        // ── Persist to BOTH stores ──
        // 1. SQLite DB (immediate, highest priority on next startup)
        try {
            (0, db_1.dbSaveRuntimeConfig)(r);
        }
        catch { /* non-critical */ }
        // 2. trading-config.json (committed file, survives redeploy)
        try {
            const { _note: _, ...clean } = r;
            (0, config_store_1.saveTradingConfig)(clean);
        }
        catch { /* non-critical */ }
        this.addLog('info', 'Pengaturan diperbarui via UI', `Capital: ${r.totalCapital} ETH`);
    }
    getRuntimeConfig() { return { ...this.runtimeConfig }; }
    // ============ SMART SCREENER PUBLIC API ============
    getScreenerSignals(minSignal) {
        return this.smartScreener.getSignals(minSignal);
    }
    getScreenerStats() { return this.smartScreener.getStats(); }
    getScreenerConfig() { return this.smartScreener.getConfig(); }
    updateScreenerConfig(updates) {
        this.smartScreener.updateConfig(updates);
        try {
            (0, db_1.dbSaveScreenerConfig)(this.smartScreener.getConfig());
        }
        catch { /* non-critical */ }
        this.addLog('info', 'Screener config updated', JSON.stringify(updates));
    }
    setSmartScreenerEnabled(enabled) {
        this.smartScreenerEnabled = enabled;
        if (enabled) {
            this.smartScreener.start();
            this.addLog('info', '📡 Smart Screener AKTIF', 'Scanning new pools & trending...');
        }
        else {
            this.smartScreener.stop();
            this.addLog('info', '📡 Smart Screener NONAKTIF', '');
        }
        // Mirror to runtimeConfig + persist
        this.runtimeConfig.smartScreenerEnabled = enabled;
        try {
            (0, db_1.dbSaveRuntimeConfig)(this.runtimeConfig);
        }
        catch { /* non-critical */ }
    }
    isSmartScreenerEnabled() { return this.smartScreenerEnabled; }
    // ============ KEY MANAGEMENT ============
    updateKeys(keys) {
        const aiKeys = {};
        if (keys.groqKey) {
            aiKeys.groq = keys.groqKey;
            process.env.GROQ_API_KEY = keys.groqKey;
        }
        if (keys.geminiKey) {
            aiKeys.gemini = keys.geminiKey;
            process.env.GEMINI_API_KEY = keys.geminiKey;
        }
        if (keys.huggingfaceKey) {
            aiKeys.huggingface = keys.huggingfaceKey;
            process.env.HUGGINGFACE_API_KEY = keys.huggingfaceKey;
        }
        if (Object.keys(aiKeys).length > 0)
            this.ai.updateKeys(aiKeys);
        if (keys.telegramToken) {
            this.telegramToken = keys.telegramToken;
            process.env.TELEGRAM_BOT_TOKEN = keys.telegramToken;
        }
        if (keys.telegramChatId) {
            this.telegramChatId = keys.telegramChatId;
            process.env.TELEGRAM_CHAT_ID = keys.telegramChatId;
        }
        // ── Persist Telegram + AI keys to .runtime-keys.json ──
        // These survive server restarts (not redeployments).
        // PRIVATE_KEY is intentionally NOT saved here — it must be a Replit Secret.
        try {
            (0, config_store_1.saveRuntimeKeys)({
                groqKey: keys.groqKey,
                geminiKey: keys.geminiKey,
                huggingfaceKey: keys.huggingfaceKey,
                telegramToken: keys.telegramToken,
                telegramChatId: keys.telegramChatId,
            });
        }
        catch { /* non-critical */ }
        if (keys.privateKey) {
            process.env.PRIVATE_KEY = keys.privateKey;
            try {
                if (this.executor)
                    this.executor.stop();
                this.executor = new swap_executor_1.SwapExecutor();
                this.wireExecutorEvents();
                console.log('✅ SwapExecutor re-initialized with new private key');
                this.addLog('info', 'Wallet terhubung', `Address: ${this.executor.getWalletAddress()}`);
            }
            catch (err) {
                console.warn(`⚠️  SwapExecutor re-init failed: ${err.message}`);
                this.addLog('info', 'Wallet gagal terhubung', err.message);
            }
        }
    }
    // ============ LIVE PnL ============
    async getLivePnL() {
        if (!this.executor)
            return [];
        return this.executor.getLivePnL();
    }
    async manualSell(tokenAddress, percent) {
        if (!this.executor)
            return { success: false, error: 'Executor belum siap' };
        const pct = Math.max(1, Math.min(100, Math.round(percent)));
        const result = await this.executor.sell(tokenAddress, pct);
        if (result.success)
            this.addLog('sell-success', `Manual sell ${pct}%`, tokenAddress);
        else
            this.addLog('info', `Manual sell gagal: ${result.error}`, tokenAddress);
        return { success: result.success, txHash: result.txHash, error: result.error };
    }
    async getPortfolio() {
        if (!this.executor)
            return { ethBalance: '0', ethValueUsd: 0, tokens: [], totalValueEth: 0, totalValueUsd: 0 };
        return this.executor.getPortfolioData();
    }
    async sendFunds(type, to, amount, tokenAddress, decimals) {
        if (!this.executor)
            return { success: false, error: 'Executor belum siap' };
        if (type === 'eth')
            return this.executor.sendEth(to, amount);
        if (!tokenAddress)
            return { success: false, error: 'tokenAddress diperlukan' };
        return this.executor.sendToken(tokenAddress, to, amount, decimals ?? 18);
    }
    async scanWalletHistory() {
        if (!this.executor)
            return { found: [], totalScanned: 0, errors: ['Bot not ready'] };
        return this.executor.scanWalletHistory();
    }
    getTradeHistory() {
        const trades = (0, db_1.dbGetTrades)(200);
        const withPnl = trades.filter(t => t.profitPct !== null && t.profitPct !== undefined);
        const wins = withPnl.filter(t => (t.profitPct ?? 0) > 0).length;
        const losses = withPnl.filter(t => (t.profitPct ?? 0) <= 0).length;
        const winRate = withPnl.length > 0 ? (wins / withPnl.length) * 100 : 0;
        const totalPnl = withPnl.reduce((s, t) => s + (t.profitPct ?? 0), 0);
        const sorted = [...withPnl].sort((a, b) => (b.profitPct ?? 0) - (a.profitPct ?? 0));
        return {
            trades,
            stats: { total: trades.length, wins, losses, winRate, totalProfitPct: totalPnl, bestTrade: sorted[0] ?? null, worstTrade: sorted[sorted.length - 1] ?? null }
        };
    }
    async checkDeployerReputation(address) {
        const deployer = await (0, deployer_checker_1.getTokenDeployer)(address) ?? address;
        return (0, deployer_reputation_1.getDeployerReputation)(deployer);
    }
    getBlacklist() {
        return (0, db_1.dbGetBlacklist)();
    }
    addToBlacklist(address, label) {
        (0, db_1.dbAddToBlacklist)(address.toLowerCase(), label);
        this.addLog('info', `🚫 Token diblacklist`, `${label || ''} ${address}`);
    }
    removeFromBlacklist(address) {
        (0, db_1.dbRemoveFromBlacklist)(address.toLowerCase());
        this.addLog('info', `✅ Token dihapus dari blacklist`, address);
    }
    getKeyStatus() {
        const ai = this.ai.getKeyStatus();
        return {
            privateKey: !!this.executor,
            groqKey: ai.groq,
            geminiKey: ai.gemini,
            huggingfaceKey: ai.huggingface,
            appPassword: !!(process.env.APP_PASSWORD),
            telegramToken: !!(this.telegramToken),
            telegramChatId: !!(this.telegramChatId),
            backupHttpUrl: !!(process.env.BACKUP_HTTP_URL),
            backupWssUrl: !!(process.env.BACKUP_WSS_URL),
            basescanApiKey: !!(process.env.BASESCAN_API_KEY),
        };
    }
    // ============ RISK MANAGER PUBLIC API ============
    getRiskState() { return this.riskManager.getState(); }
    // ============ CACHE STATS ============
    getPerfCacheStats() { return (0, performance_optimizer_1.getCacheStats)(); }
    // ============ WHALE DETAIL ANALYSIS ============
    async analyzeWhaleDetail(_address) {
        return { error: 'Feature removed' };
    }
    // ============ FEATURE 9: EMERGENCY STOP ============
    async emergencyStop() {
        console.log('\n🚨🚨🚨 EMERGENCY STOP TRIGGERED 🚨🚨🚨');
        this.emergencyStopActive = true;
        if (this.sentimentInterval) {
            clearInterval(this.sentimentInterval);
            this.sentimentInterval = null;
        }
        if (this.portfolioSummaryInterval) {
            clearInterval(this.portfolioSummaryInterval);
            this.portfolioSummaryInterval = null;
        }
        if (this.taxGuardInterval) {
            clearInterval(this.taxGuardInterval);
            this.taxGuardInterval = null;
        }
        this.scanner.disconnect();
        this.geckoScanner.stop();
        this.smartScreener.stop();
        this.smartScreenerEnabled = false;
        const positions = this.executor?.getOpenPositions() ?? [];
        let sold = 0;
        if (this.executor && positions.length > 0) {
            console.log(`🛑 Menjual ${positions.length} posisi terbuka...`);
            await this.executor.sellAllPositions();
            sold = positions.length;
        }
        const msg = `🚨 <b>EMERGENCY STOP DIAKTIFKAN!</b>\n\nSemua scanner dihentikan.\n${sold} posisi terbuka dijual.\n\n<i>Restart server untuk melanjutkan trading.</i>`;
        this.addLog('info', '🚨 EMERGENCY STOP', `${sold} posisi dijual`);
        await this.sendTelegram(msg);
        return { stopped: true, positionsSold: sold, message: `Emergency stop berhasil. ${sold} posisi dijual.` };
    }
    isEmergencyStopped() { return this.emergencyStopActive; }
    // ============ FEATURE 7: TOKEN NARRATIVE DETECTOR ============
    async detectNarrative(tokenAddress, symbol, name) {
        const key = tokenAddress.toLowerCase();
        const cached = this.narrativeCache.get(key);
        if (cached && cached.expiresAt > Date.now())
            return JSON.parse(cached.data);
        const prompt = `Klasifikasikan token kripto berikut. Jawab JSON saja tanpa teks lain.\n` +
            `Token: ${symbol} (${name})\n` +
            `Pilih kategori: AI/ML, Gaming, DeFi/DEX, Meme, NFT, Social, Infrastructure, RWA, Unknown\n` +
            `Format: {"narrative":"<kategori>","confidence":<0-100>,"isHot":<true/false>,"tags":["tag1"]}\n` +
            `isHot=true jika sesuai narrative trending (AI agents, meme, Base ecosystem).`;
        try {
            const resp = await this.ai.query(prompt);
            if (resp.success) {
                const match = resp.content.match(/\{[\s\S]*?\}/);
                if (match) {
                    const parsed = JSON.parse(match[0]);
                    this.narrativeCache.set(key, { data: JSON.stringify(parsed), expiresAt: Date.now() + 3600000 });
                    return parsed;
                }
            }
        }
        catch { /* fallback */ }
        // Rule-based fallback
        const upper = (symbol + ' ' + name).toUpperCase();
        let narrative = 'Unknown';
        let isHot = false;
        const tags = [];
        if (/\bAI\b|GPT|AGENT|NEURAL|BOT\b|ML\b/.test(upper)) {
            narrative = 'AI/ML';
            isHot = true;
            tags.push('AI');
        }
        else if (/PEPE|DOGE|SHIB|MEME|FROG|CAT|DOG|TRUMP|BASED/.test(upper)) {
            narrative = 'Meme';
            isHot = true;
            tags.push('Meme');
        }
        else if (/SWAP|DEX|YIELD|FARM|LIQUID|STAKE/.test(upper)) {
            narrative = 'DeFi/DEX';
            tags.push('DeFi');
        }
        else if (/GAME|PLAY|NFT|PIXEL|META/.test(upper)) {
            narrative = 'Gaming';
            tags.push('Gaming');
        }
        else if (/BASE|L2|CHAIN|BRIDGE/.test(upper)) {
            narrative = 'Infrastructure';
            tags.push('L2');
        }
        const result = { narrative, confidence: 55, isHot, tags };
        this.narrativeCache.set(key, { data: JSON.stringify(result), expiresAt: Date.now() + 3600000 });
        return result;
    }
    getMempoolSize() { return this.scanner.getMempoolSize(); }
    // ============ FEATURE 6: BACKTEST ============
    async runBacktest(tokenAddress, timeframe = '1h', config = {}) {
        return (0, backtest_engine_1.runBacktest)(tokenAddress, timeframe, config);
    }
    // ============ FEATURE 2: FULL TOKEN SAFETY CHECK ============
    async checkFullTokenSafety(tokenAddress) {
        return (0, token_safety_1.checkTokenSafety)(tokenAddress);
    }
    // ============ FEATURE 10: DAILY P&L REPORT ============
    async getDailyPnlReport() {
        const { trades, stats } = this.getTradeHistory();
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayTrades = trades.filter((t) => (t.closedAt ?? 0) >= todayStart.getTime());
        const withPnl = todayTrades.filter((t) => t.profitPct !== null && t.profitPct !== undefined);
        const wins = withPnl.filter((t) => (t.profitPct ?? 0) > 0).length;
        const losses = withPnl.length - wins;
        const totalPnl = withPnl.reduce((s, t) => s + (t.profitPct ?? 0), 0);
        const best = withPnl.length > 0 ? Math.max(...withPnl.map((t) => t.profitPct ?? 0)) : 0;
        const worst = withPnl.length > 0 ? Math.min(...withPnl.map((t) => t.profitPct ?? 0)) : 0;
        let ethLine = '';
        if (this.executor) {
            try {
                const { eth } = await this.executor.getBalance();
                const usd = parseFloat(eth) * await (0, price_oracle_1.getEthPriceUsd)();
                ethLine = `💰 Saldo: ${parseFloat(eth).toFixed(5)} ETH (~$${usd.toFixed(2)})\n\n`;
            }
            catch { /* silent */ }
        }
        const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
        return (`📊 <b>Laporan P&L Harian — ${today}</b>\n\n` +
            ethLine +
            `📈 Trade Hari Ini: ${todayTrades.length}\n` +
            `✅ Profit: ${wins} | ❌ Rugi: ${losses}\n` +
            `💹 Total P&L: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(1)}%\n` +
            (withPnl.length > 0 ? `🏆 Terbaik: +${best.toFixed(1)}% | 📉 Terburuk: ${worst.toFixed(1)}%\n` : '') +
            `\n📅 Semua waktu: ${stats.total} trade | WR ${stats.winRate.toFixed(1)}%`);
    }
    scheduleDailyReport() {
        const now = new Date();
        const midnight = new Date(now);
        midnight.setHours(0, 0, 0, 0);
        midnight.setDate(midnight.getDate() + 1);
        const msLeft = midnight.getTime() - now.getTime();
        console.log(`📅 Daily P&L report dijadwalkan pada tengah malam (${Math.round(msLeft / 60000)} menit lagi)`);
        this.dailyReportTimer = setTimeout(() => {
            this.sendDailyReport();
            this.dailyReportInterval = setInterval(() => this.sendDailyReport(), 24 * 3600000);
        }, msLeft);
    }
    async sendDailyReport() {
        try {
            const report = await this.getDailyPnlReport();
            await this.sendTelegram(report);
            this.addLog('info', '📊 Daily P&L report terkirim ke Telegram', '');
        }
        catch (e) {
            console.error('Daily report error:', e?.message);
        }
    }
    getStatus() {
        const tradeHistory = (0, db_1.dbGetTrades)(1);
        const riskState = this.riskManager.getState();
        return {
            connected: this.scanner.isConnectedToBase(),
            config: this.scanner.getConfig(),
            aiStats: this.ai.getStats(),
            openPositions: this.executor?.getOpenPositions() ?? [],
            wallet: this.executor?.getWalletAddress() ?? null,
            geckoScanner: {
                enabled: this.runtimeConfig.geckoScannerEnabled,
                seenTokens: this.geckoScanner.getSeenCount(),
            },
            smartScreener: {
                enabled: this.smartScreenerEnabled,
            },
            riskState,
            circuitBreaker: {
                tripped: riskState.circuitBreakerTripped,
                reason: riskState.circuitBreakerReason,
                resetAt: riskState.dailyResetAt,
            },
            emergencyStop: this.emergencyStopActive,
            lastTradeAt: tradeHistory[0]?.closedAt ?? null,
            timestamp: Date.now()
        };
    }
}
exports.AISniperBot = AISniperBot;
exports.default = AISniperBot;
//# sourceMappingURL=ai-sniper-integration.js.map