import express, { Request, Response, NextFunction } from 'express';
import { AISniperBot } from './ai-sniper-integration';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// ── Session store (token → expiry ms) ─────────────────────────────────────────
const sessions    = new Map<string, number>();
const SESSION_TTL = 12 * 3600 * 1000; // 12 hours
setInterval(() => {
    const now = Date.now();
    for (const [t, exp] of sessions) if (exp < now) sessions.delete(t);
}, 3_600_000).unref();

// ── Server-side rate limiting for /api/auth/verify ────────────────────────────
const authAttempts = new Map<string, { count: number; resetAt: number }>();
function getClientIp(req: Request): string {
    return (req.headers['x-forwarded-for'] as string | undefined)
        ?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? 'unknown';
}
function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const e   = authAttempts.get(ip);
    if (!e || e.resetAt < now) { authAttempts.set(ip, { count: 1, resetAt: now + 60_000 }); return false; }
    if (e.count >= 20) return true;
    e.count++;
    return false;
}

// ============ MIDDLEWARE ============
app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ============ AUTH GUARD ============
function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const token  = req.headers['x-session-token'] as string | undefined;
    const expiry = token ? sessions.get(token) : undefined;
    if (!token || !expiry || expiry < Date.now()) {
        res.status(401).json({ error: 'Sesi tidak valid atau telah berakhir. Silakan login ulang.' });
        return;
    }
    next();
}
// Protect every route except the login endpoint itself
app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api/auth/verify') return next();
    requireAuth(req, res, next);
});

// ============ INITIALIZE BOT ============
// AISniperBot internally owns scanner + copyMonitor — single source of truth
const bot = new AISniperBot();

// ============ START BOT ============
async function startBot() {
    console.log('\n🚀 STARTING BASE SNIPER ULTIMATE...');
    console.log(`💰 Capital Mode: ${process.env.TOTAL_CAPITAL_ETH || 0.006} ETH (100rb)`);
    console.log(`🐋 Copy Trading: ${process.env.COPY_TRADING_ENABLED === 'true' ? 'ACTIVE' : 'DISABLED'}`);
    console.log(`🤖 AI Mode: ${process.env.AI_ENABLED === 'true' ? 'ACTIVE' : 'DISABLED'}`);

    await bot.start();
}

// ============ AUTH ENDPOINT (public — exempt from requireAuth) ============
app.post('/api/auth/verify', (req: Request, res: Response) => {
    // Server-side rate limit: max 20 attempts per minute per IP
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
        res.status(429).json({ ok: false, error: 'Terlalu banyak percobaan. Coba lagi dalam 1 menit.' });
        return;
    }

    const { password } = req.body;
    const expected = process.env.APP_PASSWORD || '';

    if (!expected) {
        res.status(500).json({ error: 'APP_PASSWORD belum dikonfigurasi' });
        return;
    }

    if (!password) {
        res.status(400).json({ ok: false, error: 'Password diperlukan' });
        return;
    }

    const match =
        password.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expected));

    if (match) {
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, Date.now() + SESSION_TTL);
        res.json({ ok: true, token });
    } else {
        res.status(401).json({ ok: false, error: 'Password salah' });
    }
});

// ============ API ENDPOINTS ============
app.get('/api/status', (_req: Request, res: Response) => {
    res.json(bot.getStatus());
});

app.get('/api/positions', (_req: Request, res: Response) => {
    const status = bot.getStatus();
    res.json({
        positions: status.openPositions,
        wallet:    status.wallet,
        timestamp: Date.now()
    });
});

