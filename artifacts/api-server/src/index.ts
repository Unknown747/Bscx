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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ============ AUTH ============
// Active tokens: Map<token, expiresAt>
const activeSessions = new Map<string, number>();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 jam

function generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

    if (!token) {
        res.status(401).json({ error: 'Token required' });
        return;
    }

    const expiresAt = activeSessions.get(token);
    if (!expiresAt || Date.now() > expiresAt) {
        activeSessions.delete(token);
        res.status(401).json({ error: 'Session expired, please login again' });
        return;
    }

    // Refresh TTL on active use
    activeSessions.set(token, Date.now() + SESSION_TTL_MS);
    next();
}

// Clean up expired sessions every hour
setInterval(() => {
    const now = Date.now();
    for (const [token, expiresAt] of activeSessions) {
        if (now > expiresAt) activeSessions.delete(token);
    }
}, 60 * 60 * 1000);

// ============ INITIALIZE COMPONENTS ============
const scanner = new FlashblocksScanner();
const copyMonitor = new CopyTradeMonitor();

// ============ START BOT ============
async function startBot() {
    console.log('\n🚀 STARTING BASE SNIPER ULTIMATE...');
    console.log(`💰 Capital Mode: ${process.env.TOTAL_CAPITAL_ETH || 0.006} ETH (100rb)`);
    console.log(`🐋 Copy Trading: ${process.env.COPY_TRADING_ENABLED === 'true' ? 'ACTIVE' : 'DISABLED'}`);

    // Register event listeners BEFORE connecting
    scanner.on('pool-ready', async (pool) => {
        console.log(`\n🎯 POOL READY: ${pool.poolAddress}`);
    });

    copyMonitor.on('execute-copy', async (data) => {
        console.log(`\n🔄 EXECUTING COPY TRADE:`);
        console.log(`   Token: ${data.tokenSymbol}`);
        console.log(`   Amount: ${data.amount} ETH`);
        // Execute actual swap here using viem/ethers
    });

    await scanner.connect();

    if (process.env.COPY_TRADING_ENABLED === 'true') {
        copyMonitor.start();
    }

    console.log('\n✅ Bot is RUNNING!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

// ============ AUTH ENDPOINTS (public) ============

// POST /api/auth/login — called by frontend on every WebView open
app.post('/api/auth/login', (req: Request, res: Response) => {
    const { password } = req.body;

    if (!password) {
        res.status(400).json({ error: 'Password required' });
        return;
    }

    const appPassword = process.env.APP_PASSWORD;
    if (!appPassword) {
        res.status(500).json({ error: 'APP_PASSWORD not configured on server' });
        return;
    }

    // Constant-time comparison to prevent timing attacks
    const inputBuf = Buffer.from(password);
    const correctBuf = Buffer.from(appPassword);
    const match =
        inputBuf.length === correctBuf.length &&
        crypto.timingSafeEqual(inputBuf, correctBuf);

    if (!match) {
        res.status(401).json({ error: 'Password salah' });
        return;
    }

    const token = generateToken();
    activeSessions.set(token, Date.now() + SESSION_TTL_MS);

    res.json({
        token,
        expiresIn: SESSION_TTL_MS,
        message: 'Login berhasil'
    });
});

// POST /api/auth/logout
app.post('/api/auth/logout', requireAuth, (req: Request, res: Response) => {
    const token = req.headers['authorization']!.slice(7);
    activeSessions.delete(token);
    res.json({ message: 'Logout berhasil' });
});

// GET /api/auth/check — frontend calls this on load to validate stored token
app.get('/api/auth/check', requireAuth, (req: Request, res: Response) => {
    res.json({ valid: true });
});

// ============ PROTECTED API ENDPOINTS ============

app.get('/api/status', requireAuth, (req: Request, res: Response) => {
    res.json({
        connected: scanner.isConnectedToBase(),
        copyStats: copyMonitor.getStats(),
        config: scanner.getConfig(),
        timestamp: Date.now()
    });
});

app.get('/api/config', requireAuth, (req: Request, res: Response) => {
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

// Handle both SIGINT (Ctrl+C) and SIGTERM (Docker/PM2)
function gracefulShutdown() {
    console.log('\n🛑 Shutting down...');
    scanner.disconnect();
    copyMonitor.stop();
    process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
