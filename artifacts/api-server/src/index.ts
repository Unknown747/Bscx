import express, { Request, Response, NextFunction } from 'express';
import { AISniperBot } from './ai-sniper-integration';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// ============ MIDDLEWARE ============
app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
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

// ============ AUTH ENDPOINT (public) ============
app.post('/api/auth/verify', (req: Request, res: Response) => {
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

    res.status(match ? 200 : 401).json(
        match ? { ok: true } : { ok: false, error: 'Password salah' }
    );
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
            aiEnabled:        s.aiEnabled
        });
        res.json({ ok: true, message: 'Pengaturan berhasil diterapkan' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
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
        capital:           String(rc.totalCapital),
        maxTrade:          String(rc.maxTradeAmount),
        copyEnabled:       rc.copyEnabled,
        copyAmount:        String(rc.copyAmount),
        copyDelaySeconds:  String(rc.copyDelay),
        copyMaxPerDay:     String(rc.copyMaxPerDay),
        minSafetyScore:    String(rc.minSafetyScore),
        maxPoolAgeSeconds: String(rc.maxPoolAgeSeconds),
        aiEnabled:         rc.aiEnabled,
        tp1Multiplier:     rc.tp1Multiplier,
        tp1Percentage:     rc.tp1Percentage,
        tp2Multiplier:     rc.tp2Multiplier,
        tp2Percentage:     rc.tp2Percentage,
        stopLoss:          rc.stopLoss
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
