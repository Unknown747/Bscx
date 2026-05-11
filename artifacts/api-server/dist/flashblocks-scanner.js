"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlashblocksScanner = void 0;
const ws_1 = __importDefault(require("ws"));
const events_1 = require("events");
const axios_1 = __importDefault(require("axios"));
const price_oracle_1 = require("./price-oracle");
// FIX: Removed unused SnipeOpportunity interface
// Constant to avoid hardcoding in multiple places
// Uniswap V3 Factory on Base mainnet (verified: 42 hex chars)
const UNISWAP_V3_FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const POOL_CREATED_SIG = '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118';
// ============ MAIN SCANNER CLASS ============
class FlashblocksScanner extends events_1.EventEmitter {
    constructor() {
        super();
        this.ws = null;
        this.reconnectAttempts = 0;
        this.isConnected = false;
        this.pendingTransactions = new Map();
        this.keepAliveInterval = null; // FIX: store interval ref
        this.RPC_ENDPOINTS = [
            { url: 'wss://base-rpc.publicnode.com', type: 'publicnode', priority: 1 },
            { url: 'wss://base.llamarpc.com', type: 'llamarpc', priority: 2 },
            { url: 'wss://base.drpc.org', type: 'drpc', priority: 3 },
        ];
        // Konfigurasi modal 100rb (0.006 ETH)
        this.CONFIG = {
            MAX_TRADE_ETH: 0.0006,
            MIN_LIQUIDITY_ETH: 0.15,
            MAX_LIQUIDITY_ETH: 2.0,
            MAX_POOL_AGE_SECONDS: 60,
            MAX_GAS_PRICE_GWEI: 0.05, // Base L2 actual fee ceiling (was 2.0 — Ethereum mainnet)
            MIN_SAFETY_SCORE: 65,
            MAX_BUY_TAX_PERCENT: 10,
            MAX_SELL_TAX_PERCENT: 10,
            SCAN_INTERVAL_MS: 200,
        };
        this.currentWsUrl = this.RPC_ENDPOINTS[0].url;
    }
    // ============ CONNECTION MANAGEMENT ============
    async connect() {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔥 BASE FLASHBLOCKS SCANNER v2.0');
        console.log(`💰 Modal Mode: ${this.CONFIG.MAX_TRADE_ETH * 1000} USD (100rb)`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        const fastestEndpoint = await this.findFastestEndpoint();
        if (fastestEndpoint) {
            this.currentWsUrl = fastestEndpoint.url;
            console.log(`⚡ Using fastest endpoint: ${fastestEndpoint.type} (${fastestEndpoint.ping}ms)`);
        }
        await this.establishConnection();
    }
    async findFastestEndpoint() {
        const results = await Promise.all(this.RPC_ENDPOINTS.map(async (endpoint) => {
            const start = Date.now();
            try {
                await this.pingWebSocket(endpoint.url);
                const ping = Date.now() - start;
                return { ...endpoint, ping };
            }
            catch {
                return { ...endpoint, ping: Infinity };
            }
        }));
        const valid = results.filter(r => r.ping < 500);
        if (valid.length === 0)
            return null;
        return valid.sort((a, b) => a.ping - b.ping)[0];
    }
    pingWebSocket(url) {
        return new Promise((resolve, reject) => {
            const ws = new ws_1.default(url);
            const timeout = setTimeout(() => {
                ws.close();
                reject(new Error('Timeout'));
            }, 3000);
            ws.on('open', () => {
                clearTimeout(timeout);
                ws.close();
                resolve();
            });
            ws.on('error', () => {
                clearTimeout(timeout);
                reject(new Error('Connection failed'));
            });
        });
    }
    async establishConnection() {
        return new Promise((resolve, reject) => {
            console.log(`🔌 Connecting to ${this.currentWsUrl}...`);
            // FIX: removed invalid 'timeout' option (not supported by ws library)
            this.ws = new ws_1.default(this.currentWsUrl, {
                handshakeTimeout: 10000,
            });
            // FIX: settled flag prevents double-reject from timeout + error handler
            let settled = false;
            const timeoutId = setTimeout(() => {
                if (settled)
                    return;
                settled = true;
                reject(new Error('Connection timeout'));
            }, 15000);
            this.ws.on('open', async () => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeoutId);
                this.isConnected = true;
                this.reconnectAttempts = 0;
                console.log('✅ WebSocket CONNECTED!');
                this.subscribeToMempool();
                this.subscribeToPoolEvents();
                this.startKeepAlive();
                resolve();
            });
            this.ws.on('error', (error) => {
                console.error(`WebSocket error: ${error.message}`);
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    reject(error);
                }
                this.handleDisconnect();
            });
            this.ws.on('close', () => {
                console.log('WebSocket closed');
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    reject(new Error('Connection closed before open'));
                }
                this.handleDisconnect();
            });
            this.ws.on('message', (data) => {
                this.handleMessage(data);
            });
        });
    }
    subscribeToMempool() {
        if (!this.ws)
            return;
        this.ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_subscribe',
            params: ['newPendingTransactions']
        }));
        console.log('✅ Subscribed to newPendingTransactions');
    }
    subscribeToPoolEvents() {
        if (!this.ws)
            return;
        this.ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'eth_subscribe',
            params: ['logs', {
                    address: UNISWAP_V3_FACTORY,
                    topics: [POOL_CREATED_SIG]
                }]
        }));
        console.log('✅ Subscribed to pool creation events');
    }
    startKeepAlive() {
        // FIX: store interval so it can be cleared on disconnect
        if (this.keepAliveInterval)
            clearInterval(this.keepAliveInterval);
        this.keepAliveInterval = setInterval(() => {
            if (this.ws && this.isConnected) {
                this.ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method: 'net_version',
                    params: []
                }));
            }
        }, 15000);
    }
    handleMessage(data) {
        try {
            const parsed = JSON.parse(data.toString());
            if (parsed.method === 'eth_subscription') {
                const result = parsed.params.result;
                if (typeof result === 'string' && result.startsWith('0x')) {
                    this.onNewTransaction(result);
                }
                // FIX: use constant for address comparison
                if (result && result.address === UNISWAP_V3_FACTORY) {
                    this.onPoolCreated(result);
                }
            }
        }
        catch (error) {
            // Ignore malformed messages
        }
    }
    // ============ TRANSACTION HANDLING ============
    onNewTransaction(txHash) {
        const now = Date.now();
        if (this.pendingTransactions.has(txHash))
            return;
        this.pendingTransactions.set(txHash, now);
        if (this.pendingTransactions.size > 1000) {
            const cutoff = now - 30000;
            for (const [hash, time] of this.pendingTransactions) {
                if (time < cutoff)
                    this.pendingTransactions.delete(hash);
            }
        }
        this.emit('transaction', { hash: txHash, timestamp: now });
        if (this.pendingTransactions.size % 10 === 0) {
            console.log(`📊 Mempool size: ${this.pendingTransactions.size} pending txs`);
        }
    }
    async onPoolCreated(logData) {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔥🔥🔥 NEW POOL DETECTED! 🔥🔥🔥');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        const WETH_ADDR = '0x4200000000000000000000000000000000000006';
        const rawToken0 = '0x' + logData.topics[1].slice(-40);
        const rawToken1 = '0x' + logData.topics[2].slice(-40);
        // Always analyse the non-WETH token — previously bot sometimes analysed WETH itself
        const newToken = rawToken0.toLowerCase() === WETH_ADDR.toLowerCase() ? rawToken1 : rawToken0;
        const baseToken = rawToken0.toLowerCase() === WETH_ADDR.toLowerCase() ? rawToken0 : rawToken1;
        const poolData = {
            poolAddress: logData.address,
            token0: newToken, // new token (non-WETH)
            token1: baseToken, // base token (WETH)
            liquidity: 0,
            volume24h: 0,
            createdAt: Date.now(),
            txHash: logData.transactionHash,
            blockNumber: parseInt(logData.blockNumber, 16)
        };
        console.log(`   🪙 New token: ${newToken.slice(0, 10)}... / WETH`);
        const liquidity = await this.getPoolLiquidity(poolData.poolAddress);
        if (liquidity) {
            poolData.liquidity = liquidity;
        }
        const isValid = await this.validatePool(poolData);
        if (isValid) {
            console.log('✅ POOL VALID - READY TO SNIPE!');
            console.log(`📍 Pool: ${poolData.poolAddress}`);
            console.log(`💧 Liquidity: ${poolData.liquidity.toFixed(3)} ETH`);
            console.log(`⏱️ Created: ${Math.floor((Date.now() - poolData.createdAt) / 1000)}s ago`);
            this.emit('pool-ready', poolData);
        }
        else {
            console.log('❌ Pool rejected by filters');
        }
    }
    async validatePool(pool) {
        if (pool.liquidity < this.CONFIG.MIN_LIQUIDITY_ETH) {
            console.log(`   ❌ Liquidity too low: ${pool.liquidity.toFixed(3)} ETH (min: ${this.CONFIG.MIN_LIQUIDITY_ETH})`);
            return false;
        }
        if (pool.liquidity > this.CONFIG.MAX_LIQUIDITY_ETH) {
            console.log(`   ❌ Liquidity too high: ${pool.liquidity.toFixed(3)} ETH (max: ${this.CONFIG.MAX_LIQUIDITY_ETH})`);
            return false;
        }
        const ageSeconds = (Date.now() - pool.createdAt) / 1000;
        if (ageSeconds > this.CONFIG.MAX_POOL_AGE_SECONDS) {
            console.log(`   ❌ Pool too old: ${ageSeconds.toFixed(0)}s (max: ${this.CONFIG.MAX_POOL_AGE_SECONDS}s)`);
            return false;
        }
        const safety = await this.checkTokenSafety(pool.token0);
        if (!safety)
            return false;
        if (safety.isHoneypot) {
            console.log(`   ❌ HONEYPOT DETECTED!`);
            return false;
        }
        if (safety.buyTax > this.CONFIG.MAX_BUY_TAX_PERCENT) {
            console.log(`   ❌ Buy tax too high: ${safety.buyTax}% (max: ${this.CONFIG.MAX_BUY_TAX_PERCENT}%)`);
            return false;
        }
        if (safety.sellTax > this.CONFIG.MAX_SELL_TAX_PERCENT) {
            console.log(`   ❌ Sell tax too high: ${safety.sellTax}% (max: ${this.CONFIG.MAX_SELL_TAX_PERCENT}%)`);
            return false;
        }
        if (safety.safetyScore < this.CONFIG.MIN_SAFETY_SCORE) {
            console.log(`   ❌ Safety score too low: ${safety.safetyScore} (min: ${this.CONFIG.MIN_SAFETY_SCORE})`);
            return false;
        }
        console.log(`   ✅ Liquidity: OK | Age: OK | Safety: ${safety.safetyScore}`);
        return true;
    }
    // ============ API INTEGRATIONS ============
    async getPoolLiquidity(poolAddress) {
        // getDexLiquidityEth: cached, fetches ETH price in parallel with DexScreener
        return (0, price_oracle_1.getDexLiquidityEth)(poolAddress);
    }
    async checkTokenSafety(tokenAddress) {
        try {
            const response = await axios_1.default.get(`https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${tokenAddress}`, { timeout: 8000 });
            const data = response.data.result[tokenAddress.toLowerCase()];
            if (!data)
                return null;
            return {
                isHoneypot: data.is_honeypot === '1',
                buyTax: parseFloat(data.buy_tax || '0'),
                sellTax: parseFloat(data.sell_tax || '0'),
                isMintable: data.mintable === 'true',
                canTakeBackOwnership: data.can_take_back_ownership === 'true',
                safetyScore: this.calculateSafetyScore(data)
            };
        }
        catch (error) {
            console.log(`   ⚠️ Safety check failed for ${tokenAddress.slice(0, 10)}...`);
            return null;
        }
    }
    calculateSafetyScore(data) {
        let score = 100;
        // FIX: was duplicated (deducted 100 total instead of 50)
        if (data.is_honeypot === '1')
            score -= 50;
        if (data.mintable === 'true')
            score -= 20;
        if (data.can_take_back_ownership === 'true')
            score -= 15;
        const buyTax = parseFloat(data.buy_tax || '0');
        if (buyTax > 5)
            score -= buyTax;
        const sellTax = parseFloat(data.sell_tax || '0');
        if (sellTax > 5)
            score -= sellTax;
        return Math.max(0, Math.min(100, score));
    }
    handleDisconnect() {
        if (!this.isConnected)
            return;
        this.isConnected = false;
        // Clear keepAlive on disconnect
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
        this.reconnectAttempts++;
        // Exponential backoff dengan jitter: mencegah semua koneksi reconnect bersamaan
        // Max 15 detik (bukan 30 detik) — koneksi harus pulih cepat untuk tidak melewatkan pool baru
        const baseDelay = Math.min(500 * Math.pow(1.8, this.reconnectAttempts), 15000);
        const jitter = Math.random() * 1000; // random 0-1 detik
        const delay = Math.round(baseDelay + jitter);
        // Rotasi endpoint saat reconnect — jangan selalu ke endpoint yang sama
        const idx = this.reconnectAttempts % this.RPC_ENDPOINTS.length;
        this.currentWsUrl = this.RPC_ENDPOINTS[idx].url;
        console.log(`🔄 Reconnect #${this.reconnectAttempts} → ${this.RPC_ENDPOINTS[idx].type} dalam ${Math.round(delay / 1000)}s...`);
        setTimeout(async () => {
            try {
                await this.connect();
                console.log(`✅ Reconnected berhasil ke ${this.RPC_ENDPOINTS[idx].type}`);
                this.reconnectAttempts = 0; // reset setelah berhasil
            }
            catch (err) {
                console.error(`❌ Reconnect gagal: ${err?.message} — akan coba lagi...`);
            }
        }, delay);
    }
    // ============ PUBLIC METHODS ============
    getConfig() {
        return {
            ...this.CONFIG,
            flashblocksEnabled: process.env.ENABLE_FLASHBLOCKS === 'true'
        };
    }
    isConnectedToBase() {
        return this.isConnected;
    }
    getMempoolSize() {
        return this.pendingTransactions.size;
    }
    disconnect() {
        // FIX: clear keepAlive interval on disconnect
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
    }
}
exports.FlashblocksScanner = FlashblocksScanner;
exports.default = FlashblocksScanner;
//# sourceMappingURL=flashblocks-scanner.js.map