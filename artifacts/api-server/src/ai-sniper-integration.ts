import { FlashblocksScanner } from './flashblocks-scanner';
import { CopyTradeMonitor } from './copy-trade-monitor';
import { MultiAIProvider } from './multi-ai-provider';
import { SwapExecutor } from './swap-executor';
import { GeckoTokenScanner, type TokenOpportunity } from './gecko-token-scanner';
import { checkSerialDeployer, getTokenDeployer } from './deployer-checker';
import { getDeployerReputation } from './deployer-reputation';
import { checkTokenSafety } from './token-safety';
import { getActiveCorrelations, checkTokenCorrelation, getCorrelationBonus } from './whale-correlator';
import { runBacktest, type BacktestConfig } from './backtest-engine';
import {
    runWhaleScan, approveCandidate, rejectCandidate, monitorCandidate,
    getPendingCandidates, getAllCandidates, simulateCopyTrade,
    formatWhaleTelegramMsg, type WhaleCandidate, type SimulationResult
} from './whale-finder';
import { whaleMonitor } from './whale-monitor';
import { getEthPriceUsd, getBestDexPair } from './price-oracle';
import {
    dbInsertTrade, dbGetTrades,
    dbAddToBlacklist, dbRemoveFromBlacklist, dbGetBlacklist, dbIsBlacklisted,
    dbAddCopyWallet, dbRemoveCopyWallet, dbGetCopyWallets, dbUpdateCopyWallet,
    dbGetPendingWhales, dbInsertWaitlistEvent,
    dbAddMonitoredWallet, dbRemoveMonitoredWallet, dbGetMonitoredWallets,
    dbGetMonitoredWallet, dbSetMonitoredVerdict, dbApproveWhale,
    dbSaveRuntimeConfig, dbLoadRuntimeConfig, dbSaveScreenerConfig, dbLoadScreenerConfig,
    type TradeRow, type MonitoredWalletRow,
} from './db';
import SmartScreener, { type ScreenerSignal, type ScreenerConfig } from './smart-screener';
import {
    loadTradingConfig, saveTradingConfig,
    loadRuntimeKeys, saveRuntimeKeys, applyRuntimeKeys,
} from './config-store';
import { startTelegramBot, type TelegramBot } from './telegram-bot';
import { pushBuySuccess, pushTakeProfit, pushStopLoss, pushWhaleMonitoring, pushWhalePromoted } from './push-manager';
import { MicroCapRiskManager } from './microcap-risk-manager';
import { getCacheStats, getEthPriceSync } from './performance-optimizer';
import { analyzeWhale } from './whale-analyzer-pro';
import type { Address } from 'viem';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import dotenv from 'dotenv';

dotenv.config();

type LogType = 'buy-success' | 'buy-failed' | 'sell-success' | 'take-profit' | 'stop-loss' | 'copy-trade' | 'info';

interface LogEntry {
    id:        string;
    type:      LogType;
    message:   string;
    detail?:   string;
    timestamp: number;
}

const MAX_LOG_ENTRIES = 100;

interface RuntimeConfig {
    totalCapital:             number;
    maxTradeAmount:           number;
    minLiquidity:             number;
    maxSlippage:              number;
    tp1Multiplier:            number;
    tp1Percentage:            number;
    tp2Multiplier:            number;
    tp2Percentage:            number;
    stopLoss:                 number;
    maxPriorityFee:           number;
    maxFeePerGas:             number;
    copyEnabled:              boolean;
    copyAmount:               number;
    copyDelay:                number;
    copyMaxPerDay:            number;
    minSafetyScore:           number;
    maxPoolAgeSeconds:        number;
    aiEnabled:                boolean;
    dcaEnabled:               boolean;
    serialRuggerEnabled:      boolean;
    serialRuggerMaxDeploys:   number;
    serialRuggerWindowHours:  number;
    reputationEnabled:        boolean;
    reputationMinScore:       number;
    // Dynamic sizing: scale trade % with balance
    dynamicSizingEnabled:     boolean;
    tradeBalancePct:          number;  // % of current balance per trade (e.g. 10 = 10%)
    // GeckoTerminal scanner
    geckoScannerEnabled:      boolean;
    // Whale validation gate
    whaleValidationEnabled:   boolean;
    whaleAutoScanEnabled:     boolean;
    // Token safety gates
    blockHoneypot:            boolean;
    blockHighTax:             boolean;
    maxTaxPercent:            number;
    // AI confidence threshold
    minAiConfidence:          number;
    // Scanner
    enableFlashblocks:        boolean;
    gasMode:                  string;
    // Circuit breaker
    maxDailyLossEth:            number;
    maxConsecutiveLosses:       number;
    cooldownAfterProfitMinutes: number;
    dailyLossCooldownHours:     number;
}

