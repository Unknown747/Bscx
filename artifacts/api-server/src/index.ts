import express, { Request, Response, NextFunction } from 'express';
import { FlashblocksScanner } from './flashblocks-scanner';
import { CopyTradeMonitor } from './copy-trade-monitor';
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

// ============ INITIALIZE COMPONENTS ============
const scanner = new FlashblocksScanner();
const copyMonitor = new CopyTradeMonitor();

// ============ START BOT ============
async function startBot() {
    console.log('\n🚀 STARTING BASE SNIPER ULTIMATE...');
    console.log(`💰 Capital Mode: ${process.env.TOTAL_CAPITAL_ETH || 0.006} ETH (100rb)`);
    console.log(`🐋 Copy Trading: ${process.env.COPY_TRADING_ENABLED === 'true' ? 'ACTIVE' : 'DISABLED'}`);

    scanner.on('pool-ready', async (pool) => {
        console.log(`\n🎯 POOL READY: ${pool.poolAddress}`);
    });

    copyMonitor.on('execute-copy', async (data) => {
        console.log(`\n🔄 EXECUTING COPY TRADE:`);
        console.log(`   Token: ${data.tokenSymbol}`);
        console.log(`   Amount: ${data.amount} ETH`);
    });

    await scanner.connect();

    if (process.env.COPY_TRADING_ENABLED === 'true') {
        copyMonitor.start();
    }

    console.log('\n✅ Bot is RUNNING!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

// ============ AUTH ENDPOINT ============
// Frontend calls this once on open to verify password before showing UI
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

    // Constant-time comparison to prevent timing attacks
    const match =
        password.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expected));

    res.status(match ? 200 : 401).json(
        match ? { ok: true } : { ok: false, error: 'Password salah' }
    );
});

// ============ API ENDPOINTS (no password required) ============
app.get('/api/status', (req: Request, res: Response) => {
    res.json({
        connected: scanner.isConnectedToBase(),
        copyStats: copyMonitor.getStats(),
        config: scanner.getConfig(),
        timestamp: Date.now()
    });
});

app.get('/api/config', (req: Request, res: Response) => {
    res.json({
        capital: process.env.TOTAL_CAPITAL_ETH,
        maxTrade: process.env.MAX_TRADE_AMOUNT,
        copyEnabled: process.env.COPY_TRADING_ENABLED === 'true',
        copyAmount: process.env.COPY_TRADING_AMOUNT,
        copyDelaySeconds: process.env.COPY_TRADING_DELAY_SECONDS,
        copyMaxPerDay: process.env.COPY_TRADING_MAX_PER_DAY,
        minSafetyScore: process.env.MIN_SAFETY_SCORE,
        maxPoolAgeSeconds: process.env.MAX_POOL_AGE_SECONDS
    });
});

// ============ START SERVER ============
app.listen(PORT, () => {
    console.log(`🌐 API Server running on port ${PORT}`);
    startBot().catch(console.error);
});

function gracefulShutdown() {
    console.log('\n🛑 Shutting down...');
    scanner.disconnect();
    copyMonitor.stop();
    process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