// POST /api/settings — apply new config at runtime
app.post('/api/settings', (req: Request, res: Response) => {
    const s = req.body;
    if (!s || typeof s !== 'object') {
        res.status(400).json({ error: 'Invalid payload' });
        return;
    }

    try {
        bot.updateRuntimeConfig({
            totalCapital:     s.totalCapital,
            maxTradeAmount:   s.maxTradeAmount,
            minLiquidity:     s.minLiquidity,
            maxSlippage:      s.maxSlippage,
            tp1Multiplier:    s.tp1Multiplier,
            tp1Percentage:    s.tp1Percentage,
            tp2Multiplier:    s.tp2Multiplier,
            tp2Percentage:    s.tp2Percentage,
            stopLoss:         s.stopLoss,
            maxPriorityFee:   s.maxPriorityFee,
            maxFeePerGas:     s.maxFeePerGas,
            copyEnabled:      s.copyEnabled,
            copyAmount:       s.copyAmount,
            copyDelay:        s.copyDelay,
            copyMaxPerDay:    s.copyMaxPerDay,
            minSafetyScore:   s.minSafetyScore,
            maxPoolAgeSeconds:s.maxPoolAgeSeconds,
            aiEnabled:        s.aiEnabled,
            dcaEnabled:       s.dcaEnabled,
            serialRuggerEnabled:     s.serialRuggerEnabled,
            serialRuggerMaxDeploys:  s.serialRuggerMaxDeploys,
            serialRuggerWindowHours: s.serialRuggerWindowHours,
            reputationEnabled:       s.reputationEnabled,
            reputationMinScore:      s.reputationMinScore
        });
        res.json({ ok: true, message: 'Pengaturan berhasil diterapkan' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ============ LIVE PnL ENDPOINT ============
app.get('/api/pnl', async (_req: Request, res: Response) => {
    try {
        const pnl = await bot.getLivePnL();
        res.json({ pnl, timestamp: Date.now() });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ============ PORTFOLIO ENDPOINT ============
app.get('/api/portfolio', async (_req: Request, res: Response) => {
    try {
        const data = await bot.getPortfolio();
        res.json({ ...data, timestamp: Date.now() });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ============ SEND FUNDS ENDPOINT ============
app.post('/api/send', async (req: Request, res: Response) => {
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
        const result = await bot.sendFunds(type, to, amount, tokenAddress, decimals);
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ============ MANUAL SELL ENDPOINT ============
app.post('/api/sell', async (req: Request, res: Response) => {
    const { tokenAddress, percent } = req.body;
    if (!tokenAddress || typeof tokenAddress !== 'string' || !tokenAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'tokenAddress tidak valid' });
        return;
    }
    const pct = typeof percent === 'number' ? percent : 100;
    try {
        const result = await bot.manualSell(tokenAddress, pct);
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ============ COPY WALLET MANAGEMENT ENDPOINTS ============
app.get('/api/wallets', (_req: Request, res: Response) => {
    res.json({ wallets: bot.getCopyWallets() });
});

app.post('/api/wallets', (req: Request, res: Response) => {
    const { address, name } = req.body;
    if (!address || typeof address !== 'string' || !address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat wallet tidak valid (harus format 0x...)' });
        return;
    }
    const label = (name || '').trim() || `Whale ${address.slice(0, 8)}`;
    const existing = bot.getCopyWallets().find(w => w.address.toLowerCase() === address.toLowerCase());
    if (existing) {
        res.status(409).json({ error: 'Wallet sudah ada dalam daftar' });
        return;
    }
    bot.addCopyWallet(address, label);
    res.json({ ok: true, wallets: bot.getCopyWallets() });
});

app.delete('/api/wallets/:address', (req: Request, res: Response) => {
    const { address } = req.params;
    bot.removeCopyWallet(address);
    res.json({ ok: true, wallets: bot.getCopyWallets() });
});

app.patch('/api/wallets/:address', (req: Request, res: Response) => {
    const { address } = req.params;
    const { name, active } = req.body;
    if (name   !== undefined) bot.renameCopyWallet(address, name);
    if (active !== undefined) bot.toggleCopyWallet(address, !!active);
    res.json({ ok: true, wallets: bot.getCopyWallets() });
});

// ============ KEY MANAGEMENT ENDPOINTS ============
app.get('/api/keys', (_req: Request, res: Response) => {
    res.json(bot.getKeyStatus());
});

app.post('/api/keys', (req: Request, res: Response) => {
    const { privateKey, groqKey, geminiKey, huggingfaceKey, appPassword, telegramToken, telegramChatId } = req.body;

    if (!privateKey && !groqKey && !geminiKey && !huggingfaceKey && !appPassword && !telegramToken && !telegramChatId) {
        res.status(400).json({ error: 'Tidak ada kunci yang diberikan' });
        return;
    }

    // Apply keys to process.env at runtime (on Replit, persist secrets via Secrets tab)
    if (privateKey)     process.env.PRIVATE_KEY         = privateKey;
    if (groqKey)        process.env.GROQ_API_KEY         = groqKey;
    if (geminiKey)      process.env.GEMINI_API_KEY       = geminiKey;
    if (huggingfaceKey) process.env.HUGGINGFACE_API_KEY  = huggingfaceKey;
    if (appPassword)    process.env.APP_PASSWORD         = appPassword;
    if (telegramToken)  process.env.TELEGRAM_BOT_TOKEN  = telegramToken;
    if (telegramChatId) process.env.TELEGRAM_CHAT_ID    = telegramChatId;

    // Apply keys to running bot without restart
    bot.updateKeys({ privateKey, groqKey, geminiKey, huggingfaceKey, telegramToken, telegramChatId });

    res.json({ ok: true, status: bot.getKeyStatus() });
});

app.get('/api/history', (_req: Request, res: Response) => {
    res.json(bot.getTradeHistory());
});

app.post('/api/telegram/test', async (_req: Request, res: Response) => {
    const result = await bot.testTelegram();
    res.status(result.ok ? 200 : 400).json(result);
});

// ============ REPUTATION ENDPOINT ============
app.get('/api/reputation/:address', async (req: Request, res: Response) => {
    const { address } = req.params;
    if (!address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat tidak valid' });
        return;
    }
    try {
        const result = await bot.checkDeployerReputation(address);
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ============ BLACKLIST ENDPOINTS ============
app.get('/api/blacklist', (_req: Request, res: Response) => {
    res.json({ blacklist: bot.getBlacklist() });
});

app.post('/api/blacklist', (req: Request, res: Response) => {
    const { address, label } = req.body;
    if (!address || typeof address !== 'string' || !address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat token tidak valid (harus format 0x...)' });
        return;
    }
    bot.addToBlacklist(address, label?.trim() || undefined);
    res.json({ ok: true, blacklist: bot.getBlacklist() });
});

app.delete('/api/blacklist/:address', (req: Request, res: Response) => {
    const { address } = req.params;
    bot.removeFromBlacklist(address);
    res.json({ ok: true, blacklist: bot.getBlacklist() });
});

app.get('/api/logs', (_req: Request, res: Response) => {
    res.json({
        logs:      bot.getActivityLog(),
        timestamp: Date.now()
    });
});

app.get('/api/config', (_req: Request, res: Response) => {
    // Return runtime config — reflects changes from POST /api/settings immediately
    const rc = bot.getRuntimeConfig();
    res.json({
        capital:                 String(rc.totalCapital),
        maxTrade:                String(rc.maxTradeAmount),
        copyEnabled:             rc.copyEnabled,
        copyAmount:              String(rc.copyAmount),
        copyDelaySeconds:        String(rc.copyDelay),
        copyMaxPerDay:           String(rc.copyMaxPerDay),
        minSafetyScore:          String(rc.minSafetyScore),
        maxPoolAgeSeconds:       String(rc.maxPoolAgeSeconds),
        aiEnabled:               rc.aiEnabled,
        tp1Multiplier:           rc.tp1Multiplier,
        tp1Percentage:           rc.tp1Percentage,
        tp2Multiplier:           rc.tp2Multiplier,
        tp2Percentage:           rc.tp2Percentage,
        stopLoss:                rc.stopLoss,
        serialRuggerEnabled:     rc.serialRuggerEnabled,
        serialRuggerMaxDeploys:  String(rc.serialRuggerMaxDeploys),
        serialRuggerWindowHours: String(rc.serialRuggerWindowHours),
        reputationEnabled:       rc.reputationEnabled,
        reputationMinScore:      String(rc.reputationMinScore)
    });
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
