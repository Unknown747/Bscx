import express from 'express';
import { FlashblocksScanner } from './flashblocks-scanner';
import { CopyTradeMonitor } from './copy-trade-monitor';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// ============ INITIALIZE COMPONENTS ============
const scanner = new FlashblocksScanner();
const copyMonitor = new CopyTradeMonitor();

// ============ START SCANNER ============
async function startBot() {
    console.log('\n🚀 STARTING BASE SNIPER ULTIMATE...');
    console.log(`💰 Capital Mode: ${process.env.TOTAL_CAPITAL_ETH || 0.006} ETH (100rb)`);
    console.log(`🐋 Copy Trading: ${process.env.COPY_TRADING_ENABLED === 'true' ? 'ACTIVE' : 'DISABLED'}`);
    
    // Start Flashblocks scanner
    await scanner.connect();
    
    // Start copy trade monitor
    if (process.env.COPY_TRADING_ENABLED === 'true') {
        copyMonitor.start();
    }
    
    // Event handlers
    scanner.on('pool-ready', async (pool) => {
        console.log(`\n🎯 POOL READY: ${pool.poolAddress}`);
        // Kirim ke frontend via WebSocket atau API
    });
    
    copyMonitor.on('execute-copy', async (data) => {
        console.log(`\n🔄 EXECUTING COPY TRADE:`);
        console.log(`   Token: ${data.tokenSymbol}`);
        console.log(`   Amount: ${data.amount} ETH`);
        // Execute actual swap here using viem/ethers
    });
    
    console.log('\n✅ Bot is RUNNING!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

// ============ API ENDPOINTS ============
app.get('/api/status', (req, res) => {
    res.json({
        connected: scanner.isConnectedToBase(),
        copyStats: copyMonitor.getStats(),
        config: scanner.getConfig(),
        timestamp: Date.now()
    });
});

app.get('/api/config', (req, res) => {
    res.json({
        capital: process.env.TOTAL_CAPITAL_ETH,
        maxTrade: process.env.MAX_TRADE_AMOUNT,
        copyEnabled: process.env.COPY_TRADING_ENABLED === 'true',
        copyAmount: process.env.COPY_TRADING_AMOUNT
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🌐 API Server running on port ${PORT}`);
    startBot().catch(console.error);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    scanner.disconnect();
    copyMonitor.stop();
    process.exit(0);
});
