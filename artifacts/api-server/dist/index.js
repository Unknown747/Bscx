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
const express_1 = __importDefault(require("express"));
const ai_sniper_integration_1 = require("./ai-sniper-integration");
const push_manager_1 = require("./push-manager");
const db_1 = require("./db");
const dotenv_1 = __importDefault(require("dotenv"));
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 8080;
// ── Session store ──────────────────────────────────────────────────────────────
const sessions = new Map();
const SESSION_TTL = 12 * 3600 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [t, exp] of sessions)
        if (exp < now)
            sessions.delete(t);
}, 3600000).unref();
// ── Rate limiting ──────────────────────────────────────────────────────────────
const authAttempts = new Map();
function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? 'unknown';
}
function isRateLimited(ip) {
    const now = Date.now();
    const e = authAttempts.get(ip);
    if (!e || e.resetAt < now) {
        authAttempts.set(ip, { count: 1, resetAt: now + 60000 });
        return false;
    }
    if (e.count >= 20)
        return true;
    e.count++;
    return false;
}
// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express_1.default.json());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
    if (req.method === 'OPTIONS')
        return res.sendStatus(204);
    next();
});
// ── Auth guard ────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
    const token = req.headers['x-session-token'];
    const expiry = token ? sessions.get(token) : undefined;
    if (!token || !expiry || expiry < Date.now()) {
        res.status(401).json({ error: 'Session invalid or expired. Please log in again.' });
        return;
    }
    next();
}
app.use((req, res, next) => {
    // Allow static assets and auth endpoint without session token
    if (!req.path.startsWith('/api/'))
        return next();
    if (req.path === '/api/auth/verify')
        return next();
    requireAuth(req, res, next);
});
// ── Initialize bot ────────────────────────────────────────────────────────────
const bot = new ai_sniper_integration_1.AISniperBot();
async function startBot() {
    await (0, db_1.initDb)();
    console.log('\n🚀 STARTING BASE SNIPER ULTIMATE (GeckoTerminal Edition)...');
    console.log(`💰 Capital: ${process.env.TOTAL_CAPITAL_ETH || 0.006} ETH`);
    console.log(`🐋 Copy Trading: ${process.env.COPY_TRADING_ENABLED === 'true' ? 'ACTIVE' : 'DISABLED'}`);
    console.log(`🤖 AI Mode: ${process.env.AI_ENABLED === 'true' ? 'ACTIVE' : 'DISABLED'}`);
    console.log(`🦎 GeckoTerminal Scanner: ${process.env.GECKO_SCANNER_ENABLED === 'true' ? 'ACTIVE' : 'DISABLED'}`);
    console.log(`🐋 Whale Auto-Scan: ${process.env.WHALE_AUTO_SCAN_ENABLED === 'true' ? 'ACTIVE' : 'DISABLED'}`);
    await bot.start();
}
// ============ AUTH ENDPOINT ============
app.post('/api/auth/verify', (req, res) => {
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
        res.status(429).json({ ok: false, error: 'Too many attempts. Please try again in 1 minute.' });
        return;
    }
    const { password } = req.body;
    const expected = (process.env.APP_PASSWORD || '').trim();
    if (!expected) {
        res.status(500).json({ error: 'APP_PASSWORD not configured' });
        return;
    }
    if (!password) {
        res.status(400).json({ ok: false, error: 'Password required' });
        return;
    }
    const trimmedPassword = String(password).trim();
    const match = trimmedPassword.length === expected.length &&
        crypto_1.default.timingSafeEqual(Buffer.from(trimmedPassword), Buffer.from(expected));
    if (match) {
        const token = crypto_1.default.randomBytes(32).toString('hex');
        sessions.set(token, Date.now() + SESSION_TTL);
        res.json({ ok: true, token });
    }
    else {
        res.status(401).json({ ok: false, error: 'Incorrect password' });
    }
});
// ============ CORE STATUS & CONFIG ============
app.get('/api/status', (_req, res) => {
    res.json(bot.getStatus());
});
app.get('/api/positions', (_req, res) => {
    const status = bot.getStatus();
    res.json({ positions: status.openPositions, wallet: status.wallet, timestamp: Date.now() });
});
app.get('/api/config', (_req, res) => {
    const rc = bot.getRuntimeConfig();
    res.json({
        capital: String(rc.totalCapital),
        maxTrade: String(rc.maxTradeAmount),
        minLiquidity: String(rc.minLiquidity),
        maxSlippage: String(rc.maxSlippage),
        copyEnabled: rc.copyEnabled,
        copyAmount: String(rc.copyAmount),
        copyDelaySeconds: String(rc.copyDelay),
        copyMaxPerDay: String(rc.copyMaxPerDay),
        minSafetyScore: String(rc.minSafetyScore),
        maxPoolAgeSeconds: String(rc.maxPoolAgeSeconds),
        aiEnabled: rc.aiEnabled,
        tp1Multiplier: rc.tp1Multiplier,
        tp1Percentage: rc.tp1Percentage,
        tp2Multiplier: rc.tp2Multiplier,
        tp2Percentage: rc.tp2Percentage,
        stopLoss: rc.stopLoss,
        maxPriorityFee: String(rc.maxPriorityFee),
        maxFeePerGas: String(rc.maxFeePerGas),
        serialRuggerEnabled: rc.serialRuggerEnabled,
        serialRuggerMaxDeploys: String(rc.serialRuggerMaxDeploys),
        serialRuggerWindowHours: String(rc.serialRuggerWindowHours),
        reputationEnabled: rc.reputationEnabled,
        reputationMinScore: String(rc.reputationMinScore),
        dynamicSizingEnabled: rc.dynamicSizingEnabled,
        tradeBalancePct: String(rc.tradeBalancePct),
        geckoScannerEnabled: rc.geckoScannerEnabled,
        whaleValidationEnabled: rc.whaleValidationEnabled,
        whaleAutoScanEnabled: rc.whaleAutoScanEnabled,
        blockHoneypot: rc.blockHoneypot,
        blockHighTax: rc.blockHighTax,
        maxTaxPercent: String(rc.maxTaxPercent),
        minAiConfidence: String(rc.minAiConfidence),
        enableFlashblocks: rc.enableFlashblocks,
        gasMode: rc.gasMode,
        dcaEnabled: rc.dcaEnabled,
    });
});
app.post('/api/settings', (req, res) => {
    const s = req.body;
    if (!s || typeof s !== 'object') {
        res.status(400).json({ error: 'Invalid payload' });
        return;
    }
    try {
        bot.updateRuntimeConfig({
            totalCapital: s.totalCapital,
            maxTradeAmount: s.maxTradeAmount,
            minLiquidity: s.minLiquidity,
            maxSlippage: s.maxSlippage,
            tp1Multiplier: s.tp1Multiplier,
            tp1Percentage: s.tp1Percentage,
            tp2Multiplier: s.tp2Multiplier,
            tp2Percentage: s.tp2Percentage,
            stopLoss: s.stopLoss,
            maxPriorityFee: s.maxPriorityFee,
            maxFeePerGas: s.maxFeePerGas,
            copyEnabled: s.copyEnabled,
            copyAmount: s.copyAmount,
            copyDelay: s.copyDelay,
            copyMaxPerDay: s.copyMaxPerDay,
            minSafetyScore: s.minSafetyScore,
            maxPoolAgeSeconds: s.maxPoolAgeSeconds,
            aiEnabled: s.aiEnabled,
            dcaEnabled: s.dcaEnabled,
            serialRuggerEnabled: s.serialRuggerEnabled,
            serialRuggerMaxDeploys: s.serialRuggerMaxDeploys,
            serialRuggerWindowHours: s.serialRuggerWindowHours,
            reputationEnabled: s.reputationEnabled,
            reputationMinScore: s.reputationMinScore,
            dynamicSizingEnabled: s.dynamicSizingEnabled,
            tradeBalancePct: s.tradeBalancePct,
            geckoScannerEnabled: s.geckoScannerEnabled,
            whaleAutoScanEnabled: s.whaleAutoScanEnabled,
            blockHoneypot: s.blockHoneypot,
            blockHighTax: s.blockHighTax,
            maxTaxPercent: s.maxTaxPercent,
            minAiConfidence: s.minAiConfidence,
            enableFlashblocks: s.enableFlashblocks,
            gasMode: s.gasMode,
        });
        res.json({ ok: true, message: 'Settings applied successfully' });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ============ SMART SCREENER ============
app.get('/api/screener/signals', (_req, res) => {
    const minSig = _req.query.minSignal;
    const valid = ['STRONG_BUY', 'BUY', 'WATCH', 'SKIP'];
    const min = valid.includes(minSig ?? '') ? minSig : undefined;
    res.json({
        signals: bot.getScreenerSignals(min),
        enabled: bot.isSmartScreenerEnabled(),
        timestamp: Date.now(),
    });
});
app.get('/api/screener/stats', (_req, res) => {
    res.json({ ...bot.getScreenerStats(), enabled: bot.isSmartScreenerEnabled() });
});
app.get('/api/screener/config', (_req, res) => {
    res.json(bot.getScreenerConfig());
});
app.post('/api/screener/config', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Invalid payload' });
        return;
    }
    try {
        bot.updateScreenerConfig(body);
        res.json({ ok: true, config: bot.getScreenerConfig() });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/screener/toggle', (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled must be boolean' });
        return;
    }
    bot.setSmartScreenerEnabled(enabled);
    res.json({ ok: true, enabled });
});
// ============ CHART (OHLCV via GeckoTerminal) ============
// Simple in-process cache: tokenAddress → { data, expiresAt }
const chartCache = new Map();
const CHART_TTL_MS = 10000; // 10-second cache
app.get('/api/chart/:tokenAddress', async (req, res) => {
    const { tokenAddress } = req.params;
    if (!tokenAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Invalid token address' });
        return;
    }
    const cacheKey = tokenAddress.toLowerCase();
    const cached = chartCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        res.json(cached.data);
        return;
    }
    try {
        const { default: axios } = await Promise.resolve().then(() => __importStar(require('axios')));
        const GT = 'https://api.geckoterminal.com/api/v2';
        const headers = { 'Accept': 'application/json;version=20230302' };
        // Step 1: find the best pool for this token on Base
        const poolsRes = await axios.get(`${GT}/networks/base/tokens/${tokenAddress}/pools?page=1`, { headers, timeout: 8000 });
        const pools = poolsRes.data?.data ?? [];
        if (!pools.length) {
            res.status(404).json({ error: 'No pool found for this token' });
            return;
        }
        // Pick the pool with the highest liquidity
        const bestPool = pools.reduce((best, p) => {
            const liq = parseFloat(p.attributes?.reserve_in_usd ?? '0');
            return liq > parseFloat(best.attributes?.reserve_in_usd ?? '0') ? p : best;
        }, pools[0]);
        const poolAddress = bestPool.attributes?.address;
        if (!poolAddress) {
            res.status(404).json({ error: 'Pool address unavailable' });
            return;
        }
        // Step 2: fetch 5-minute OHLCV candles (last 40)
        const ohlcvRes = await axios.get(`${GT}/networks/base/pools/${poolAddress}/ohlcv/minute?aggregate=5&limit=40&currency=usd`, { headers, timeout: 8000 });
        const rawList = ohlcvRes.data?.data?.attributes?.ohlcv_list ?? [];
        // GeckoTerminal returns newest-first — reverse to oldest-first
        const candles = [...rawList].reverse().map(([ts, o, h, l, c, v]) => ({
            t: ts * 1000, // ms
            o, h, l, c, v
        }));
        const result = {
            poolAddress,
            poolName: bestPool.attributes?.name ?? poolAddress,
            liquidityUsd: parseFloat(bestPool.attributes?.reserve_in_usd ?? '0'),
            candles,
            fetchedAt: Date.now()
        };
        chartCache.set(cacheKey, { data: result, expiresAt: Date.now() + CHART_TTL_MS });
        res.json(result);
    }
    catch (err) {
        const status = err.response?.status;
        if (status === 404) {
            res.status(404).json({ error: 'Token tidak ditemukan di GeckoTerminal' });
        }
        else {
            res.status(500).json({ error: err.message ?? 'Gagal fetch data chart' });
        }
    }
});
// ============ ETH PRICE ============
app.get('/api/eth-price', async (_req, res) => {
    try {
        const { getEthPriceUsd } = await Promise.resolve().then(() => __importStar(require('./price-oracle')));
        const price = await getEthPriceUsd();
        res.json({ usd: price, timestamp: Date.now() });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ============ LIVE PnL & PORTFOLIO ============
app.get('/api/pnl', async (_req, res) => {
    try {
        res.json({ pnl: await bot.getLivePnL(), timestamp: Date.now() });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/portfolio', async (_req, res) => {
    try {
        res.json({ ...await bot.getPortfolio(), timestamp: Date.now() });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ============ SEND FUNDS ============
app.post('/api/send', async (req, res) => {
    const { type, to, amount, tokenAddress, decimals } = req.body;
    if (!to || typeof to !== 'string' || !to.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat tujuan tidak valid' });
        return;
    }
    if (!amount || typeof amount !== 'number' || amount <= 0) {
        res.status(400).json({ error: 'Jumlah tidak valid' });
        return;
    }
    if (!['eth', 'token'].includes(type)) {
        res.status(400).json({ error: 'type harus "eth" atau "token"' });
        return;
    }
    try {
        res.json(await bot.sendFunds(type, to, amount, tokenAddress, decimals));
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ============ MANUAL SELL ============
app.post('/api/sell', async (req, res) => {
    const { tokenAddress, percent } = req.body;
    if (!tokenAddress || typeof tokenAddress !== 'string' || !tokenAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Invalid tokenAddress' });
        return;
    }
    const pct = typeof percent === 'number' ? percent : 100;
    try {
        res.json(await bot.manualSell(tokenAddress, pct));
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ============ COPY WALLET MANAGEMENT ============
app.get('/api/wallets', (_req, res) => {
    res.json({ wallets: bot.getCopyWallets() });
});
app.post('/api/wallets', (req, res) => {
    const { address, name } = req.body;
    if (!address || typeof address !== 'string' || !address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Invalid wallet address' });
        return;
    }
    const label = (name || '').trim() || `Whale ${address.slice(0, 8)}`;
    const existing = bot.getCopyWallets().find(w => w.address.toLowerCase() === address.toLowerCase());
    if (existing) {
        res.status(409).json({ error: 'Wallet already exists in the list' });
        return;
    }
    bot.addCopyWallet(address, label);
    res.json({ ok: true, wallets: bot.getCopyWallets() });
});
app.delete('/api/wallets/:address', (req, res) => {
    bot.removeCopyWallet(req.params.address);
    res.json({ ok: true, wallets: bot.getCopyWallets() });
});
app.patch('/api/wallets/:address', (req, res) => {
    const { address } = req.params;
    const { name, active } = req.body;
    if (name !== undefined)
        bot.renameCopyWallet(address, name);
    if (active !== undefined)
        bot.toggleCopyWallet(address, !!active);
    res.json({ ok: true, wallets: bot.getCopyWallets() });
});
// ============ KEY MANAGEMENT ============
app.get('/api/keys', (_req, res) => {
    res.json(bot.getKeyStatus());
});
app.post('/api/keys', (req, res) => {
    const { privateKey, groqKey, geminiKey, huggingfaceKey, appPassword, telegramToken, telegramChatId, baseWssUrl, baseHttpUrl, backupWssUrl, backupHttpUrl, basescanApiKey } = req.body;
    if (!privateKey && !groqKey && !geminiKey && !huggingfaceKey && !appPassword && !telegramToken && !telegramChatId
        && !baseWssUrl && !baseHttpUrl && !backupWssUrl && !backupHttpUrl && !basescanApiKey) {
        res.status(400).json({ error: 'No keys provided' });
        return;
    }
    if (privateKey)
        process.env.PRIVATE_KEY = privateKey;
    if (groqKey)
        process.env.GROQ_API_KEY = groqKey;
    if (geminiKey)
        process.env.GEMINI_API_KEY = geminiKey;
    if (huggingfaceKey)
        process.env.HUGGINGFACE_API_KEY = huggingfaceKey;
    if (appPassword)
        process.env.APP_PASSWORD = appPassword;
    if (telegramToken)
        process.env.TELEGRAM_BOT_TOKEN = telegramToken;
    if (telegramChatId)
        process.env.TELEGRAM_CHAT_ID = telegramChatId;
    if (baseWssUrl)
        process.env.BASE_WSS_URL = baseWssUrl;
    if (baseHttpUrl)
        process.env.BASE_HTTP_URL = baseHttpUrl;
    if (backupWssUrl)
        process.env.BACKUP_WSS_URL = backupWssUrl;
    if (backupHttpUrl)
        process.env.BACKUP_HTTP_URL = backupHttpUrl;
    if (basescanApiKey)
        process.env.BASESCAN_API_KEY = basescanApiKey;
    bot.updateKeys({ privateKey, groqKey, geminiKey, huggingfaceKey, telegramToken, telegramChatId });
    res.json({ ok: true, status: bot.getKeyStatus() });
});
// ============ HISTORY & LOGS ============
app.get('/api/history', (_req, res) => {
    res.json(bot.getTradeHistory());
});
// Alias for frontend compatibility
app.get('/api/trades', (_req, res) => {
    res.json(bot.getTradeHistory());
});
// Alias PATCH /api/config → same as POST /api/settings
app.patch('/api/config', (req, res) => {
    const s = req.body;
    if (!s || typeof s !== 'object') {
        res.status(400).json({ error: 'Invalid payload' });
        return;
    }
    try {
        bot.updateRuntimeConfig({
            totalCapital: s.totalCapital, maxTradeAmount: s.maxTradeAmount,
            minLiquidity: s.minLiquidity, maxSlippage: s.maxSlippage,
            tp1Multiplier: s.tp1Multiplier, tp1Percentage: s.tp1Percentage,
            tp2Multiplier: s.tp2Multiplier, tp2Percentage: s.tp2Percentage,
            stopLoss: s.stopLoss, maxPriorityFee: s.maxPriorityFee, maxFeePerGas: s.maxFeePerGas,
            copyEnabled: s.copyEnabled, copyAmount: s.copyAmount, copyDelay: s.copyDelay,
            copyMaxPerDay: s.copyMaxPerDay, minSafetyScore: s.minSafetyScore,
            maxPoolAgeSeconds: s.maxPoolAgeSeconds, aiEnabled: s.aiEnabled, dcaEnabled: s.dcaEnabled,
            serialRuggerEnabled: s.serialRuggerEnabled, serialRuggerMaxDeploys: s.serialRuggerMaxDeploys,
            serialRuggerWindowHours: s.serialRuggerWindowHours, reputationEnabled: s.reputationEnabled,
            reputationMinScore: s.reputationMinScore, dynamicSizingEnabled: s.dynamicSizingEnabled,
            tradeBalancePct: s.tradeBalancePct, geckoScannerEnabled: s.geckoScannerEnabled,
            whaleAutoScanEnabled: s.whaleAutoScanEnabled,
            blockHoneypot: s.blockHoneypot, blockHighTax: s.blockHighTax,
            maxTaxPercent: s.maxTaxPercent, minAiConfidence: s.minAiConfidence,
            enableFlashblocks: s.enableFlashblocks, gasMode: s.gasMode,
        });
        res.json({ ok: true, message: 'Settings applied successfully' });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/logs', (_req, res) => {
    res.json({ logs: bot.getActivityLog(), timestamp: Date.now() });
});
// ============ TELEGRAM ============
app.post('/api/telegram/test', async (_req, res) => {
    const result = await bot.testTelegram();
    res.status(result.ok ? 200 : 400).json(result);
});
// ============ WEB PUSH NOTIFICATIONS ============
// GET /api/push/vapid-key — public VAPID key (no auth needed for service worker registration)
app.get('/api/push/vapid-key', (_req, res) => {
    res.json({ publicKey: (0, push_manager_1.getVapidPublicKey)() });
});
// GET /api/push/status — how many subscriptions are active
app.get('/api/push/status', requireAuth, (_req, res) => {
    res.json({ count: (0, push_manager_1.getSubscriptionCount)() });
});
// POST /api/push/subscribe — save a push subscription
app.post('/api/push/subscribe', requireAuth, (req, res) => {
    const sub = req.body;
    if (!sub || !sub.endpoint || !sub.keys) {
        res.status(400).json({ error: 'Subscription tidak valid' });
        return;
    }
    try {
        (0, push_manager_1.savePushSubscription)(sub);
        res.json({ ok: true, count: (0, push_manager_1.getSubscriptionCount)() });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// DELETE /api/push/unsubscribe — remove a push subscription
app.delete('/api/push/unsubscribe', requireAuth, (req, res) => {
    const { endpoint } = req.body;
    if (!endpoint || typeof endpoint !== 'string') {
        res.status(400).json({ error: 'Endpoint tidak valid' });
        return;
    }
    (0, push_manager_1.removePushSubscription)(endpoint);
    res.json({ ok: true, count: (0, push_manager_1.getSubscriptionCount)() });
});
// ============ REPUTATION ============
app.get('/api/reputation/:address', async (req, res) => {
    const { address } = req.params;
    if (!address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat tidak valid' });
        return;
    }
    try {
        res.json(await bot.checkDeployerReputation(address));
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ============ BLACKLIST ============
app.get('/api/blacklist', (_req, res) => {
    res.json({ blacklist: bot.getBlacklist() });
});
app.post('/api/blacklist', (req, res) => {
    const { address, label } = req.body;
    if (!address || typeof address !== 'string' || !address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat token tidak valid' });
        return;
    }
    bot.addToBlacklist(address, label?.trim() || undefined);
    res.json({ ok: true, blacklist: bot.getBlacklist() });
});
app.delete('/api/blacklist/:address', (req, res) => {
    bot.removeFromBlacklist(req.params.address);
    res.json({ ok: true, blacklist: bot.getBlacklist() });
});
// ============ WHALE FINDER ============
// GET /api/whale/pending — list pending candidates waiting for approval
app.get('/api/whale/pending', (_req, res) => {
    res.json({ candidates: bot.getPendingWhales() });
});
// GET /api/whale/all — list all candidates (pending + approved + rejected)
app.get('/api/whale/all', (_req, res) => {
    res.json({ candidates: bot.getAllWhales() });
});
// POST /api/whale/scan — trigger manual scan now (always bypasses cooldown)
app.post('/api/whale/scan', async (_req, res) => {
    try {
        const candidates = await bot.runWhaleScan(true);
        res.json({ ok: true, found: candidates.length, candidates });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/whale/approve — (legacy alias) redirect to monitoring flow
app.post('/api/whale/approve', (req, res) => {
    const { address, name } = req.body;
    if (!address || typeof address !== 'string' || !address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Invalid address' });
        return;
    }
    const ok = bot.addToMonitoring(address, name);
    if (!ok) {
        res.status(404).json({ error: 'Candidate not found or already processed' });
        return;
    }
    res.json({ ok: true, message: 'Wallet added to monitoring — bot will observe trades before copying' });
});
// POST /api/whale/reject — reject a candidate
app.post('/api/whale/reject', (req, res) => {
    const { address } = req.body;
    if (!address || typeof address !== 'string' || !address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Invalid address' });
        return;
    }
    bot.rejectWhale(address);
    res.json({ ok: true });
});
// ============ SIMULATION ============
// POST /api/simulate — estimate P&L for following a whale on a specific token
app.post('/api/simulate', async (req, res) => {
    const { walletAddress, tokenAddress } = req.body;
    if (!walletAddress || !tokenAddress) {
        res.status(400).json({ error: 'walletAddress and tokenAddress required' });
        return;
    }
    if (!walletAddress.match(/^0x[0-9a-fA-F]{40}$/) || !tokenAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Invalid address' });
        return;
    }
    try {
        const result = await bot.simulateCopyTrade(walletAddress, tokenAddress);
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ============ RISK MANAGER ============
app.get('/api/risk', (_req, res) => {
    try {
        res.json({ riskState: bot.getRiskState(), timestamp: Date.now() });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ============ WHALE DETAIL (pro analysis) ============
app.get('/api/whale/detail/:address', async (req, res) => {
    const { address } = req.params;
    if (!address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Invalid address' });
        return;
    }
    try {
        const [analysis, waitlistEvents] = await Promise.all([
            bot.analyzeWhaleDetail(address),
            Promise.resolve().then(() => __importStar(require('./db'))).then(m => ({
                events: m.dbGetWaitlistEvents(address, 30),
                summary: m.dbGetWaitlistSummary(address),
            }))
        ]);
        res.json({ address, analysis, ...waitlistEvents, timestamp: Date.now() });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ============ PERFORMANCE CACHE ============
app.get('/api/cache', (_req, res) => {
    res.json({ ...bot.getPerfCacheStats(), timestamp: Date.now() });
});
// ============ WHALE MONITORING FLOW ============
// GET /api/whale/monitor-status — returns on-chain monitoring status
app.get('/api/whale/monitor-status', (_req, res) => {
    res.json({
        basescanEnabled: true,
        dataSource: 'blockscout',
        blockscoutEnabled: true,
        timestamp: Date.now(),
    });
});
// GET /api/whale/blockscout/:address/trades — live feed 10 tx terbaru dari Blockscout
app.get('/api/whale/blockscout/:address/trades', async (req, res) => {
    const { address } = req.params;
    if (!address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat tidak valid' });
        return;
    }
    try {
        const { fetchRecentTrades } = await Promise.resolve().then(() => __importStar(require('./basescan-monitor')));
        const limit = Math.min(20, parseInt(String(req.query.limit ?? '10')) || 10);
        const trades = await fetchRecentTrades(address, limit);
        res.json({ ok: true, address, trades, fetchedAt: Date.now() });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/whale/rescan/:address — force re-scan a wallet from scratch via Blockscout
app.post('/api/whale/rescan/:address', async (req, res) => {
    const { address } = req.params;
    if (!address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat tidak valid' });
        return;
    }
    try {
        const { resetWalletCache, analyzeWalletOnChain } = await Promise.resolve().then(() => __importStar(require('./basescan-monitor')));
        resetWalletCache(address);
        const wallet = bot.getMonitoredWallets().find(w => w.address.toLowerCase() === address.toLowerCase());
        const sinceMs = wallet ? wallet.monitoredSince : Date.now() - 30 * 86400000;
        const result = await analyzeWalletOnChain(address, sinceMs);
        res.json({ ok: true, result });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/whale/monitor — move pending candidate to monitoring (not copied yet)
app.post('/api/whale/monitor', (req, res) => {
    const { address, name } = req.body;
    if (!address || typeof address !== 'string' || !address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat tidak valid' });
        return;
    }
    const ok = bot.addToMonitoring(address, name);
    if (!ok) {
        res.status(404).json({ error: 'Kandidat tidak ditemukan atau sudah diproses' });
        return;
    }
    res.json({ ok: true, message: 'Wallet masuk monitoring — bot akan mengamati trade-nya' });
});
// GET /api/whale/monitored — list all monitored wallets with stats
app.get('/api/whale/monitored', (_req, res) => {
    res.json({ wallets: bot.getMonitoredWallets(), timestamp: Date.now() });
});
// DELETE /api/whale/monitored/:address — remove from monitoring
app.delete('/api/whale/monitored/:address', (req, res) => {
    const { address } = req.params;
    if (!address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat tidak valid' });
        return;
    }
    bot.removeFromMonitoring(address);
    res.json({ ok: true });
});
// POST /api/whale/evaluate/:address — trigger AI evaluation
app.post('/api/whale/evaluate/:address', async (req, res) => {
    const { address } = req.params;
    if (!address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat tidak valid' });
        return;
    }
    try {
        const result = await bot.evaluateMonitoredWallet(address);
        res.json({ ok: true, ...result });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/whale/promote/:address — promote AI-approved wallet to active copy
app.post('/api/whale/promote/:address', (req, res) => {
    const { address } = req.params;
    if (!address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat tidak valid' });
        return;
    }
    const ok = bot.promoteToActiveCopy(address);
    if (!ok) {
        res.status(400).json({ error: 'Wallet belum disetujui AI atau tidak ditemukan di monitoring' });
        return;
    }
    res.json({ ok: true, message: 'Wallet berhasil dipromosikan ke copy wallet aktif!' });
});
// POST /api/whale/force-promote/:address — manual override: promote regardless of AI verdict
app.post('/api/whale/force-promote/:address', requireAuth, (req, res) => {
    const { address } = req.params;
    if (!address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat tidak valid' });
        return;
    }
    const ok = bot.forcePromoteWallet(address);
    if (!ok) {
        res.status(404).json({ error: 'Wallet tidak ditemukan di monitoring' });
        return;
    }
    res.json({ ok: true, message: 'Wallet dipromosikan secara manual ke copy wallet aktif!' });
});
// ============ FITUR BARU: EMERGENCY STOP, BACKTEST, CORRELATION, NARRATIVE, SAFETY ============
// POST /api/emergency-stop — Feature 9: hentikan semua & jual semua posisi
app.post('/api/emergency-stop', requireAuth, async (req, res) => {
    try {
        const result = await bot.emergencyStop();
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/backtest — Feature 6: jalankan backtest OHLCV GeckoTerminal
app.post('/api/backtest', requireAuth, async (req, res) => {
    const { tokenAddress, timeframe = '1h', config = {} } = req.body ?? {};
    if (!tokenAddress || !tokenAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'tokenAddress wajib diisi (format 0x...)' });
        return;
    }
    try {
        const result = await bot.runBacktest(tokenAddress, timeframe, config);
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/whale/correlation — Feature 8: correlation map aktif
app.get('/api/whale/correlation', requireAuth, (_req, res) => {
    try {
        res.json({ correlations: bot.getWhaleCorrelations(), timestamp: Date.now() });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/narrative/check — Feature 7: token narrative detector
app.post('/api/narrative/check', requireAuth, async (req, res) => {
    const { tokenAddress, symbol = 'UNKNOWN', name = 'Unknown' } = req.body ?? {};
    if (!tokenAddress || !tokenAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'tokenAddress wajib diisi' });
        return;
    }
    try {
        const result = await bot.detectNarrative(tokenAddress, symbol, name);
        res.json({ tokenAddress, ...result, timestamp: Date.now() });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/safety/:address — Feature 2: full token safety checker (GoPlus + Honeypot.is)
app.get('/api/safety/:address', requireAuth, async (req, res) => {
    const { address } = req.params;
    if (!address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat tidak valid' });
        return;
    }
    try {
        const result = await bot.checkFullTokenSafety(address);
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/daily-report — Feature 10: ambil laporan P&L hari ini (text for Telegram)
app.get('/api/daily-report', requireAuth, async (_req, res) => {
    try {
        const report = await bot.getDailyPnlReport();
        res.json({ report, timestamp: Date.now() });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/report — Structured JSON P&L report for dashboard (last 14 days breakdown)
app.get('/api/report', requireAuth, async (_req, res) => {
    try {
        const { trades, stats } = bot.getTradeHistory();
        // ── Today summary ─────────────────────────────────────────────────────
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayTs = todayStart.getTime();
        const todayTrades = trades.filter((t) => (t.closedAt ?? 0) >= todayTs);
        const todayWithPnl = todayTrades.filter((t) => t.profitPct !== null && t.profitPct !== undefined);
        const todayWins = todayWithPnl.filter((t) => (t.profitPct ?? 0) > 0).length;
        const todayLosses = todayWithPnl.length - todayWins;
        const todayPnl = todayWithPnl.reduce((s, t) => s + (t.profitPct ?? 0), 0);
        const todayBest = todayWithPnl.length > 0 ? Math.max(...todayWithPnl.map((t) => t.profitPct ?? 0)) : null;
        const todayWorst = todayWithPnl.length > 0 ? Math.min(...todayWithPnl.map((t) => t.profitPct ?? 0)) : null;
        // ── ETH balance ────────────────────────────────────────────────────────
        let ethBalance = null;
        let ethUsd = null;
        try {
            const portfolio = await bot.getPortfolio();
            ethBalance = portfolio.ethBalance ?? null;
            ethUsd = portfolio.ethValueUsd ?? null;
        }
        catch { /* silent */ }
        // ── Daily breakdown (last 14 days) ────────────────────────────────────
        const daily = [];
        for (let d = 13; d >= 0; d--) {
            const dayStart = new Date();
            dayStart.setHours(0, 0, 0, 0);
            dayStart.setDate(dayStart.getDate() - d);
            const dayEnd = new Date(dayStart);
            dayEnd.setDate(dayEnd.getDate() + 1);
            const dayTs = dayStart.getTime();
            const dayEndTs = dayEnd.getTime();
            const dayTrades = trades.filter((t) => {
                const ca = t.closedAt ?? 0;
                return ca >= dayTs && ca < dayEndTs;
            });
            const dayWithPnl = dayTrades.filter((t) => t.profitPct !== null && t.profitPct !== undefined);
            const dayWins = dayWithPnl.filter((t) => (t.profitPct ?? 0) > 0).length;
            const dayLosses = dayWithPnl.length - dayWins;
            const dayPnl = dayWithPnl.reduce((s, t) => s + (t.profitPct ?? 0), 0);
            const dayWr = dayWithPnl.length > 0 ? (dayWins / dayWithPnl.length) * 100 : 0;
            const label = dayStart.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
            daily.push({ date: label, dateMs: dayTs, trades: dayTrades.length, wins: dayWins, losses: dayLosses, totalPnlPct: parseFloat(dayPnl.toFixed(1)), winRate: parseFloat(dayWr.toFixed(1)) });
        }
        // ── Recent closed trades (last 15) ────────────────────────────────────
        const recentTrades = trades.slice(0, 15);
        res.json({
            today: {
                date: todayStart.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
                trades: todayTrades.length,
                wins: todayWins,
                losses: todayLosses,
                winRate: todayWithPnl.length > 0 ? parseFloat(((todayWins / todayWithPnl.length) * 100).toFixed(1)) : 0,
                totalPnlPct: parseFloat(todayPnl.toFixed(1)),
                bestPct: todayBest !== null ? parseFloat(todayBest.toFixed(1)) : null,
                worstPct: todayWorst !== null ? parseFloat(todayWorst.toFixed(1)) : null,
                ethBalance, ethUsd,
            },
            daily,
            allTime: {
                total: stats.total,
                wins: stats.wins,
                losses: stats.losses,
                winRate: parseFloat((stats.winRate ?? 0).toFixed(1)),
                totalPnlPct: parseFloat((stats.totalProfitPct ?? 0).toFixed(1)),
                bestTrade: stats.bestTrade ?? null,
                worstTrade: stats.worstTrade ?? null,
            },
            recentTrades,
            timestamp: Date.now(),
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ============ SERVE FRONTEND (production) ============
const frontendDist = (() => {
    const candidates = [
        path_1.default.join(__dirname, '../../base-sniper/dist'),
        path_1.default.join(process.cwd(), 'artifacts/base-sniper/dist'),
        path_1.default.join(process.cwd(), 'base-sniper/dist'),
    ];
    return candidates.find(p => fs_1.default.existsSync(p)) ?? candidates[0];
})();
app.use(express_1.default.static(frontendDist, { maxAge: '1d', etag: true }));
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    const indexFile = path_1.default.join(frontendDist, 'index.html');
    if (fs_1.default.existsSync(indexFile)) {
        res.sendFile(indexFile);
    }
    else {
        res.status(503).send('Frontend not built. Run: cd artifacts/base-sniper && npm run build');
    }
});
// ============ START SERVER ============
app.listen(PORT, () => {
    console.log(`🌐 API Server running on port ${PORT}`);
    startBot().catch(console.error);
});
function gracefulShutdown() {
    console.log('\n🛑 Shutting down...');
    bot.stop().finally(() => process.exit(0));
}
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
//# sourceMappingURL=index.js.map