function sanitizeTg(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtHoldTime(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function fmtAddr(addr: string): string {
    if (!addr || addr.length < 10) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function fmtUsd(eth: number, ethPrice: number): string {
    return `$${(eth * ethPrice).toFixed(2)}`;
}

export class AISniperBot extends EventEmitter {
    private scanner:        FlashblocksScanner;
    private copyMonitor:    CopyTradeMonitor;
    private ai:             MultiAIProvider;
    private executor:       SwapExecutor | null = null;
    private geckoScanner:   GeckoTokenScanner;
    private smartScreener:  SmartScreener;
    private riskManager:    MicroCapRiskManager;
    private activityLog:    LogEntry[] = [];
    private telegramToken  = process.env.TELEGRAM_BOT_TOKEN || '';
    private telegramChatId = process.env.TELEGRAM_CHAT_ID   || '';
    private sentimentInterval: NodeJS.Timeout | null = null;
    private whaleAutoScanInterval: NodeJS.Timeout | null = null;
    private portfolioSummaryInterval: NodeJS.Timeout | null = null;
    private tgBot: TelegramBot | null = null;

    private emergencyStopActive   = false;
    private dailyReportTimer: NodeJS.Timeout | null = null;
    private dailyReportInterval: NodeJS.Timeout | null = null;
    private narrativeCache = new Map<string, { data: string; expiresAt: number }>();
    private smartScreenerEnabled = false;

    private runtimeConfig: RuntimeConfig = {
        totalCapital:            parseFloat(process.env.TOTAL_CAPITAL_ETH            || '0.006'),
        maxTradeAmount:          parseFloat(process.env.MAX_TRADE_AMOUNT             || '0.0006'),
        minLiquidity:            parseFloat(process.env.MIN_LIQUIDITY_ETH            || '0.15'),
        maxSlippage:             parseFloat(process.env.MAX_SLIPPAGE_PERCENT         || '15'),
        tp1Multiplier:           parseFloat(process.env.TAKE_PROFIT_1_MULTIPLIER     || '2.0'),
        tp1Percentage:           parseFloat(process.env.TAKE_PROFIT_1_PERCENTAGE     || '50'),
        tp2Multiplier:           parseFloat(process.env.TAKE_PROFIT_2_MULTIPLIER     || '5.0'),
        tp2Percentage:           parseFloat(process.env.TAKE_PROFIT_2_PERCENTAGE     || '50'),
        stopLoss:                parseFloat(process.env.STOP_LOSS_PERCENTAGE         || '20'),
        maxPriorityFee:          parseFloat(process.env.MAX_PRIORITY_FEE_GWEI        || '0.005'),
        maxFeePerGas:            parseFloat(process.env.MAX_FEE_PER_GAS_GWEI         || '0.05'),
        copyEnabled:             process.env.COPY_TRADING_ENABLED === 'true',
        copyAmount:              parseFloat(process.env.COPY_TRADING_AMOUNT          || '0.002'),
        copyDelay:               parseFloat(process.env.COPY_TRADING_DELAY_SECONDS   || '2'),
        copyMaxPerDay:           parseInt  (process.env.COPY_TRADING_MAX_PER_DAY     || '10'),
        minSafetyScore:          parseInt  (process.env.MIN_SAFETY_SCORE             || '65'),
        maxPoolAgeSeconds:       parseInt  (process.env.MAX_POOL_AGE_SECONDS         || '60'),
        aiEnabled:               process.env.AI_ENABLED === 'true',
        dcaEnabled:              process.env.DCA_ENABLED === 'true',
        serialRuggerEnabled:     process.env.SERIAL_RUGGER_ENABLED !== 'false',
        serialRuggerMaxDeploys:  parseInt(process.env.SERIAL_RUGGER_MAX_DEPLOYS  || '3'),
        serialRuggerWindowHours: parseInt(process.env.SERIAL_RUGGER_WINDOW_HOURS || '24'),
        reputationEnabled:       process.env.REPUTATION_ENABLED !== 'false',
        reputationMinScore:      parseInt(process.env.REPUTATION_MIN_SCORE || '25'),
        dynamicSizingEnabled:    process.env.DYNAMIC_SIZING_ENABLED !== 'false',
        tradeBalancePct:         parseFloat(process.env.TRADE_BALANCE_PCT || '10'),
        geckoScannerEnabled:     process.env.GECKO_SCANNER_ENABLED === 'true',
        whaleValidationEnabled:  process.env.WHALE_VALIDATION_ENABLED !== 'false',
        whaleAutoScanEnabled:    process.env.WHALE_AUTO_SCAN_ENABLED === 'true',
        blockHoneypot:           process.env.BLOCK_HONEYPOT  !== 'false',
        blockHighTax:            process.env.BLOCK_HIGH_TAX  !== 'false',
        maxTaxPercent:           parseFloat(process.env.MAX_TAX_PERCENT      || '15'),
        minAiConfidence:         parseInt  (process.env.MIN_AI_CONFIDENCE    || '75'),
        enableFlashblocks:       process.env.ENABLE_FLASHBLOCKS === 'true',
        gasMode:                 process.env.GAS_MODE || 'auto',
        maxDailyLossEth:            parseFloat(process.env.MAX_DAILY_LOSS_ETH             || '0.0015'),
        maxConsecutiveLosses:       parseInt  (process.env.MAX_CONSECUTIVE_LOSSES         || '3'),
        cooldownAfterProfitMinutes: parseInt  (process.env.COOLDOWN_AFTER_BIG_PROFIT_MINUTES || '15'),
        dailyLossCooldownHours:     parseFloat(process.env.DAILY_LOSS_COOLDOWN_HOURS      || '2'),
    };

    private readonly CONFIG = {
        MIN_AI_CONFIDENCE:         parseInt(process.env.MIN_AI_CONFIDENCE        || '75'),
        AUTO_COPY_SCORE_THRESHOLD: parseInt(process.env.AUTO_COPY_SCORE_THRESHOLD || '75'),
        MAX_OPEN_POSITIONS:        parseInt(process.env.MAX_OPEN_POSITIONS        || '3'),
        ENABLE_GROQ_PRIMARY:       true
    };

    constructor() {
        super();
        this.scanner      = new FlashblocksScanner();
        this.copyMonitor  = new CopyTradeMonitor();
        this.ai           = new MultiAIProvider();
        this.riskManager  = new MicroCapRiskManager(this.runtimeConfig.totalCapital);
        this.geckoScanner = new GeckoTokenScanner({
            minLiquidityUsd: this.runtimeConfig.minLiquidity * getEthPriceSync(),
        });

        // Initialize SmartScreener — config loaded from DB after initDb()
        this.smartScreener = new SmartScreener();

        try {
            this.executor = new SwapExecutor();
        } catch (err: any) {
            console.warn(`⚠️  SwapExecutor disabled: ${err.message}`);
            this.addLog('info', 'Live trading dinonaktifkan', 'Set PRIVATE_KEY di .env untuk aktifkan');
        }

        this.setupEventHandlers();
    }

    // ============ SETTINGS PERSISTENCE ============
    loadPersistedSettings(): void {
        // ── Layer 1: trading-config.json (committed, survives redeploy) ──
        try {
            const fileCfg = loadTradingConfig();
            const configKeys = Object.keys(fileCfg).filter(k => k !== '_note');
            if (configKeys.length > 0) {
                this.runtimeConfig = { ...this.runtimeConfig, ...fileCfg };
                console.log(`⚙️  Loaded ${configKeys.length} settings from trading-config.json`);
            }
        } catch (e: any) {
            console.warn('⚠️  Could not load trading-config.json:', e?.message);
        }

        // ── Layer 2: SQLite DB (latest UI changes, highest priority) ──
        try {
            const dbCfg = dbLoadRuntimeConfig();
            if (dbCfg && typeof dbCfg === 'object') {
                this.runtimeConfig = { ...this.runtimeConfig, ...dbCfg };
                console.log('⚙️  Applied latest settings from DB (highest priority)');
            }
        } catch (e: any) {
            console.warn('⚠️  Could not load DB settings:', e?.message);
        }

        // ── Layer 3: Runtime keys (Telegram/AI keys set via UI, gitignored) ──
        try {
            const keys = applyRuntimeKeys();
            if (keys.telegramToken)  this.telegramToken  = keys.telegramToken;
            if (keys.telegramChatId) this.telegramChatId = keys.telegramChatId;
            // AI keys are applied to process.env by applyRuntimeKeys(), MultiAIProvider reads them
        } catch { /* non-critical */ }

        // ── Screener config ──
        try {
            const screenerCfg = dbLoadScreenerConfig();
            if (screenerCfg && typeof screenerCfg === 'object') {
                this.smartScreener.updateConfig(screenerCfg);
                console.log('🔍 Loaded screener config from DB');
            }
        } catch { /* non-critical */ }

        this.smartScreenerEnabled = this.runtimeConfig.geckoScannerEnabled;
        console.log(`⚙️  Final config: TP1=${this.runtimeConfig.tp1Multiplier}x SL=${this.runtimeConfig.stopLoss}% Screener=${this.smartScreenerEnabled}`);
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
        this.activityLog.unshift(entry);
        if (this.activityLog.length > MAX_LOG_ENTRIES) this.activityLog.length = MAX_LOG_ENTRIES;
    }

    getActivityLog(): LogEntry[] { return this.activityLog; }

    // ============ TELEGRAM ============
    private async sendTelegram(message: string): Promise<void> {
        if (!this.telegramToken || !this.telegramChatId) return;
        try {
            const { default: axios } = await import('axios');
            await axios.post(`https://api.telegram.org/bot${this.telegramToken}/sendMessage`, {
                chat_id:                  this.telegramChatId,
                text:                     message,
                parse_mode:               'HTML',
                disable_web_page_preview: true
            }, { timeout: 5000 });
        } catch { /* silent */ }
    }

    async testTelegram(): Promise<{ ok: boolean; error?: string }> {
        if (!this.telegramToken || !this.telegramChatId) {
            return { ok: false, error: 'Bot Token atau Chat ID belum diisi' };
        }
        try {
            const { default: axios } = await import('axios');
            const positions = this.executor?.getOpenPositions() ?? [];
            await axios.post(`https://api.telegram.org/bot${this.telegramToken}/sendMessage`, {
                chat_id:    this.telegramChatId,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                text:
                    `✅ <b>Base Sniper — Test Berhasil!</b>\n\n` +
                    `Bot terhubung dan siap mengirim notifikasi.\n\n` +
                    `📊 <b>Fitur Aktif:</b>\n` +
                    `  ✅ GeckoTerminal (menggantikan DexScreener)\n` +
                    `  ${this.runtimeConfig.geckoScannerEnabled ? '✅' : '⏸'} Token Scanner (GeckoTerminal)\n` +
                    `  ${this.runtimeConfig.whaleAutoScanEnabled ? '✅' : '⏸'} Auto Whale Finder\n` +
                    `  ${this.runtimeConfig.dynamicSizingEnabled ? '✅' : '⏸'} Dynamic Position Sizing\n` +
                    `  ✅ Simulasi P&L sebelum copy trade\n` +
                    `  ✅ Validasi wallet sebelum copy\n\n` +
                    `⚡ Posisi aktif: ${positions.length}`
            }, { timeout: 5000 });
            return { ok: true };
        } catch (err: any) {
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
    private async calculateDynamicAmount(aiConfidence?: number): Promise<number> {
        if (!this.runtimeConfig.dynamicSizingEnabled || !this.executor) {
            return this.runtimeConfig.maxTradeAmount;
        }

        try {
            const balance    = await this.executor.getBalance();
            const balanceEth = parseFloat(balance.eth);
            if (balanceEth <= 0) return this.runtimeConfig.maxTradeAmount;

            // Base: tradeBalancePct % of balance
            const basePct = this.runtimeConfig.tradeBalancePct / 100;
            let amount    = balanceEth * basePct;

            // AI confidence adjustment (only when provided)
            if (aiConfidence !== undefined) {
                const multiplier = aiConfidence >= 90 ? 1.5 : aiConfidence >= 85 ? 1.25 : aiConfidence >= 80 ? 1.0 : 0.6;
                amount *= multiplier;
            }

            const GAS_RESERVE = 0.0002;
            const spendable   = Math.max(0, balanceEth - GAS_RESERVE);
            if (spendable <= 0) {
                console.log(`   ⚠️  Dynamic sizing: saldo tidak cukup untuk trade (${balanceEth.toFixed(5)} ETH)`);
                return 0;
            }
            // Always stay within 7–10% of spendable balance
            const minTrade = spendable * 0.07;
            const maxTrade = spendable * 0.10;
            const result   = Math.max(minTrade, Math.min(maxTrade, amount));

            console.log(`   💰 Dynamic sizing: balance=${balanceEth.toFixed(5)} ETH → trade=${result.toFixed(5)} ETH (${(result / balanceEth * 100).toFixed(1)}%)`);
            return result;
        } catch {
            return this.runtimeConfig.maxTradeAmount;
        }
    }

    private async calculateDynamicCopyAmount(): Promise<number> {
        if (!this.runtimeConfig.dynamicSizingEnabled || !this.executor) {
            return this.runtimeConfig.copyAmount;
        }
        try {
            const balance    = await this.executor.getBalance();
            const balanceEth = parseFloat(balance.eth);
            if (balanceEth <= 0) return this.runtimeConfig.copyAmount;

            // Copy trade: 7–8% of spendable balance
            const GAS_RESERVE = 0.0002;
            const spendable   = Math.max(0, balanceEth - GAS_RESERVE);
            if (spendable <= 0) return 0;
            const amount  = spendable * 0.07;
            const minCopy = spendable * 0.07;
            const maxCopy = spendable * 0.08;
            return Math.max(minCopy, Math.min(maxCopy, amount));
        } catch {
            return this.runtimeConfig.copyAmount;
        }
    }

    // ============ HONEYPOT CHECK ============
    private async checkHoneypot(tokenAddress: string): Promise<{ safe: boolean; reason?: string; sellTax?: number; buyTax?: number }> {
        try {
            const { default: axios } = await import('axios');
            const res = await axios.get(
                `https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${tokenAddress}`,
                { timeout: 6000 }
            );
            const data = res.data?.result?.[tokenAddress.toLowerCase()];
            if (!data) return { safe: true };

            const sellTax    = parseFloat(data.sell_tax  || '0');
            const buyTax     = parseFloat(data.buy_tax   || '0');
            const creatorPct = parseFloat(data.creator_percent || '0') * 100;
            const holderCount = parseInt(data.holder_count || '0');

            if (this.runtimeConfig.blockHoneypot && data.is_honeypot === '1') return { safe: false, reason: '🍯 Honeypot detected' };
            if (data.cannot_sell_all === '1') return { safe: false, reason: 'Cannot sell all — rug risk' };
            const taxLimit = this.runtimeConfig.maxTaxPercent;
            if (this.runtimeConfig.blockHighTax && sellTax > taxLimit) return { safe: false, reason: `Sell tax too high: ${sellTax}%`, sellTax };
            if (this.runtimeConfig.blockHighTax && buyTax  > taxLimit) return { safe: false, reason: `Buy tax too high: ${buyTax}%`,  buyTax  };
            if (creatorPct > 30)              return { safe: false, reason: `Creator holds too much: ${creatorPct.toFixed(0)}%` };
            if (holderCount < 10 && holderCount > 0) return { safe: false, reason: `Too few holders: ${holderCount}` };

            const warnings: string[] = [];
            if (data.is_mintable === '1' && data.owner_address) warnings.push('Mintable');
            if (sellTax > 5)  warnings.push(`Sell tax ${sellTax}%`);
            if (buyTax  > 5)  warnings.push(`Buy tax ${buyTax}%`);
            if (creatorPct > 10) warnings.push(`Creator ${creatorPct.toFixed(0)}%`);
            if (warnings.length > 0) console.log(`   ⚠️  Token warnings: ${warnings.join(', ')}`);

            return { safe: true, sellTax, buyTax };
        } catch {
            console.warn('   ⚠️  GoPlus API tidak tersedia — token dilewati untuk keamanan');
            return { safe: false, reason: 'GoPlus tidak tersedia — skip untuk keamanan' };
        }
    }

    private setupEventHandlers(): void {
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

            const tokenAddress = pool.token0 as Address;
            console.log(`\n🎯 New pool: ${pool.poolAddress}`);

            const analysis = await this.ai.analyzeToken(tokenAddress, {
                liquidity:  pool.liquidity,
                volume24h:  pool.volume24h,
                ageSeconds: (Date.now() - pool.createdAt) / 1000
            });

            console.log(`   🤖 AI: ${analysis.recommendation} (${analysis.confidence}%)`);

            if (this.shouldBuy(analysis)) {
                const amount = await this.calculateDynamicAmount(analysis.confidence);
                if (amount <= 0) { console.log(`   ⛔ Saldo tidak cukup — skip buy`); return; }
                console.log(`   ✅ AI APPROVED: BUY ${amount.toFixed(5)} ETH`);
                this.addLog('info', `AI approved: BUY ${amount.toFixed(5)} ETH`, `${analysis.confidence}% confidence`);
                await this.executeBuy(tokenAddress, amount);
            } else {
                console.log(`   ❌ AI REJECTED: ${analysis.reasoning}`);
                this.addLog('info', `AI rejected pool`, analysis.reasoning);
            }
        });

        // ─── SmartScreener buy signal ───
        this.smartScreener.on('buy-signal', async (signal: ScreenerSignal) => {
            if (!this.smartScreenerEnabled) return;

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

            const tokenAddress = signal.tokenAddress as Address;
            console.log(`\n📡 [SmartScreener] ${signal.signal} — ${signal.tokenSymbol} (score: ${signal.score.total})`);

            // Always log the screener signal so the dashboard shows activity even without a wallet
            this.addLog('info',
                `📡 Screener: ${signal.signal} — ${signal.tokenSymbol}`,
                `score:${signal.score.total} liq:$${Math.round(signal.liquidityUsd).toLocaleString()} 1h:${signal.priceChangeH1 >= 0 ? '+' : ''}${signal.priceChangeH1.toFixed(1)}% addr:${signal.tokenAddress}`
            );

            // Run AI analysis on top of screener signal
            const analysis = await this.ai.analyzeToken(tokenAddress, {
                liquidity:     signal.liquidityUsd / 3000,
                volume24h:     signal.volumeH24,
                ageSeconds:    signal.ageMinutes * 60,
                priceChangeH1: signal.priceChangeH1,
                buyTxH1:       signal.buyTxH1,
                sellTxH1:      signal.sellTxH1,
                fdvUsd:        signal.fdvUsd,
            });

            console.log(`   🤖 AI: ${analysis.recommendation} (${analysis.confidence}%)`);

            if (this.shouldBuy(analysis)) {
                const amount = await this.calculateDynamicAmount(analysis.confidence);
                if (amount <= 0) { console.log(`   ⛔ Saldo tidak cukup — skip SmartScreener buy`); return; }
                const label  = signal.signal === 'STRONG_BUY' ? '🔥 STRONG BUY' : '📡 BUY';
                console.log(`   ✅ SmartScreener ${label}: ${amount.toFixed(5)} ETH for ${signal.tokenSymbol}`);
                this.addLog('info',
                    `📡 SmartScreener ${label}: ${signal.tokenSymbol}`,
                    `score:${signal.score.total} liq:$${Math.round(signal.liquidityUsd).toLocaleString()} 1h:${signal.priceChangeH1 >= 0 ? '+' : ''}${signal.priceChangeH1.toFixed(1)}% | AI: ${analysis.confidence}%`
                );
                await this.sendTelegram(
                    `📡 <b>SmartScreener ${label}!</b>\n` +
                    `Token: <code>${signal.tokenSymbol}</code>\n` +
                    `<code>${signal.tokenAddress}</code>\n\n` +
                    `📊 Score: <b>${signal.score.total}/100</b>\n` +
                    `💧 Liq: $${Math.round(signal.liquidityUsd).toLocaleString()} | Vol: $${Math.round(signal.volumeH24).toLocaleString()}\n` +
                    `📈 1h: ${signal.priceChangeH1 >= 0 ? '+' : ''}${signal.priceChangeH1.toFixed(1)}% | Buys: ${signal.buyTxH1}\n` +
                    `⏱️ Age: ${signal.ageMinutes}min | 🛡️ Safety: ${signal.score.safety}/25\n` +
                    `🤖 AI: ${analysis.confidence}% confidence\n` +
                    `💰 Buy: ${amount.toFixed(5)} ETH`
                );
                await this.executeBuy(tokenAddress, amount, undefined, 'smart-screener');
            } else {
                console.log(`   ❌ AI rejected screener signal: ${analysis.reasoning}`);
                this.addLog('info', `📡 Screener rejected by AI: ${signal.tokenSymbol}`, analysis.reasoning);
            }
        });

        // ─── GeckoTerminal token opportunity ───
        this.geckoScanner.on('token-opportunity', async (opportunity: TokenOpportunity) => {
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

            const tokenAddress = opportunity.tokenAddress as Address;
            console.log(`\n🦎 GeckoScanner opportunity: ${opportunity.tokenSymbol}`);

            const analysis = await this.ai.analyzeToken(tokenAddress, {
                liquidity:          opportunity.liquidityEth,
                volume24h:          opportunity.volumeH24,
                ageSeconds:         opportunity.ageMinutes * 60,
                priceChangeH1:      opportunity.priceChangeH1,
                buyTxH1:            opportunity.buyTxH1,
                sellTxH1:           opportunity.sellTxH1,
                fdvUsd:             opportunity.fdvUsd,
            });

            console.log(`   🤖 AI: ${analysis.recommendation} (${analysis.confidence}%)`);

            if (this.shouldBuy(analysis)) {
                const amount = await this.calculateDynamicAmount(analysis.confidence);
                if (amount <= 0) { console.log(`   ⛔ Saldo tidak cukup — skip GeckoScanner buy`); return; }
                console.log(`   ✅ GeckoScanner BUY: ${amount.toFixed(5)} ETH for ${opportunity.tokenSymbol}`);
                this.addLog('info', `🦎 GeckoScanner buy: ${opportunity.tokenSymbol}`, `liq: $${opportunity.liquidityUsd.toLocaleString()} | ${analysis.confidence}% confidence`);
                await this.sendTelegram(
                    `🦎 <b>GeckoTerminal Opp!</b>\n` +
                    `Token: <code>${opportunity.tokenSymbol}</code> (${opportunity.source})\n` +
                    `💧 Liq: $${opportunity.liquidityUsd.toLocaleString()}\n` +
                    `📈 1h: ${opportunity.priceChangeH1 >= 0 ? '+' : ''}${opportunity.priceChangeH1.toFixed(1)}%\n` +
                    `🤖 AI: ${analysis.confidence}% confidence\n` +
                    `💰 Buy: ${amount.toFixed(5)} ETH`
                );
                await this.executeBuy(tokenAddress, amount, undefined, 'gecko-scanner');
            }
        });

        // ─── Copy trade opportunity ───
        this.copyMonitor.on('copy-opportunity', async (opportunity) => {
            // ── Hard circuit breaker: daily loss limit ──
            if (this.riskManager.isCircuitBreakerTripped()) {
                console.log(`🔴 [CircuitBreaker] Copy trade ignored — ${this.riskManager.getCircuitBreakerReason()}`);
                return;
            }

            // ── Hard circuit breaker: max open positions ──
            const openCountCopy = this.executor?.getOpenPositions().length ?? 0;
            if (openCountCopy >= this.CONFIG.MAX_OPEN_POSITIONS) {
                console.log(`⚠️  [CircuitBreaker] Max positions (${openCountCopy}/${this.CONFIG.MAX_OPEN_POSITIONS}) — Copy trade ignored`);
                return;
            }

            console.log(`\n🐋 Copy opportunity from ${opportunity.walletName}`);

            const walletInfo = this.copyMonitor.getWallets().find(
                w => w.address.toLowerCase() === opportunity.walletAddress.toLowerCase()
            );

            // ── Fetch live token info from GeckoTerminal ──
            let tokenMarketLine = '';
            try {
                const pair = await getBestDexPair(opportunity.tokenAddress);
                if (pair) {
                    const liqUsd   = pair.liquidity.usd;
                    const priceUsd = parseFloat(pair.priceUsd || '0');
                    const priceStr = priceUsd < 0.001 ? priceUsd.toExponential(3) : priceUsd.toFixed(6);
                    tokenMarketLine = `💧 Likuiditas: <b>$${liqUsd.toLocaleString('id-ID')}</b> | Harga: <b>$${priceStr}</b>\n`;
                }
            } catch { /* silent */ }

            // ── Whale stats line ──
            const whaleStatsLine = (walletInfo && walletInfo.copiedTrades > 0)
                ? `📊 Riwayat copy: <b>${walletInfo.copiedTrades} trades</b> | WR: <b>${walletInfo.winRate.toFixed(0)}%</b> | P&L: ${walletInfo.totalPnL >= 0 ? '+' : ''}${walletInfo.totalPnL.toFixed(1)}%\n`
                : `📊 Whale baru pertama kali di-copy\n`;

            // ── Simulation line ──
            const sim = opportunity.simulation;
            const simLine = sim
                ? `🔮 Simulasi: <b>${sim.estimatedProfit >= 0 ? '+' : ''}${sim.estimatedProfit}%</b> est. | Risiko: ${sim.estimatedRisk} | WR sim: ${sim.winRate}%\n`
                : '';

            // ── TX link ──
            const txLine = opportunity.txHash
                ? `🔗 TX Whale: <a href="https://basescan.org/tx/${opportunity.txHash}">Lihat di Basescan</a>\n`
                : '';

            // ── Send detection alert ──
            await this.sendTelegram(
                `🐋 <b>Copy Trade Terdeteksi!</b>\n\n` +
                `👤 Whale: <b>${sanitizeTg(opportunity.walletName)}</b>\n` +
                `<code>${opportunity.walletAddress}</code> | <a href="https://basescan.org/address/${opportunity.walletAddress}">Profil</a>\n\n` +
                `🪙 Token: <b>${sanitizeTg(opportunity.tokenSymbol)}</b>\n` +
                `<code>${opportunity.tokenAddress}</code> | <a href="https://basescan.org/token/${opportunity.tokenAddress}">Info Token</a>\n` +
                tokenMarketLine +
                `\n` +
                whaleStatsLine +
                simLine +
                txLine +
                `\n⏳ <i>Menganalisis wallet dengan AI...</i>`
            );

            // ── AI wallet analysis ──
            const walletStats = walletInfo
                ? {
                    totalTrades: walletInfo.copiedTrades,
                    winRate:     walletInfo.winRate,
                    avgHoldTime: 300,
                    avgProfit:   walletInfo.copiedTrades > 0
                        ? parseFloat((walletInfo.totalPnL / walletInfo.copiedTrades).toFixed(2))
                        : 0,
                  }
                : { totalTrades: 0, winRate: 0, avgHoldTime: 300, avgProfit: 0 };

            const walletAnalysis = await this.ai.analyzeWallet(
                opportunity.walletAddress,
                walletStats
            );

            if (walletAnalysis.shouldCopy && walletAnalysis.score > this.CONFIG.AUTO_COPY_SCORE_THRESHOLD) {
                const baseAmt  = await this.calculateDynamicCopyAmount();
                const ethPrice = await getEthPriceUsd().catch(() => 3000);

                // ── Whale correlation boost: multiple whales on same token ──
                const correlation   = checkTokenCorrelation(opportunity.tokenAddress);
                const corrBonus     = getCorrelationBonus(opportunity.tokenAddress);
                const copyAmt       = corrBonus > 0 ? baseAmt * (1 + corrBonus / 100) : baseAmt;
                const corrLine      = correlation
                    ? `🔥 <b>${correlation.whaleCount} whale</b> beli token ini dalam ${correlation.windowMinutes.toFixed(1)} mnt → +${corrBonus}% ukuran!\n`
                    : '';

                console.log(`   ✅ COPY APPROVED: ${walletAnalysis.reason} | Amount: ${copyAmt.toFixed(5)} ETH${corrBonus > 0 ? ` (+${corrBonus}% correlation boost)` : ''}`);
                this.addLog('copy-trade', `Copy dari ${opportunity.walletName}`, `${opportunity.tokenSymbol} · score ${walletAnalysis.score}/100${corrBonus > 0 ? ` · +${corrBonus}% boost` : ''}`);

                await this.sendTelegram(
                    `✅ <b>AI APPROVE — Eksekusi Sekarang!</b>\n\n` +
                    `🤖 Skor AI: <b>${walletAnalysis.score}/100</b> | Pola: <b>${walletAnalysis.tradingPattern}</b>\n` +
                    `💡 <i>${sanitizeTg(walletAnalysis.reason)}</i>\n\n` +
                    `🪙 Token: <b>${sanitizeTg(opportunity.tokenSymbol)}</b>\n` +
                    `<code>${opportunity.tokenAddress}</code>\n\n` +
                    corrLine +
                    `💰 Copy Amount: <b>${copyAmt.toFixed(5)} ETH</b> (~${fmtUsd(copyAmt, ethPrice)})\n` +
                    `⚡ Eksekusi dalam beberapa detik...`
                );

                await this.executeCopyTrade({ ...opportunity, dynamicAmount: copyAmt });
            } else {
                console.log(`   ❌ COPY REJECTED: ${walletAnalysis.reason}`);
                this.addLog('info', `Copy ditolak: ${opportunity.walletName}`, walletAnalysis.reason);

                await this.sendTelegram(
                    `❌ <b>AI REJECT — Copy Dibatalkan</b>\n\n` +
                    `🤖 Skor AI: <b>${walletAnalysis.score}/100</b> | Pola: <b>${walletAnalysis.tradingPattern}</b>\n` +
                    `💡 <i>${sanitizeTg(walletAnalysis.reason)}</i>\n\n` +
                    `🪙 Token: <b>${sanitizeTg(opportunity.tokenSymbol)}</b>\n` +
                    `<code>${opportunity.tokenAddress}</code>\n\n` +
                    `📊 Data whale: ${walletStats.totalTrades} trades | ${walletStats.winRate.toFixed(0)}% WR | rata-rata ${walletStats.avgProfit >= 0 ? '+' : ''}${walletStats.avgProfit.toFixed(1)}% per trade`
                );
            }
        });

        // ─── Simulation blocked ───
        this.copyMonitor.on('simulation-blocked', async (data) => {
            const sim = data.simulation;
            await this.sendTelegram(
                `⛔ <b>Copy Trade Diblokir — Simulasi Gagal</b>\n\n` +
                `👤 Whale: <b>${sanitizeTg(data.walletName)}</b>\n` +
                `<code>${data.walletAddress ?? ''}</code>\n\n` +
                `🪙 Token: <b>${sanitizeTg(data.tokenSymbol)}</b>\n` +
                `<code>${data.tokenAddress ?? ''}</code>\n\n` +
                (sim
                    ? `📊 Est. P&L: ${sim.estimatedProfit >= 0 ? '+' : ''}${sim.estimatedProfit}% | Risiko: <b>${sim.estimatedRisk}</b>\n` +
                      `📋 <i>${sanitizeTg(sim.summary)}</i>`
                    : `⚠️ Profit terlalu rendah atau risiko terlalu tinggi`)
            );
        });

        // ─── Feature 1: Auto-exit when whale exits ───
        this.copyMonitor.on('whale-sell', async (data: { walletAddress: string; walletName: string; tokenAddress: string }) => {
            const { tokenAddress, walletName } = data;
            this.addLog('info', `🚨 ${walletName} menjual token`, tokenAddress.slice(0, 10) + '...');
            if (this.executor?.hasPosition(tokenAddress)) {
                this.addLog('info', `🔴 Auto-exit: whale ${walletName} keluar`, `Jual semua ${tokenAddress.slice(0, 10)}...`);
                await this.executor.sell(tokenAddress as `0x${string}`, 100);
                this.sendTelegram(
                    `🚨 <b>Auto-Exit: Whale Keluar!</b>\n` +
                    `Whale <b>${sanitizeTg(walletName)}</b> menjual token ini.\n` +
                    `Token: <code>${tokenAddress}</code>\n` +
                    `✅ Bot langsung jual semua posisi.`
                );
            }
        });

        // ─── Executor events ───
        this.wireExecutorEvents();

        // ─── Periodic market sentiment ───
        this.sentimentInterval = setInterval(async () => {
            const sentiment = await this.ai.getMarketSentiment();
            console.log(`\n📊 Market Sentiment: ${sentiment.sentiment}/100 | Gas: ${sentiment.gasAdvice}`);
        }, 300_000);

        // ─── Portfolio summary every 30 min ───
        this.portfolioSummaryInterval = setInterval(async () => {
            if (!this.telegramToken || !this.telegramChatId) return;
            try {
                const positions  = this.executor?.getOpenPositions() ?? [];
                const history    = this.getTradeHistory();
                const balance    = await this.executor?.getBalance();
                const ethBal     = balance?.eth ?? '?';
                const ethPrice   = await getEthPriceUsd().catch(() => 3000);
                const balUsd     = parseFloat(ethBal) * ethPrice;

                const wins    = history.trades.filter((t: any) => (t.profitPct ?? 0) > 0).length;
                const losses  = history.trades.filter((t: any) => (t.profitPct ?? 0) < 0).length;
                const totalPnl = history.trades.reduce((s: number, t: any) => s + (t.profitPct ?? 0), 0);

                const posLines = positions.length > 0
                    ? positions.map((p: any) => `  • ${p.tokenSymbol || p.tokenAddress?.slice(0,8)}`).join('\n')
                    : '  (tidak ada posisi terbuka)';

                await this.sendTelegram(
                    `📊 <b>Ringkasan 30 Menit</b>\n\n` +
                    `💰 Saldo: <b>${parseFloat(ethBal).toFixed(5)} ETH</b> (~$${balUsd.toFixed(2)})\n` +
                    `📂 Posisi aktif: ${positions.length}\n${posLines}\n\n` +
                    `📈 Trade: ${wins + losses} total (✅${wins} ❌${losses})\n` +
                    `💹 Total P&L: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(1)}%`
                );
            } catch { /* silent */ }
        }, 30 * 60_000);
    }

    private wireExecutorEvents(): void {
        if (!this.executor) return;

        this.executor.on('buy-success', (d) => {
            this.emit('buy-success', d);
            this.addLog('buy-success', `BUY ${d.tokenSymbol}`, `TX: ${d.txHash?.slice(0, 18)}...`);
            const amtEth = d.amountIn ? parseFloat(d.amountIn.toString()) / 1e18 : 0;
            pushBuySuccess(d.tokenSymbol || 'TOKEN', amtEth, d.txHash);
            const sourceWalletLine = d.sourceWallet ? `🐋 Copy dari: <b>${sanitizeTg(d.sourceWallet)}</b>\n` : '';
            const tokenAddrLine = d.tokenAddress
                ? `<code>${d.tokenAddress}</code> | <a href="https://basescan.org/token/${d.tokenAddress}">Info Token</a>\n`
                : '';
            getEthPriceUsd().then(ethPrice => {
                this.sendTelegram(
                    `✅ <b>BUY Berhasil!</b>\n\n` +
                    sourceWalletLine +
                    `🪙 Token: <b>${sanitizeTg(d.tokenSymbol || 'UNKNOWN')}</b>\n` +
                    tokenAddrLine +
                    `\n💰 Modal: <b>${amtEth.toFixed(5)} ETH</b> (~${fmtUsd(amtEth, ethPrice)})\n` +
                    `🔗 <a href="https://basescan.org/tx/${d.txHash}">Lihat TX di Basescan</a>`
                );
            }).catch(() => {
                this.sendTelegram(
                    `✅ <b>BUY Berhasil!</b>\n\n` +
                    sourceWalletLine +
                    `🪙 Token: <b>${sanitizeTg(d.tokenSymbol || 'UNKNOWN')}</b>\n` +
                    tokenAddrLine +
                    `\n💰 Modal: <b>${amtEth.toFixed(5)} ETH</b>\n` +
                    `🔗 <a href="https://basescan.org/tx/${d.txHash}">Lihat TX di Basescan</a>`
                );
            });
        });

        this.executor.on('buy-failed', (d) => {
            this.emit('buy-failed', d);
            this.addLog('buy-failed', `BUY gagal: ${d.tokenAddress?.slice(0, 10)}...`, d.error);
            this.sendTelegram(
                `❌ <b>BUY GAGAL</b>\n` +
                `Token: <code>${d.tokenAddress?.slice(0, 10)}...</code>\n` +
                `Alasan: ${sanitizeTg(d.error || 'Unknown error')}`
            );
        });

        this.executor.on('sell-success', (d) => {
            this.emit('sell-success', d);
            this.addLog('sell-success', `SELL ${d.tokenSymbol} (${d.percentSold}%)`, `TX: ${d.txHash?.slice(0, 18)}...`);
            if (d.sourceWallet && (d.percentSold ?? 100) >= 100) {
                this.copyMonitor.recordTradeOutcome(d.sourceWallet, d.profitPct ?? null);
            }
            dbInsertTrade({
                id:           randomBytes(6).toString('hex'),
                tokenAddress: d.tokenAddress || '',
                tokenSymbol:  d.tokenSymbol  || 'UNKNOWN',
                entryEth:     d.entryEth     ?? 0,
                profitPct:    d.profitPct    ?? null,
                percentSold:  d.percentSold  ?? 100,
                closedAt:     Date.now(),
                holdMs:       d.holdMs       ?? 0,
                txHash:       d.txHash       || '',
                reason:       d.reason || 'manual',
            });
            this.sendTelegram(
                `💰 <b>SELL manual</b>\n` +
                `Token: <code>${d.tokenSymbol}</code> (${d.percentSold}%)\n` +
                `TX: <a href="https://basescan.org/tx/${d.txHash}">${d.txHash?.slice(0, 18)}...</a>`
            );
        });

        this.executor.on('take-profit', (d) => {
            this.emit('take-profit', d);
            this.addLog('take-profit', `TP${d.level} ${d.tokenSymbol} @ ${d.multiplier?.toFixed(2)}x`, 'Auto take profit triggered');
            const tpProfitPct = d.profitPct ?? (d.multiplier ? (d.multiplier - 1) * 100 : 0);
            pushTakeProfit(d.tokenSymbol || 'TOKEN', d.level, tpProfitPct, d.multiplier);
            if (d.sourceWallet && d.level === 2 && d.profitPct != null) {
                this.copyMonitor.recordTradeOutcome(d.sourceWallet, d.profitPct);
            }
            dbInsertTrade({
                id:           randomBytes(6).toString('hex'),
                tokenAddress: d.tokenAddress || '',
                tokenSymbol:  d.tokenSymbol  || 'UNKNOWN',
                entryEth:     d.entryEth ?? 0,
                profitPct:    d.profitPct ?? (d.multiplier ? (d.multiplier - 1) * 100 : null),
                percentSold:  d.level === 1 ? 50 : 100,
                closedAt:     Date.now(),
                holdMs:       d.holdMs ?? 0,
                txHash:       d.txHash || '',
                reason:       'take-profit',
                tpLevel:      d.level,
            });
            const holdStrTp   = d.holdMs ? fmtHoldTime(d.holdMs) : '?';
            const profitPctTp = d.profitPct ?? (d.multiplier ? (d.multiplier - 1) * 100 : 0);
            const srcLineTp   = d.sourceWallet ? `🐋 Whale: <b>${sanitizeTg(d.sourceWallet)}</b>\n` : '';
            const addrLineTp  = d.tokenAddress
                ? `<code>${d.tokenAddress}</code> | <a href="https://basescan.org/token/${d.tokenAddress}">Info Token</a>\n`
                : '';
            this.sendTelegram(
                `🎯 <b>TAKE PROFIT TP${d.level}!</b>\n\n` +
                `🪙 Token: <b>${sanitizeTg(d.tokenSymbol || 'UNKNOWN')}</b>\n` +
                addrLineTp +
                srcLineTp +
                `\n📈 Profit: <b>+${profitPctTp.toFixed(1)}%</b> (${d.multiplier?.toFixed(2) ?? '?'}x)\n` +
                `⏱️ Hold: ${holdStrTp}\n` +
                (d.txHash ? `🔗 <a href="https://basescan.org/tx/${d.txHash}">Lihat TX di Basescan</a>` : '')
            );
        });

        this.executor.on('stop-loss', (d) => {
            this.emit('stop-loss', d);
            this.addLog('stop-loss', `Stop Loss ${d.tokenSymbol} @ ${d.profitPct?.toFixed(1)}%`, d.reason || 'Auto stop loss triggered');
            pushStopLoss(d.tokenSymbol || 'TOKEN', d.profitPct ?? 0, d.reason);
            // ── Update risk manager on loss ──
            if (d.profitPct != null) {
                const lossEth = (Math.abs(d.profitPct) / 100) * this.runtimeConfig.maxTradeAmount;
                this.riskManager.afterTrade(-lossEth);
            }
            if (d.sourceWallet) this.copyMonitor.recordTradeOutcome(d.sourceWallet, d.profitPct ?? null);
            if (d.tokenAddress) {
                dbAddToBlacklist(d.tokenAddress.toLowerCase(), 'Stop Loss auto-blacklist');
                this.addLog('info', `Auto-blacklisted: ${d.tokenSymbol}`, 'Hit stop loss');
            }
            dbInsertTrade({
                id:           randomBytes(6).toString('hex'),
                tokenAddress: d.tokenAddress || '',
                tokenSymbol:  d.tokenSymbol  || 'UNKNOWN',
                entryEth:     0,
                profitPct:    d.profitPct ?? null,
                percentSold:  100,
                closedAt:     Date.now(),
                holdMs:       d.holdMs ?? 0,
                txHash:       d.txHash || '',
                reason:       'stop-loss',
            });
            const isEmergency = d.reason?.startsWith('🚨');
            const isTimeout   = d.reason?.startsWith('⏰');
            const isTrailing  = d.reason?.includes('Trailing');
            const icon  = isEmergency ? '🚨' : isTimeout ? '⏰' : '🛑';
            const title = isEmergency ? 'EMERGENCY EXIT (Rug!)' : isTimeout ? 'TIMEOUT EXIT' : isTrailing ? 'TRAILING STOP LOSS' : 'STOP LOSS';
            const holdStrSl  = d.holdMs ? fmtHoldTime(d.holdMs) : '?';
            const srcLineSl  = d.sourceWallet ? `🐋 Whale: <b>${sanitizeTg(d.sourceWallet)}</b>\n` : '';
            const addrLineSl = d.tokenAddress
                ? `<code>${d.tokenAddress}</code> | <a href="https://basescan.org/token/${d.tokenAddress}">Info Token</a>\n`
                : '';
            this.sendTelegram(
                `${icon} <b>${title}</b>\n\n` +
                `🪙 Token: <b>${sanitizeTg(d.tokenSymbol || 'UNKNOWN')}</b>\n` +
                addrLineSl +
                srcLineSl +
                `\n📉 P&L: <b>${(d.profitPct ?? 0) >= 0 ? '+' : ''}${d.profitPct?.toFixed(1) ?? '?'}%</b>\n` +
                `⏱️ Hold: ${holdStrSl}\n` +
                `💡 Reason: ${sanitizeTg(d.reason || 'Fixed SL')}\n` +
                (d.tokenAddress ? `🚫 <i>Token di-blacklist otomatis</i>` : '')
            );
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
    private shouldBuy(analysis: any): boolean {
        if (!this.runtimeConfig.aiEnabled)                            return true;  // AI disabled = always try
        if (analysis.recommendation !== 'BUY')                        return false;
        if (analysis.confidence     < this.runtimeConfig.minAiConfidence)  return false;
        if (analysis.riskLevel      === 'CRITICAL')                    return false;
        // Dynamic profit threshold: semakin tinggi confidence, semakin longgar batas profit
        const minProfit = analysis.confidence >= 85 ? 10 : analysis.confidence >= 75 ? 15 : 20;
        if (analysis.predictedProfit < minProfit)                      return false;

        const openCount = this.executor?.getOpenPositions().length ?? 0;
        if (openCount >= this.CONFIG.MAX_OPEN_POSITIONS) {
            console.log(`   ⚠️  Position cap reached (${openCount}/${this.CONFIG.MAX_OPEN_POSITIONS}) — skip`);
            return false;
        }
        return true;
    }

    // ============ EXECUTION ============
    private async executeBuy(
        tokenAddress: Address,
        amountEth: number,
        sourceWallet?: string,
        reason?: string
    ): Promise<void> {
        if (!this.executor) { console.warn('   ⚠️  Live trading disabled'); return; }

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
                await this.sendTelegram(
                    `🔴 <b>CIRCUIT BREAKER AKTIF</b>\n\n` +
                    `${riskGate.reason}\n\n` +
                    `🛑 Semua sinyal baru akan <b>diabaikan</b> hingga reset tengah malam.\n` +
                    `⏰ Reset pada: <b>${resetTime} UTC</b>`
                );
            }
            return;
        }

        if (dbIsBlacklisted(tokenAddress.toLowerCase())) {
            console.log(`   🚫 Token blacklisted — skip`);
            return;
        }

        // ── Serial rugger check ──
        if (this.runtimeConfig.serialRuggerEnabled) {
            const sr = await checkSerialDeployer(tokenAddress, this.runtimeConfig.serialRuggerMaxDeploys, this.runtimeConfig.serialRuggerWindowHours);
            if (sr.isSerialRugger) {
                console.log(`   🚨 SERIAL RUGGER: ${sr.deployer} → skip`);
                this.addToBlacklist(tokenAddress, `Serial rugger`);
                return;
            }
        }

        // ── Reputation check ──
        if (this.runtimeConfig.reputationEnabled) {
            const deployer = await getTokenDeployer(tokenAddress as string);
            if (deployer) {
                const rep = await getDeployerReputation(deployer);
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
        } else {
            console.error(`   ❌ BUY FAILED: ${result.error}`);
        }
    }

    private async executeCopyTrade(opportunity: any): Promise<void> {
        if (!this.executor) { console.warn('   ⚠️  Live trading disabled'); return; }

        // ── Risk manager gate — skipCooldown=true ──
        // Copy trade mengikuti whale secara independen, tidak dipengaruhi cooldown screener.
        // Hanya Emergency Stop (tombol 🚨) yang benar-benar menghentikannya.
        const riskGate = this.riskManager.beforeTrade({}, true);
        if (!riskGate.allowed) {
            console.log(`   🚫 [CopyTrade] Diblokir Emergency Stop: ${riskGate.reason}`);
            this.addLog('info', `Copy trade diblokir Emergency Stop`, riskGate.reason);
            return;
        }

        const addr = (opportunity.tokenAddress as string).toLowerCase();
        if (dbIsBlacklisted(addr)) { console.log(`   🚫 Blacklisted — skip copy`); return; }

        if (this.runtimeConfig.serialRuggerEnabled) {
            const sr = await checkSerialDeployer(opportunity.tokenAddress, this.runtimeConfig.serialRuggerMaxDeploys, this.runtimeConfig.serialRuggerWindowHours);
            if (sr.isSerialRugger) {
                console.log(`   🚨 SERIAL RUGGER (copy) → skip`);
                this.addToBlacklist(opportunity.tokenAddress, `Serial rugger`);
                return;
            }
        }

        if (this.runtimeConfig.reputationEnabled) {
            const deployer = await getTokenDeployer(opportunity.tokenAddress as string);
            if (deployer) {
                const rep = await getDeployerReputation(deployer);
                if (rep.score !== null && rep.score < this.runtimeConfig.reputationMinScore) {
                    console.log(`   🔴 LOW REPUTATION (copy): ${rep.score}/100 → skip`);
                    return;
                }
            }
        }

        const safety = await this.checkHoneypot(opportunity.tokenAddress);
        if (!safety.safe) { console.log(`   🚫 UNSAFE: ${safety.reason} — skip copy`); return; }

        // Use dynamic amount if provided, else fallback
        const copyAmount = opportunity.dynamicAmount ?? this.runtimeConfig.copyAmount;
        const result = await this.executor.buy({
            tokenAddress: opportunity.tokenAddress as Address,
            amountInEth:  copyAmount,
            sourceWallet: opportunity.walletAddress
        });

        if (result.success) {
            console.log(`   ✅ COPY TRADE SUCCESS | TX: ${result.txHash}`);
        } else {
            console.error(`   ❌ COPY TRADE FAILED: ${result.error}`);
        }
    }

    // ============ WHALE FINDER — PUBLIC METHODS ============
    async runWhaleScan(forceManual = false): Promise<WhaleCandidate[]> {
        const candidates = await runWhaleScan(forceManual);
        const now = Date.now();
        for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            // Persist waitlist discovery event
            dbInsertWaitlistEvent({
                address:    c.address,
                eventType:  'discovered',
                recordedAt: now,
            });
            // Rich Telegram notification via command bot if available, else plain sendTelegram
            if (this.tgBot) {
                await this.tgBot.sendWaitlistAlert({
                    address:          c.address,
                    score:            c.score,
                    estimatedWinRate: c.estimatedWinRate,
                    avgProfitPct:     c.avgProfitPct,
                    tradeCount:       c.tradeCount,
                    index:            i,
                    total:            candidates.length,
                });
            } else {
                await this.sendTelegram(formatWhaleTelegramMsg(c, i));
            }
        }
        return candidates;
    }

    getPendingWhales(): WhaleCandidate[] { return getPendingCandidates(); }
    getAllWhales():     WhaleCandidate[] { return getAllCandidates(); }

    approveWhale(address: string): WhaleCandidate | null {
        const c = approveCandidate(address);
        if (c) {
            this.copyMonitor.addWallet(c.address, `Whale ${c.address.slice(0, 8)} (auto)`, false);
            this.addLog('info', `🐋 Whale disetujui & ditambahkan`, `Score: ${c.score}/100 | WR: ${c.estimatedWinRate}%`);
            dbInsertWaitlistEvent({ address: c.address, eventType: 'approved', recordedAt: Date.now() });
            this.sendTelegram(
                `✅ <b>Whale Disetujui!</b>\n` +
                `<code>${c.address}</code>\n` +
                `Skor: ${c.score}/100 | WR: ${c.estimatedWinRate}%\n` +
                `Sekarang di-copy trade secara otomatis.`
            );
        }
        return c;
    }

    rejectWhale(address: string): void {
        rejectCandidate(address);
        this.addLog('info', `🐋 Whale ditolak`, address);
        dbInsertWaitlistEvent({ address: address.toLowerCase(), eventType: 'rejected', recordedAt: Date.now() });
        this.sendTelegram(`❌ <b>Whale Ditolak</b>\n<code>${address}</code>`);
    }

    // ============ MONITORING FLOW ============

    addToMonitoring(address: string, name?: string): boolean {
        const c = monitorCandidate(address);
        if (!c) return false;
        const label = name || `Whale ${address.slice(0, 8)}`;
        dbAddMonitoredWallet(address, label);
        this.addLog('info', `🔬 Whale masuk Monitoring`, `Score: ${c.score}/100 | WR: ${c.estimatedWinRate}%`);
        dbInsertWaitlistEvent({ address: address.toLowerCase(), eventType: 'monitoring', recordedAt: Date.now() });
        pushWhaleMonitoring(address, label);
        this.sendTelegram(
            `🔬 <b>Whale Masuk Monitoring!</b>\n<code>${address}</code>\n` +
            `Skor: ${c.score}/100 | Est. WR: ${c.estimatedWinRate}%\n` +
            `Bot akan mengamati trade-nya sebelum copy.`
        );
        return true;
    }

    getMonitoredWallets(): MonitoredWalletRow[] {
        return dbGetMonitoredWallets();
    }

    removeFromMonitoring(address: string): void {
        dbRemoveMonitoredWallet(address);
        this.addLog('info', `🔬 Wallet dihapus dari Monitoring`, address);
    }

    async evaluateMonitoredWallet(address: string): Promise<{
        verdict: 'approved' | 'rejected' | 'pending';
        score: number;
        reason: string;
        needsMoreData: boolean;
        breakdown: { label: string; pass: boolean | null; value: string; threshold: string }[];
    }> {
        const wallet = dbGetMonitoredWallet(address.toLowerCase());
        if (!wallet) throw new Error('Wallet tidak ditemukan di monitoring');

        const totalPairs  = wallet.winsObserved + wallet.lossesObserved;
        const winRate     = totalPairs > 0 ? Math.round((wallet.winsObserved / totalPairs) * 100) : 0;
        const monitorDays = (Date.now() - wallet.monitoredSince) / 86_400_000;
        const monitorDaysFmt = monitorDays.toFixed(1);

        // ── Build criteria breakdown ───────────────────────────────────────────
        const breakdown: { label: string; pass: boolean | null; value: string; threshold: string }[] = [
            {
                label:     'Win Rate',
                pass:      totalPairs > 0 ? winRate >= 50 : null,
                value:     totalPairs > 0 ? `${winRate}%` : 'Belum ada data',
                threshold: '≥ 50%',
            },
            {
                label:     'PnL Rata-rata',
                pass:      totalPairs > 0 ? wallet.totalPnlPct > 0 : null,
                value:     totalPairs > 0
                    ? `${wallet.totalPnlPct >= 0 ? '+' : ''}${wallet.totalPnlPct.toFixed(1)}%`
                    : 'Belum ada data',
                threshold: '> 0%',
            },
            {
                label:     'Frekuensi Trading',
                pass:      wallet.tradesPerDay >= 0.3,
                value:     wallet.tradesPerDay > 0 ? `${wallet.tradesPerDay} trade/hari` : 'Tidak aktif',
                threshold: '≥ 0.3 trade/hari',
            },
            {
                label:     'Pasang Buy-Sell',
                pass:      totalPairs >= 3,
                value:     `${totalPairs} pasang`,
                threshold: '≥ 3 pasang',
            },
            {
                label:     'Durasi Monitoring',
                pass:      monitorDays >= 0.5,
                value:     `${monitorDaysFmt} hari`,
                threshold: '≥ 0.5 hari (12 jam)',
            },
        ];

        // ── Data sufficiency check ─────────────────────────────────────────────
        // Don't evaluate yet if we haven't seen enough activity
        const hasEnoughData = totalPairs >= 3 || (wallet.tradesObserved >= 5 && monitorDays >= 1);
        if (!hasEnoughData) {
            const missingPairs = Math.max(0, 3 - totalPairs);
            const reason =
                `Data monitoring belum cukup untuk memberi verdict yang adil.\n` +
                `Saat ini baru ${totalPairs} pasang buy-sell terobservasi (butuh minimal 3). ` +
                `Sudah dimonitor ${monitorDaysFmt} hari.\n\n` +
                `Kemungkinan penyebab: wallet ini tidak aktif di pool-pool trending yang dipantau bot, ` +
                `atau wallet memang jarang trading. Terus tunggu atau gunakan "Paksa Promosikan" jika Anda percaya wallet ini.`;

            // Store pending reason in DB (verdict stays 'pending')
            dbSetMonitoredVerdict(address, 'pending', 0, reason);
            this.addLog('info', `🔬 Evaluasi: data belum cukup ${address.slice(0, 10)}… (${totalPairs} pasang, butuh 3)`, '');
            return { verdict: 'pending', score: 0, reason, needsMoreData: true, breakdown };
        }

        // ── AI evaluation ──────────────────────────────────────────────────────
        const failedCriteria = breakdown.filter(c => c.pass === false).map(c => c.label);
        const passedCriteria = breakdown.filter(c => c.pass === true).map(c => c.label);

        const prompt =
            `Kamu adalah evaluator wallet crypto untuk copy trading. Jawab dengan JSON saja.\n\n` +
            `WALLET: ${address}\n` +
            `Durasi monitoring: ${monitorDaysFmt} hari\n` +
            `Trade terobservasi: ${wallet.tradesObserved} transaksi\n` +
            `Pasang buy-sell: ${totalPairs} (${wallet.winsObserved} profit, ${wallet.lossesObserved} rugi)\n` +
            `Win rate aktual: ${totalPairs > 0 ? winRate + '%' : 'N/A'}\n` +
            `PnL rata-rata: ${totalPairs > 0 ? (wallet.totalPnlPct >= 0 ? '+' : '') + wallet.totalPnlPct.toFixed(1) + '%' : 'N/A'}\n` +
            `Frekuensi: ${wallet.tradesPerDay} trade/hari\n\n` +
            `Kriteria LULUS: ${passedCriteria.join(', ') || 'belum ada'}\n` +
            `Kriteria GAGAL: ${failedCriteria.join(', ') || 'semua lulus'}\n\n` +
            `Kriteria APPROVE:\n` +
            `- Win rate ≥ 50% (dari pasang buy-sell yang terekam)\n` +
            `- PnL rata-rata positif\n` +
            `- Minimal 3 pasang buy-sell terobservasi\n` +
            `CATATAN PENTING: Data GeckoTerminal terbatas hanya dari pool trending. ` +
            `Jika data minim, pertimbangkan untuk APPROVE dengan catatan "data terbatas" daripada langsung REJECT.\n\n` +
            `Format respons JSON: {"verdict":"APPROVE","score":75,"reason":"penjelasan singkat 1-2 kalimat bahasa Indonesia, sebutkan metrik spesifik"}`;

        try {
            const response = await this.ai.query(prompt);
            if (response.success) {
                const jsonMatch = response.content.match(/\{[\s\S]*?\}/);
                if (jsonMatch) {
                    const parsed  = JSON.parse(jsonMatch[0]);
                    const verdict = parsed.verdict?.toUpperCase() === 'APPROVE' ? 'approved' : 'rejected';
                    const score   = Math.max(0, Math.min(100, parseInt(parsed.score) || 50));
                    const reason  = parsed.reason || 'Evaluasi AI selesai';
                    dbSetMonitoredVerdict(address, verdict, score, reason);
                    this.addLog('info', `🤖 AI evaluasi: ${verdict === 'approved' ? 'SETUJUI ✅' : 'TOLAK ❌'} ${address.slice(0, 10)}…`, reason);
                    return { verdict, score, reason, needsMoreData: false, breakdown };
                }
            }
        } catch { /* fall through to rule-based */ }

        // ── Rule-based fallback ────────────────────────────────────────────────
        const score = Math.round(Math.min(100,
            (totalPairs > 0 ? winRate * 0.45 : 0) +
            (wallet.totalPnlPct > 0 ? Math.min(25, wallet.totalPnlPct) : 0) +
            (wallet.tradesPerDay >= 1 ? 15 : wallet.tradesPerDay >= 0.3 ? 8 : 0) +
            (totalPairs >= 3 ? 10 : totalPairs >= 1 ? 5 : 0) +
            (monitorDays >= 1 ? 5 : 0)
        ));
        const verdict: 'approved' | 'rejected' = score >= 50 && winRate >= 40 ? 'approved' : 'rejected';

        // Build detailed reason listing each criterion's result
        const criteriaLines = breakdown.map(c =>
            `${c.pass === true ? '✅' : c.pass === false ? '❌' : '⏳'} ${c.label}: ${c.value} (target ${c.threshold})`
        ).join('\n');
        const reason = verdict === 'approved'
            ? `Skor ${score}/100 — memenuhi kriteria minimum untuk copy trading.\n${criteriaLines}`
            : `Skor ${score}/100 — belum memenuhi kriteria. Kriteria gagal: ${failedCriteria.join(', ') || 'tidak ada'}.\n${criteriaLines}`;

        dbSetMonitoredVerdict(address, verdict, score, reason);
        this.addLog('info', `🤖 Evaluasi rule-based: ${verdict === 'approved' ? 'SETUJUI ✅' : 'TOLAK ❌'} ${address.slice(0, 10)}…`, `Skor: ${score}/100`);
        return { verdict, score, reason, needsMoreData: false, breakdown };
    }

    forcePromoteWallet(address: string): boolean {
        const wallet = dbGetMonitoredWallet(address.toLowerCase());
        if (!wallet) return false;
        // Override: set verdict to approved, then promote
        dbSetMonitoredVerdict(address, 'approved', 0, 'Dipromosikan secara manual oleh pengguna (override AI)');
        dbApproveWhale(address);
        dbAddCopyWallet(address, wallet.name);
        this.copyMonitor.addWallet(address, wallet.name, false);
        dbRemoveMonitoredWallet(address);
        this.addLog('info', `🚀 Whale dipaksa promosi (override) ke Copy!`, `${wallet.name}`);
        dbInsertWaitlistEvent({ address: address.toLowerCase(), eventType: 'approved', recordedAt: Date.now() });
        pushWhalePromoted(address, wallet.name);
        this.sendTelegram(
            `🚀 <b>Whale Dipromosikan Manual!</b>\n<code>${address}</code>\n` +
            `Override oleh pengguna — aktif di-copy sekarang.`
        );
        return true;
    }

    promoteToActiveCopy(address: string): boolean {
        const wallet = dbGetMonitoredWallet(address.toLowerCase());
        if (!wallet || wallet.aiVerdict !== 'approved') return false;

        dbApproveWhale(address);
        dbAddCopyWallet(address, wallet.name);
        this.copyMonitor.addWallet(address, wallet.name, false);
        dbRemoveMonitoredWallet(address);

        this.addLog('info', `🚀 Whale dipromosikan ke Copy!`, `${wallet.name} | AI Score: ${wallet.aiScore ?? '?'}/100`);
        dbInsertWaitlistEvent({ address: address.toLowerCase(), eventType: 'approved', recordedAt: Date.now() });
        pushWhalePromoted(address, wallet.name);
        this.sendTelegram(
            `🚀 <b>Whale Dipromosikan ke Copy!</b>\n<code>${address}</code>\n` +
            `AI Score: ${wallet.aiScore ?? '?'}/100\n` +
            `Alasan: ${wallet.aiReason ?? '-'}\n` +
            `Sekarang aktif di-copy secara otomatis.`
        );
        return true;
    }

    async simulateCopyTrade(walletAddress: string, tokenAddress: string): Promise<SimulationResult> {
        return simulateCopyTrade(walletAddress, tokenAddress);
    }

    // ============ LIFECYCLE ============
    async start(): Promise<void> {
        // Load persisted settings from DB before printing config
        this.loadPersistedSettings();

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🤖 AI-POWERED BASE SNIPER ULTIMATE');
        console.log(`💰 Modal: ${this.runtimeConfig.totalCapital} ETH`);
        console.log(`💼 Wallet: ${this.executor?.getWalletAddress() ?? 'NOT CONFIGURED'}`);
        console.log(`📊 Dynamic Sizing: ${this.runtimeConfig.dynamicSizingEnabled ? `✅ (${this.runtimeConfig.tradeBalancePct}% per trade)` : '❌'}`);
        console.log(`🦎 GeckoTerminal Scanner: ${this.runtimeConfig.geckoScannerEnabled ? '✅' : '❌'}`);
        console.log(`📡 Smart Screener: ${this.smartScreenerEnabled ? '✅' : '❌'}`);
        console.log(`🐋 Whale Auto-Scan: ${this.runtimeConfig.whaleAutoScanEnabled ? '✅' : '❌'}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        const health = await this.ai.healthCheck();
        console.log(`🔍 AI: Groq=${health.groq ? '✅' : '❌'} Gemini=${health.gemini ? '✅' : '❌'} HF=${health.huggingface ? '✅' : '❌'}\n`);

        // ── Load persisted copy wallets from DB ──
        const savedWallets = dbGetCopyWallets();
        for (const w of savedWallets) {
            if (!this.copyMonitor.getWallets().some((x: any) => x.address.toLowerCase() === w.address)) {
                this.copyMonitor.addWallet(w.address, w.name, false);
                if (!w.isActive) this.copyMonitor.toggleWallet(w.address, false);
            }
        }

        // ── Feature 5: Set balance provider for dynamic copy sizing (6-10%) ──
        if (this.executor) {
            this.copyMonitor.setBalanceProvider(async () => {
                const { eth } = await this.executor!.getBalance();
                return parseFloat(eth);
            });
        }
        if (savedWallets.length > 0) {
            console.log(`💾 Loaded ${savedWallets.length} copy wallets from DB`);
        }

        // ── Restore known tokens from DB trade history ──
        if (this.executor) {
            const WETH_BASE = '0x4200000000000000000000000000000000000006';
            this.executor.addKnownToken(WETH_BASE);
            const recentTrades = dbGetTrades(200);
            const restored = new Set<string>();
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

        await this.scanner.connect();

        if (this.runtimeConfig.copyEnabled) {
            this.copyMonitor.start();
        }

        if (this.runtimeConfig.geckoScannerEnabled) {
            this.geckoScanner.start();
        }

        // Smart Screener — starts independently alongside (or instead of) GeckoScanner
        if (this.smartScreenerEnabled) {
            this.smartScreener.start();
        }

        if (this.runtimeConfig.whaleAutoScanEnabled) {
            this.startWhaleAutoScan();
        }

        // ── Start Telegram command bot ──
        this.tgBot = startTelegramBot(this);

        // ── Start whale monitoring service ──
        whaleMonitor.start();

        setInterval(() => this.printPerformanceReport(), 3_600_000);

        // ── Feature 10: Schedule daily P&L report ──
        this.scheduleDailyReport();

        console.log('✅ AI SNIPER RUNNING\n');
    }

    private startWhaleAutoScan(): void {
        if (this.whaleAutoScanInterval) return;
        console.log('🔍 Whale auto-scan enabled (every 15 min)');
        this.whaleAutoScanInterval = setInterval(async () => {
            const candidates = await this.runWhaleScan(false);
            if (candidates.length > 0) {
                this.addLog('info', `🐋 ${candidates.length} whale kandidat baru ditemukan`, 'Periksa Telegram untuk approval');
            }
        }, 15 * 60_000);
    }

    async stop(): Promise<void> {
        if (this.sentimentInterval)      { clearInterval(this.sentimentInterval);      this.sentimentInterval = null; }
        if (this.whaleAutoScanInterval)  { clearInterval(this.whaleAutoScanInterval);  this.whaleAutoScanInterval = null; }
        if (this.dailyReportTimer)       { clearTimeout(this.dailyReportTimer);        this.dailyReportTimer = null; }
        if (this.dailyReportInterval)    { clearInterval(this.dailyReportInterval);    this.dailyReportInterval = null; }
        this.tgBot?.stop();
        this.scanner.disconnect();
        this.copyMonitor.stop();
        this.geckoScanner.stop();
        this.smartScreener.stop();
        this.executor?.stop();
        whaleMonitor.stop();
        console.log('🛑 AI Sniper stopped');
    }

    async printPerformanceReport(): Promise<void> {
        const aiStats  = this.ai.getStats();
        const positions = this.executor?.getOpenPositions() ?? [];
        console.log('\n📊 PERFORMANCE REPORT');
        for (const [provider, stats] of Object.entries(aiStats.providers)) {
            if (stats) {
                const s = stats as any;
                console.log(`${provider.toUpperCase()}: ✓${s.success} ✗${s.fail} | ~${s.avgLatency.toFixed(0)}ms`);
            }
        }
        console.log(`Open Positions: ${positions.length}`);
        console.log(`GeckoScanner seen: ${this.geckoScanner.getSeenCount()} tokens`);
    }

    // ============ RUNTIME CONFIG UPDATE ============
    updateRuntimeConfig(s: Partial<RuntimeConfig>): void {
        const r = this.runtimeConfig;
        if (s.totalCapital            != null) r.totalCapital            = s.totalCapital;
        if (s.maxTradeAmount          != null) r.maxTradeAmount          = s.maxTradeAmount;
        if (s.minLiquidity            != null) r.minLiquidity            = s.minLiquidity;
        if (s.maxSlippage             != null) r.maxSlippage             = s.maxSlippage;
        if (s.tp1Multiplier           != null) r.tp1Multiplier           = s.tp1Multiplier;
        if (s.tp1Percentage           != null) r.tp1Percentage           = s.tp1Percentage;
        if (s.tp2Multiplier           != null) r.tp2Multiplier           = s.tp2Multiplier;
        if (s.tp2Percentage           != null) r.tp2Percentage           = s.tp2Percentage;
        if (s.stopLoss                != null) r.stopLoss                = s.stopLoss;
        if (s.maxPriorityFee          != null) r.maxPriorityFee          = s.maxPriorityFee;
        if (s.maxFeePerGas            != null) r.maxFeePerGas            = s.maxFeePerGas;
        if (s.copyEnabled             != null) r.copyEnabled             = s.copyEnabled;
        if (s.copyAmount              != null) r.copyAmount              = s.copyAmount;
        if (s.copyDelay               != null) r.copyDelay               = s.copyDelay;
        if (s.copyMaxPerDay           != null) r.copyMaxPerDay           = s.copyMaxPerDay;
        if (s.minSafetyScore          != null) r.minSafetyScore          = s.minSafetyScore;
        if (s.maxPoolAgeSeconds       != null) r.maxPoolAgeSeconds       = s.maxPoolAgeSeconds;
        if (s.aiEnabled               != null) r.aiEnabled               = s.aiEnabled;
        if (s.dcaEnabled              != null) r.dcaEnabled              = s.dcaEnabled;
        if (s.serialRuggerEnabled     != null) r.serialRuggerEnabled     = s.serialRuggerEnabled;
        if (s.serialRuggerMaxDeploys  != null) r.serialRuggerMaxDeploys  = s.serialRuggerMaxDeploys;
        if (s.serialRuggerWindowHours != null) r.serialRuggerWindowHours = s.serialRuggerWindowHours;
        if (s.reputationEnabled       != null) r.reputationEnabled       = s.reputationEnabled;
        if (s.reputationMinScore      != null) r.reputationMinScore      = s.reputationMinScore;
        if (s.dynamicSizingEnabled    != null) r.dynamicSizingEnabled    = s.dynamicSizingEnabled;
        if (s.tradeBalancePct         != null) r.tradeBalancePct         = s.tradeBalancePct;
        if (s.geckoScannerEnabled     != null) {
            r.geckoScannerEnabled = s.geckoScannerEnabled;
            if (s.geckoScannerEnabled)  this.geckoScanner.start();
            else                        this.geckoScanner.stop();
        }
        if (s.whaleAutoScanEnabled    != null) {
            r.whaleAutoScanEnabled = s.whaleAutoScanEnabled;
            if (s.whaleAutoScanEnabled) this.startWhaleAutoScan();
            else if (this.whaleAutoScanInterval) {
                clearInterval(this.whaleAutoScanInterval);
                this.whaleAutoScanInterval = null;
            }
        }
        if (s.blockHoneypot    != null) r.blockHoneypot    = s.blockHoneypot;
        if (s.blockHighTax     != null) r.blockHighTax     = s.blockHighTax;
        if (s.maxTaxPercent    != null) r.maxTaxPercent    = s.maxTaxPercent;
        if (s.minAiConfidence  != null) r.minAiConfidence  = s.minAiConfidence;
        if (s.enableFlashblocks        != null) r.enableFlashblocks        = s.enableFlashblocks;
        if (s.gasMode                  != null) r.gasMode                  = s.gasMode;
        if (s.maxDailyLossEth            != null) r.maxDailyLossEth            = s.maxDailyLossEth;
        if (s.maxConsecutiveLosses       != null) r.maxConsecutiveLosses       = s.maxConsecutiveLosses;
        if (s.cooldownAfterProfitMinutes != null) r.cooldownAfterProfitMinutes = s.cooldownAfterProfitMinutes;
        if (s.dailyLossCooldownHours     != null) r.dailyLossCooldownHours     = s.dailyLossCooldownHours;

        // Propagate limits to risk manager
        this.riskManager.updateLimits(
            r.maxDailyLossEth,
            r.maxConsecutiveLosses,
            r.cooldownAfterProfitMinutes,
            r.dailyLossCooldownHours,
        );

        if (this.executor) {
            this.executor.updateConfig({
                maxSlippage:    r.maxSlippage,
                tp1Multiplier:  r.tp1Multiplier,
                tp1Percentage:  r.tp1Percentage,
                tp2Multiplier:  r.tp2Multiplier,
                tp2Percentage:  r.tp2Percentage,
                stopLoss:       r.stopLoss,
                maxPriorityFee: r.maxPriorityFee,
                maxFeePerGas:   r.maxFeePerGas,
                dcaEnabled:     r.dcaEnabled,
                gasMode:        r.gasMode,
            });
        }

        this.copyMonitor.updateConfig({
            copyEnabled:  r.copyEnabled,
            copyAmount:   r.copyAmount,
            copyDelay:    r.copyDelay,
            minLiquidity: r.minLiquidity
        });

        // Sync smartScreener enable state
        this.smartScreenerEnabled = r.geckoScannerEnabled;

        // ── Persist to BOTH stores ──
        // 1. SQLite DB (immediate, highest priority on next startup)
        try { dbSaveRuntimeConfig(r); } catch { /* non-critical */ }
        // 2. trading-config.json (committed file, survives redeploy)
        try {
            const { _note: _, ...clean } = r as any;
            saveTradingConfig(clean);
        } catch { /* non-critical */ }

        this.addLog('info', 'Pengaturan diperbarui via UI', `Capital: ${r.totalCapital} ETH`);
    }

    getRuntimeConfig(): RuntimeConfig { return { ...this.runtimeConfig }; }

    // ============ SMART SCREENER PUBLIC API ============
    getScreenerSignals(minSignal?: 'STRONG_BUY' | 'BUY' | 'WATCH' | 'SKIP') {
        return this.smartScreener.getSignals(minSignal);
    }

    getScreenerStats() { return this.smartScreener.getStats(); }

    getScreenerConfig() { return this.smartScreener.getConfig(); }

    updateScreenerConfig(updates: Partial<ScreenerConfig>): void {
        this.smartScreener.updateConfig(updates);
        try { dbSaveScreenerConfig(this.smartScreener.getConfig()); } catch { /* non-critical */ }
        this.addLog('info', 'Screener config updated', JSON.stringify(updates));
    }

    setSmartScreenerEnabled(enabled: boolean): void {
        this.smartScreenerEnabled = enabled;
        if (enabled) {
            this.smartScreener.start();
            this.addLog('info', '📡 Smart Screener AKTIF', 'Scanning new pools & trending...');
        } else {
            this.smartScreener.stop();
            this.addLog('info', '📡 Smart Screener NONAKTIF', '');
        }
        // Mirror to runtimeConfig + persist
        this.runtimeConfig.geckoScannerEnabled = enabled;
        try { dbSaveRuntimeConfig(this.runtimeConfig); } catch { /* non-critical */ }
    }

    isSmartScreenerEnabled(): boolean { return this.smartScreenerEnabled; }

    // ============ KEY MANAGEMENT ============
    updateKeys(keys: { privateKey?: string; groqKey?: string; geminiKey?: string; huggingfaceKey?: string; telegramToken?: string; telegramChatId?: string }): void {
        const aiKeys: { groq?: string; gemini?: string; huggingface?: string } = {};
        if (keys.groqKey)        { aiKeys.groq        = keys.groqKey;        process.env.GROQ_API_KEY        = keys.groqKey; }
        if (keys.geminiKey)      { aiKeys.gemini      = keys.geminiKey;      process.env.GEMINI_API_KEY      = keys.geminiKey; }
        if (keys.huggingfaceKey) { aiKeys.huggingface = keys.huggingfaceKey; process.env.HUGGINGFACE_API_KEY = keys.huggingfaceKey; }
        if (Object.keys(aiKeys).length > 0) this.ai.updateKeys(aiKeys);

        if (keys.telegramToken)  { this.telegramToken  = keys.telegramToken;  process.env.TELEGRAM_BOT_TOKEN = keys.telegramToken;  }
        if (keys.telegramChatId) { this.telegramChatId = keys.telegramChatId; process.env.TELEGRAM_CHAT_ID   = keys.telegramChatId; }

        // ── Persist Telegram + AI keys to .runtime-keys.json ──
        // These survive server restarts (not redeployments).
        // PRIVATE_KEY is intentionally NOT saved here — it must be a Replit Secret.
        try {
            saveRuntimeKeys({
                groqKey:        keys.groqKey,
                geminiKey:      keys.geminiKey,
                huggingfaceKey: keys.huggingfaceKey,
                telegramToken:  keys.telegramToken,
                telegramChatId: keys.telegramChatId,
            });
        } catch { /* non-critical */ }

        if (keys.privateKey) {
            process.env.PRIVATE_KEY = keys.privateKey;
            try {
                if (this.executor) this.executor.stop();
                this.executor = new SwapExecutor();
                this.wireExecutorEvents();
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

    async manualSell(tokenAddress: string, percent: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
        if (!this.executor) return { success: false, error: 'Executor belum siap' };
        const pct    = Math.max(1, Math.min(100, Math.round(percent)));
        const result = await this.executor.sell(tokenAddress as `0x${string}`, pct);
        if (result.success) this.addLog('sell-success', `Manual sell ${pct}%`, tokenAddress);
        else this.addLog('info', `Manual sell gagal: ${result.error}`, tokenAddress);
        return { success: result.success, txHash: result.txHash as string | undefined, error: result.error };
    }

    async getPortfolio() {
        if (!this.executor) return { ethBalance: '0', ethValueUsd: 0, tokens: [], totalValueEth: 0, totalValueUsd: 0 };
        return this.executor.getPortfolioData();
    }

    async sendFunds(type: 'eth' | 'token', to: string, amount: number, tokenAddress?: string, decimals?: number) {
        if (!this.executor) return { success: false, error: 'Executor belum siap' };
        if (type === 'eth') return this.executor.sendEth(to as `0x${string}`, amount);
        if (!tokenAddress) return { success: false, error: 'tokenAddress diperlukan' };
        return this.executor.sendToken(tokenAddress as `0x${string}`, to as `0x${string}`, amount, decimals ?? 18);
    }

    // ============ COPY WALLET MANAGEMENT ============
    getCopyWallets() { return this.copyMonitor.getWallets(); }
    addCopyWallet(address: string, name: string): void {
        this.copyMonitor.addWallet(address, name, false);
        dbAddCopyWallet(address, name);
        this.addLog('info', `Whale ditambahkan: ${name}`, address);
    }
    removeCopyWallet(address: string): void {
        this.copyMonitor.removeWallet(address);
        dbRemoveCopyWallet(address);
        this.addLog('info', `Whale dihapus`, address);
    }
    toggleCopyWallet(address: string, active: boolean): void {
        this.copyMonitor.toggleWallet(address, active);
        dbUpdateCopyWallet(address, { isActive: active });
    }
    renameCopyWallet(address: string, name: string): void {
        this.copyMonitor.renameWallet(address, name);
        dbUpdateCopyWallet(address, { name });
    }

    getTradeHistory(): { trades: any[]; stats: any } {
        const trades   = dbGetTrades(200);
        const withPnl  = trades.filter(t => t.profitPct !== null && t.profitPct !== undefined);
        const wins     = withPnl.filter(t => (t.profitPct ?? 0) > 0).length;
        const losses   = withPnl.filter(t => (t.profitPct ?? 0) <= 0).length;
        const winRate  = withPnl.length > 0 ? (wins / withPnl.length) * 100 : 0;
        const totalPnl = withPnl.reduce((s, t) => s + (t.profitPct ?? 0), 0);
        const sorted   = [...withPnl].sort((a, b) => (b.profitPct ?? 0) - (a.profitPct ?? 0));
        return {
            trades,
            stats: { total: trades.length, wins, losses, winRate, totalProfitPct: totalPnl, bestTrade: sorted[0] ?? null, worstTrade: sorted[sorted.length - 1] ?? null }
        };
    }

    async checkDeployerReputation(address: string) {
        const deployer = await getTokenDeployer(address) ?? address;
        return getDeployerReputation(deployer);
    }

    getBlacklist(): { address: string; addedAt: number; label?: string }[] {
        return dbGetBlacklist();
    }
    addToBlacklist(address: string, label?: string): void {
        dbAddToBlacklist(address.toLowerCase(), label);
        this.addLog('info', `🚫 Token diblacklist`, `${label || ''} ${address}`);
    }
    removeFromBlacklist(address: string): void {
        dbRemoveFromBlacklist(address.toLowerCase());
        this.addLog('info', `✅ Token dihapus dari blacklist`, address);
    }

    getKeyStatus() {
        const ai = this.ai.getKeyStatus();
        return {
            privateKey:     !!this.executor,
            groqKey:        ai.groq,
            geminiKey:      ai.gemini,
            huggingfaceKey: ai.huggingface,
            appPassword:    !!(process.env.APP_PASSWORD),
            telegramToken:  !!(this.telegramToken),
            telegramChatId: !!(this.telegramChatId),
            backupHttpUrl:  !!(process.env.BACKUP_HTTP_URL),
            backupWssUrl:   !!(process.env.BACKUP_WSS_URL),
            basescanApiKey: !!(process.env.BASESCAN_API_KEY),
        };
    }

    // ============ RISK MANAGER PUBLIC API ============
    getRiskState() { return this.riskManager.getState(); }

    // ============ CACHE STATS ============
    getPerfCacheStats() { return getCacheStats(); }

    // ============ WHALE DETAIL ANALYSIS ============
    async analyzeWhaleDetail(address: string) {
        return analyzeWhale(address);
    }

    // ============ FEATURE 9: EMERGENCY STOP ============
    async emergencyStop(): Promise<{ stopped: boolean; positionsSold: number; message: string }> {
        console.log('\n🚨🚨🚨 EMERGENCY STOP TRIGGERED 🚨🚨🚨');
        this.emergencyStopActive = true;

        if (this.sentimentInterval)          { clearInterval(this.sentimentInterval);          this.sentimentInterval          = null; }
        if (this.whaleAutoScanInterval)      { clearInterval(this.whaleAutoScanInterval);      this.whaleAutoScanInterval      = null; }
        if (this.portfolioSummaryInterval)   { clearInterval(this.portfolioSummaryInterval);   this.portfolioSummaryInterval   = null; }
        this.scanner.disconnect();
        this.copyMonitor.stop();
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

    isEmergencyStopped(): boolean { return this.emergencyStopActive; }

    // ============ FEATURE 7: TOKEN NARRATIVE DETECTOR ============
    async detectNarrative(tokenAddress: string, symbol: string, name: string): Promise<{
        narrative: string; confidence: number; isHot: boolean; tags: string[];
    }> {
        const key    = tokenAddress.toLowerCase();
        const cached = this.narrativeCache.get(key);
        if (cached && cached.expiresAt > Date.now()) return JSON.parse(cached.data);

        const prompt =
            `Klasifikasikan token kripto berikut. Jawab JSON saja tanpa teks lain.\n` +
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
                    this.narrativeCache.set(key, { data: JSON.stringify(parsed), expiresAt: Date.now() + 3_600_000 });
                    return parsed;
                }
            }
        } catch { /* fallback */ }

        // Rule-based fallback
        const upper = (symbol + ' ' + name).toUpperCase();
        let narrative = 'Unknown'; let isHot = false; const tags: string[] = [];
        if (/\bAI\b|GPT|AGENT|NEURAL|BOT\b|ML\b/.test(upper))                { narrative = 'AI/ML';         isHot = true; tags.push('AI');   }
        else if (/PEPE|DOGE|SHIB|MEME|FROG|CAT|DOG|TRUMP|BASED/.test(upper)) { narrative = 'Meme';          isHot = true; tags.push('Meme'); }
        else if (/SWAP|DEX|YIELD|FARM|LIQUID|STAKE/.test(upper))              { narrative = 'DeFi/DEX';     tags.push('DeFi'); }
        else if (/GAME|PLAY|NFT|PIXEL|META/.test(upper))                      { narrative = 'Gaming';        tags.push('Gaming'); }
        else if (/BASE|L2|CHAIN|BRIDGE/.test(upper))                          { narrative = 'Infrastructure'; tags.push('L2'); }
        const result = { narrative, confidence: 55, isHot, tags };
        this.narrativeCache.set(key, { data: JSON.stringify(result), expiresAt: Date.now() + 3_600_000 });
        return result;
    }

    // ============ FEATURE 8: WHALE CORRELATION MAP ============
    getWhaleCorrelations() { return getActiveCorrelations(); }

    // ============ FEATURE 6: BACKTEST ============
    async runBacktest(tokenAddress: string, timeframe: '1h' | '15m' = '1h', config: Partial<BacktestConfig> = {}) {
        return runBacktest(tokenAddress, timeframe, config);
    }

    // ============ FEATURE 2: FULL TOKEN SAFETY CHECK ============
    async checkFullTokenSafety(tokenAddress: string) {
        return checkTokenSafety(tokenAddress);
    }

    // ============ FEATURE 10: DAILY P&L REPORT ============
    async getDailyPnlReport(): Promise<string> {
        const { trades, stats } = this.getTradeHistory();
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const todayTrades = trades.filter((t: any) => (t.closedAt ?? 0) >= todayStart.getTime());
        const withPnl     = todayTrades.filter((t: any) => t.profitPct !== null && t.profitPct !== undefined);
        const wins        = withPnl.filter((t: any) => (t.profitPct ?? 0) > 0).length;
        const losses      = withPnl.length - wins;
        const totalPnl    = withPnl.reduce((s: number, t: any) => s + (t.profitPct ?? 0), 0);
        const best        = withPnl.length > 0 ? Math.max(...withPnl.map((t: any) => t.profitPct ?? 0)) : 0;
        const worst       = withPnl.length > 0 ? Math.min(...withPnl.map((t: any) => t.profitPct ?? 0)) : 0;

        let ethLine = '';
        if (this.executor) {
            try {
                const { eth } = await this.executor.getBalance();
                const usd     = parseFloat(eth) * await getEthPriceUsd();
                ethLine = `💰 Saldo: ${parseFloat(eth).toFixed(5)} ETH (~$${usd.toFixed(2)})\n\n`;
            } catch { /* silent */ }
        }

        const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
        return (
            `📊 <b>Laporan P&L Harian — ${today}</b>\n\n` +
            ethLine +
            `📈 Trade Hari Ini: ${todayTrades.length}\n` +
            `✅ Profit: ${wins} | ❌ Rugi: ${losses}\n` +
            `💹 Total P&L: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(1)}%\n` +
            (withPnl.length > 0 ? `🏆 Terbaik: +${best.toFixed(1)}% | 📉 Terburuk: ${worst.toFixed(1)}%\n` : '') +
            `\n📅 Semua waktu: ${stats.total} trade | WR ${stats.winRate.toFixed(1)}%`
        );
    }

    private scheduleDailyReport(): void {
        const now      = new Date();
        const midnight = new Date(now);
        midnight.setHours(0, 0, 0, 0);
        midnight.setDate(midnight.getDate() + 1);
        const msLeft = midnight.getTime() - now.getTime();
        console.log(`📅 Daily P&L report dijadwalkan pada tengah malam (${Math.round(msLeft / 60000)} menit lagi)`);
        this.dailyReportTimer = setTimeout(() => {
            this.sendDailyReport();
            this.dailyReportInterval = setInterval(() => this.sendDailyReport(), 24 * 3_600_000);
        }, msLeft);
    }

    private async sendDailyReport(): Promise<void> {
        try {
            const report = await this.getDailyPnlReport();
            await this.sendTelegram(report);
            this.addLog('info', '📊 Daily P&L report terkirim ke Telegram', '');
        } catch (e: any) { console.error('Daily report error:', e?.message); }
    }

    getStatus() {
        const tradeHistory  = dbGetTrades(1);
        const riskState     = this.riskManager.getState();
        return {
            connected:       this.scanner.isConnectedToBase(),
            copyStats:       this.copyMonitor.getStats(),
            config:          this.scanner.getConfig(),
            aiStats:         this.ai.getStats(),
            openPositions:   this.executor?.getOpenPositions() ?? [],
            wallet:          this.executor?.getWalletAddress() ?? null,
            geckoScanner:    {
                enabled:    this.runtimeConfig.geckoScannerEnabled,
                seenTokens: this.geckoScanner.getSeenCount(),
            },
            smartScreener:   {
                enabled:    this.smartScreenerEnabled,
            },
            whaleAutoScan:   {
                enabled:    this.runtimeConfig.whaleAutoScanEnabled,
            },
            riskState,
            circuitBreaker:  {
                tripped:    riskState.circuitBreakerTripped,
                reason:     riskState.circuitBreakerReason,
                resetAt:    riskState.dailyResetAt,
            },
            pendingWhales:   dbGetPendingWhales().length,
            emergencyStop:   this.emergencyStopActive,
            lastTradeAt:     tradeHistory[0]?.closedAt ?? null,
            timestamp:       Date.now()
        };
    }
}

export default AISniperBot;
