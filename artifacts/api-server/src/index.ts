import express, { Request, Response, NextFunction } from 'express';
import { AISniperBot } from './ai-sniper-integration';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 8080;

// ── Session store ──────────────────────────────────────────────────────────────
const sessions    = new Map<string, number>();
const SESSION_TTL = 12 * 3600 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [t, exp] of sessions) if (exp < now) sessions.delete(t);
}, 3_600_000).unref();

// ── Rate limiting ──────────────────────────────────────────────────────────────
const authAttempts = new Map<string, { count: number; resetAt: number }>();
function getClientIp(req: Request): string {
    return (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? 'unknown';
}
function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const e   = authAttempts.get(ip);
    if (!e || e.resetAt < now) { authAttempts.set(ip, { count: 1, resetAt: now + 60_000 }); return false; }
    if (e.count >= 20) return true;
    e.count++;
    return false;
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ── Auth guard ────────────────────────────────────────────────────────────────
function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const token  = req.headers['x-session-token'] as string | undefined;
    const expiry = token ? sessions.get(token) : undefined;
    if (!token || !expiry || expiry < Date.now()) {
        res.status(401).json({ error: 'Sesi tidak valid atau telah berakhir. Silakan login ulang.' });
        return;
    }
    next();
}
app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api/auth/verify') return next();
    requireAuth(req, res, next);
});

// ── Initialize bot ────────────────────────────────────────────────────────────
const bot = new AISniperBot();

async function startBot() {
    console.log('\n🚀 STARTING BASE SNIPER ULTIMATE (GeckoTerminal Edition)...');
    console.log(`💰 Capital: ${process.env.TOTAL_CAPITAL_ETH || 0.006} ETH`);
    console.log(`🐋 Copy Trading: ${process.env.COPY_TRADING_ENABLED === 'true' ? 'ACTIVE' : 'DISABLED'}`);
    console.log(`🤖 AI Mode: ${process.env.AI_ENABLED === 'true' ? 'ACTIVE' : 'DISABLED'}`);
    console.log(`🦎 GeckoTerminal Scanner: ${process.env.GECKO_SCANNER_ENABLED === 'true' ? 'ACTIVE' : 'DISABLED'}`);
    console.log(`🐋 Whale Auto-Scan: ${process.env.WHALE_AUTO_SCAN_ENABLED === 'true' ? 'ACTIVE' : 'DISABLED'}`);
    await bot.start();
}

// ============ AUTH ENDPOINT ============
app.post('/api/auth/verify', (req: Request, res: Response) => {
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
        res.status(429).json({ ok: false, error: 'Terlalu banyak percobaan. Coba lagi dalam 1 menit.' });
        return;
    }
    const { password } = req.body;
    const expected = process.env.APP_PASSWORD || '';
    if (!expected) { res.status(500).json({ error: 'APP_PASSWORD belum dikonfigurasi' }); return; }
    if (!password) { res.status(400).json({ ok: false, error: 'Password diperlukan' }); return; }
    const match = password.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expected));
    if (match) {
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, Date.now() + SESSION_TTL);
        res.json({ ok: true, token });
    } else {
        res.status(401).json({ ok: false, error: 'Password salah' });
    }
});

// ============ CORE STATUS & CONFIG ============
app.get('/api/status', (_req: Request, res: Response) => {
    res.json(bot.getStatus());
});

app.get('/api/positions', (_req: Request, res: Response) => {
    const status = bot.getStatus();
    res.json({ positions: status.openPositions, wallet: status.wallet, timestamp: Date.now() });
});

app.get('/api/config', (_req: Request, res: Response) => {
    const rc = bot.getRuntimeConfig();
    res.json({
        capital:                  String(rc.totalCapital),
        maxTrade:                 String(rc.maxTradeAmount),
        copyEnabled:              rc.copyEnabled,
        copyAmount:               String(rc.copyAmount),
        copyDelaySeconds:         String(rc.copyDelay),
        copyMaxPerDay:            String(rc.copyMaxPerDay),
        minSafetyScore:           String(rc.minSafetyScore),
        maxPoolAgeSeconds:        String(rc.maxPoolAgeSeconds),
        aiEnabled:                rc.aiEnabled,
        tp1Multiplier:            rc.tp1Multiplier,
        tp1Percentage:            rc.tp1Percentage,
        tp2Multiplier:            rc.tp2Multiplier,
        tp2Percentage:            rc.tp2Percentage,
        stopLoss:                 rc.stopLoss,
        serialRuggerEnabled:      rc.serialRuggerEnabled,
        serialRuggerMaxDeploys:   String(rc.serialRuggerMaxDeploys),
        serialRuggerWindowHours:  String(rc.serialRuggerWindowHours),
        reputationEnabled:        rc.reputationEnabled,
        reputationMinScore:       String(rc.reputationMinScore),
        dynamicSizingEnabled:     rc.dynamicSizingEnabled,
        tradeBalancePct:          String(rc.tradeBalancePct),
        geckoScannerEnabled:      rc.geckoScannerEnabled,
        whaleValidationEnabled:   rc.whaleValidationEnabled,
        whaleAutoScanEnabled:     rc.whaleAutoScanEnabled,
    });
});

app.post('/api/settings', (req: Request, res: Response) => {
    const s = req.body;
    if (!s || typeof s !== 'object') { res.status(400).json({ error: 'Invalid payload' }); return; }
    try {
        bot.updateRuntimeConfig({
            totalCapital:             s.totalCapital,
            maxTradeAmount:           s.maxTradeAmount,
            minLiquidity:             s.minLiquidity,
            maxSlippage:              s.maxSlippage,
            tp1Multiplier:            s.tp1Multiplier,
            tp1Percentage:            s.tp1Percentage,
            tp2Multiplier:            s.tp2Multiplier,
            tp2Percentage:            s.tp2Percentage,
            stopLoss:                 s.stopLoss,
            maxPriorityFee:           s.maxPriorityFee,
            maxFeePerGas:             s.maxFeePerGas,
            copyEnabled:              s.copyEnabled,
            copyAmount:               s.copyAmount,
            copyDelay:                s.copyDelay,
            copyMaxPerDay:            s.copyMaxPerDay,
            minSafetyScore:           s.minSafetyScore,
            maxPoolAgeSeconds:        s.maxPoolAgeSeconds,
            aiEnabled:                s.aiEnabled,
            dcaEnabled:               s.dcaEnabled,
            serialRuggerEnabled:      s.serialRuggerEnabled,
            serialRuggerMaxDeploys:   s.serialRuggerMaxDeploys,
            serialRuggerWindowHours:  s.serialRuggerWindowHours,
            reputationEnabled:        s.reputationEnabled,
            reputationMinScore:       s.reputationMinScore,
            dynamicSizingEnabled:     s.dynamicSizingEnabled,
            tradeBalancePct:          s.tradeBalancePct,
            geckoScannerEnabled:      s.geckoScannerEnabled,
            whaleAutoScanEnabled:     s.whaleAutoScanEnabled,
        });
        res.json({ ok: true, message: 'Pengaturan berhasil diterapkan' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ============ CHART (OHLCV via GeckoTerminal) ============

// Simple in-process cache: tokenAddress → { data, expiresAt }
const chartCache = new Map<string, { data: unknown; expiresAt: number }>();
const CHART_TTL_MS = 10_000; // 10-second cache

app.get('/api/chart/:tokenAddress', async (req: Request, res: Response) => {
    const { tokenAddress } = req.params;
    if (!tokenAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat token tidak valid' }); return;
    }
    const cacheKey = tokenAddress.toLowerCase();
    const cached   = chartCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        res.json(cached.data); return;
    }
    try {
        const { default: axios } = await import('axios');
        const GT = 'https://api.geckoterminal.com/api/v2';
        const headers = { 'Accept': 'application/json;version=20230302' };

        // Step 1: find the best pool for this token on Base
        const poolsRes = await axios.get(
            `${GT}/networks/base/tokens/${tokenAddress}/pools?page=1`,
            { headers, timeout: 8000 }
        );
        const pools: any[] = poolsRes.data?.data ?? [];
        if (!pools.length) {
            res.status(404).json({ error: 'Pool tidak ditemukan untuk token ini' }); return;
        }
        // Pick the pool with the highest liquidity
        const bestPool = pools.reduce((best: any, p: any) => {
            const liq = parseFloat(p.attributes?.reserve_in_usd ?? '0');
            return liq > parseFloat(best.attributes?.reserve_in_usd ?? '0') ? p : best;
        }, pools[0]);
        const poolAddress = bestPool.attributes?.address;
        if (!poolAddress) {
            res.status(404).json({ error: 'Alamat pool tidak tersedia' }); return;
        }

        // Step 2: fetch 5-minute OHLCV candles (last 40)
        const ohlcvRes = await axios.get(
            `${GT}/networks/base/pools/${poolAddress}/ohlcv/minute?aggregate=5&limit=40&currency=usd`,
            { headers, timeout: 8000 }
        );
        const rawList: number[][] = ohlcvRes.data?.data?.attributes?.ohlcv_list ?? [];
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
    } catch (err: any) {
        const status = err.response?.status;
        if (status === 404) {
            res.status(404).json({ error: 'Token tidak ditemukan di GeckoTerminal' });
        } else {
            res.status(500).json({ error: err.message ?? 'Gagal fetch data chart' });
        }
    }
});

// ============ ETH PRICE ============
app.get('/api/eth-price', async (_req: Request, res: Response) => {
    try {
        const { getEthPriceUsd } = await import('./price-oracle');
        const price = await getEthPriceUsd();
        res.json({ usd: price, timestamp: Date.now() });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ============ LIVE PnL & PORTFOLIO ============
app.get('/api/pnl', async (_req: Request, res: Response) => {
    try { res.json({ pnl: await bot.getLivePnL(), timestamp: Date.now() }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/portfolio', async (_req: Request, res: Response) => {
    try { res.json({ ...await bot.getPortfolio(), timestamp: Date.now() }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ============ SEND FUNDS ============
app.post('/api/send', async (req: Request, res: Response) => {
    const { type, to, amount, tokenAddress, decimals } = req.body;
    if (!to || typeof to !== 'string' || !to.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat tujuan tidak valid' }); return;
    }
    if (!amount || typeof amount !== 'number' || amount <= 0) {
        res.status(400).json({ error: 'Jumlah tidak valid' }); return;
    }
    if (!['eth', 'token'].includes(type)) { res.status(400).json({ error: 'type harus "eth" atau "token"' }); return; }
    try { res.json(await bot.sendFunds(type, to, amount, tokenAddress, decimals)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ============ MANUAL SELL ============
app.post('/api/sell', async (req: Request, res: Response) => {
    const { tokenAddress, percent } = req.body;
    if (!tokenAddress || typeof tokenAddress !== 'string' || !tokenAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'tokenAddress tidak valid' }); return;
    }
    const pct = typeof percent === 'number' ? percent : 100;
    try { res.json(await bot.manualSell(tokenAddress, pct)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ============ COPY WALLET MANAGEMENT ============
app.get('/api/wallets', (_req: Request, res: Response) => {
    res.json({ wallets: bot.getCopyWallets() });
});

app.post('/api/wallets', (req: Request, res: Response) => {
    const { address, name } = req.body;
    if (!address || typeof address !== 'string' || !address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat wallet tidak valid' }); return;
    }
    const label    = (name || '').trim() || `Whale ${address.slice(0, 8)}`;
    const existing = bot.getCopyWallets().find(w => w.address.toLowerCase() === address.toLowerCase());
    if (existing) { res.status(409).json({ error: 'Wallet sudah ada dalam daftar' }); return; }
    bot.addCopyWallet(address, label);
    res.json({ ok: true, wallets: bot.getCopyWallets() });
});

app.delete('/api/wallets/:address', (req: Request, res: Response) => {
    bot.removeCopyWallet(req.params.address);
    res.json({ ok: true, wallets: bot.getCopyWallets() });
});

app.patch('/api/wallets/:address', (req: Request, res: Response) => {
    const { address } = req.params;
    const { name, active } = req.body;
    if (name   !== undefined) bot.renameCopyWallet(address, name);
    if (active !== undefined) bot.toggleCopyWallet(address, !!active);
    res.json({ ok: true, wallets: bot.getCopyWallets() });
});

// ============ KEY MANAGEMENT ============
app.get('/api/keys', (_req: Request, res: Response) => {
    res.json(bot.getKeyStatus());
});

app.post('/api/keys', (req: Request, res: Response) => {
    const { privateKey, groqKey, geminiKey, huggingfaceKey, appPassword, telegramToken, telegramChatId } = req.body;
    if (!privateKey && !groqKey && !geminiKey && !huggingfaceKey && !appPassword && !telegramToken && !telegramChatId) {
        res.status(400).json({ error: 'Tidak ada kunci yang diberikan' }); return;
    }
    if (privateKey)     process.env.PRIVATE_KEY         = privateKey;
    if (groqKey)        process.env.GROQ_API_KEY         = groqKey;
    if (geminiKey)      process.env.GEMINI_API_KEY       = geminiKey;
    if (huggingfaceKey) process.env.HUGGINGFACE_API_KEY  = huggingfaceKey;
    if (appPassword)    process.env.APP_PASSWORD         = appPassword;
    if (telegramToken)  process.env.TELEGRAM_BOT_TOKEN  = telegramToken;
    if (telegramChatId) process.env.TELEGRAM_CHAT_ID    = telegramChatId;
    bot.updateKeys({ privateKey, groqKey, geminiKey, huggingfaceKey, telegramToken, telegramChatId });
    res.json({ ok: true, status: bot.getKeyStatus() });
});

// ============ HISTORY & LOGS ============
app.get('/api/history', (_req: Request, res: Response) => {
    res.json(bot.getTradeHistory());
});

app.get('/api/logs', (_req: Request, res: Response) => {
    res.json({ logs: bot.getActivityLog(), timestamp: Date.now() });
});

// ============ TELEGRAM ============
app.post('/api/telegram/test', async (_req: Request, res: Response) => {
    const result = await bot.testTelegram();
    res.status(result.ok ? 200 : 400).json(result);
});

// ============ REPUTATION ============
app.get('/api/reputation/:address', async (req: Request, res: Response) => {
    const { address } = req.params;
    if (!address.match(/^0x[0-9a-fA-F]{40}$/)) { res.status(400).json({ error: 'Alamat tidak valid' }); return; }
    try { res.json(await bot.checkDeployerReputation(address)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ============ BLACKLIST ============
app.get('/api/blacklist', (_req: Request, res: Response) => {
    res.json({ blacklist: bot.getBlacklist() });
});

app.post('/api/blacklist', (req: Request, res: Response) => {
    const { address, label } = req.body;
    if (!address || typeof address !== 'string' || !address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat token tidak valid' }); return;
    }
    bot.addToBlacklist(address, label?.trim() || undefined);
    res.json({ ok: true, blacklist: bot.getBlacklist() });
});

app.delete('/api/blacklist/:address', (req: Request, res: Response) => {
    bot.removeFromBlacklist(req.params.address);
    res.json({ ok: true, blacklist: bot.getBlacklist() });
});

// ============ WHALE FINDER ============

// GET /api/whale/pending — list pending candidates waiting for approval
app.get('/api/whale/pending', (_req: Request, res: Response) => {
    res.json({ candidates: bot.getPendingWhales() });
});

// GET /api/whale/all — list all candidates (pending + approved + rejected)
app.get('/api/whale/all', (_req: Request, res: Response) => {
    res.json({ candidates: bot.getAllWhales() });
});

// POST /api/whale/scan — trigger manual scan now (always bypasses cooldown)
app.post('/api/whale/scan', async (_req: Request, res: Response) => {
    try {
        const candidates = await bot.runWhaleScan(true);
        res.json({ ok: true, found: candidates.length, candidates });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/whale/approve — approve a pending candidate (add to copy list)
app.post('/api/whale/approve', (req: Request, res: Response) => {
    const { address } = req.body;
    if (!address || typeof address !== 'string' || !address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat tidak valid' }); return;
    }
    const approved = bot.approveWhale(address);
    if (!approved) {
        res.status(404).json({ error: 'Kandidat tidak ditemukan atau sudah diproses' }); return;
    }
    res.json({ ok: true, candidate: approved, wallets: bot.getCopyWallets() });
});

// POST /api/whale/reject — reject a candidate
app.post('/api/whale/reject', (req: Request, res: Response) => {
    const { address } = req.body;
    if (!address || typeof address !== 'string' || !address.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat tidak valid' }); return;
    }
    bot.rejectWhale(address);
    res.json({ ok: true });
});

// ============ SIMULATION ============

// POST /api/simulate — estimate P&L for following a whale on a specific token
app.post('/api/simulate', async (req: Request, res: Response) => {
    const { walletAddress, tokenAddress } = req.body;
    if (!walletAddress || !tokenAddress) {
        res.status(400).json({ error: 'walletAddress dan tokenAddress diperlukan' }); return;
    }
    if (!walletAddress.match(/^0x[0-9a-fA-F]{40}$/) || !tokenAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
        res.status(400).json({ error: 'Alamat tidak valid' }); return;
    }
    try {
        const result = await bot.simulateCopyTrade(walletAddress, tokenAddress);
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
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
process.on('SIGINT',  gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
