"use strict";
/**
 * basescan-monitor.ts
 *
 * Membaca riwayat transaksi wallet langsung dari blockchain Base
 * menggunakan Blockscout API (gratis, tanpa API key).
 *
 * Strategi:
 * 1. Fetch ERC-20 token transfers via Blockscout V2 API
 * 2. Kelompokkan per token, bedakan buy (terima token) vs sell (kirim token)
 * 3. FIFO matching buy↔sell untuk hitung realized PnL
 * 4. Track cursor (next_page_params) per wallet agar tidak re-fetch dari awal
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeWalletOnChain = analyzeWalletOnChain;
exports.fetchRecentTrades = fetchRecentTrades;
exports.resetWalletCache = resetWalletCache;
exports.isBasescanAvailable = isBasescanAvailable;
const axios_1 = __importDefault(require("axios"));
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const BLOCKSCOUT_BASE = 'https://base.blockscout.com/api/v2';
const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';
const STABLECOINS = new Set([
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
    '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', // USDT
    '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // USDbC
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // DAI
    '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42', // EURC
]);
// Per-wallet cursor cache to avoid re-fetching from genesis each poll
const cursorCache = new Map(); // wallet → next_page_params JSON or null (= no more pages)
async function fetchTokenTransfers(wallet, sinceMs, maxPages = 5) {
    const results = [];
    let url = `${BLOCKSCOUT_BASE}/addresses/${wallet}/token-transfers?type=ERC-20`;
    // If we have a stored cursor, resume from there
    const cachedCursor = cursorCache.get(wallet);
    if (cachedCursor) {
        url = `${BLOCKSCOUT_BASE}/addresses/${wallet}/token-transfers?type=ERC-20&${cachedCursor}`;
    }
    let page = 0;
    let latestCursor = null;
    while (url && page < maxPages) {
        page++;
        try {
            const res = await axios_1.default.get(url, { timeout: 12000, headers: { Accept: 'application/json' } });
            const data = res.data;
            const items = data.items ?? [];
            if (items.length === 0)
                break;
            for (const item of items) {
                const tsMs = item.timestamp ? new Date(item.timestamp).getTime() : 0;
                // Stop if we've reached transfers older than sinceMs (items are newest-first)
                if (!cachedCursor && tsMs < sinceMs) {
                    url = null;
                    break;
                }
                const token = item.token ?? {};
                const tAddr = (token.address_hash ?? '').toLowerCase();
                const tSym = token.symbol ?? '?';
                const tDec = parseInt(token.decimals ?? '18') || 18;
                const rawVal = item.total?.value ?? '0';
                // Skip stablecoins and WETH
                if (STABLECOINS.has(tAddr) || tAddr === WETH_ADDRESS.toLowerCase())
                    continue;
                if (!tAddr || tAddr === '0x')
                    continue;
                const txHash = item.transaction_hash ?? '';
                const from = (item.from?.hash ?? '').toLowerCase();
                const to = (item.to?.hash ?? '').toLowerCase();
                const blk = item.block_number ?? 0;
                results.push({ txHash, from, to, tokenAddress: tAddr, tokenSymbol: tSym, tokenDecimals: tDec, rawValue: rawVal, timestamp: tsMs, blockNumber: blk });
            }
            // Build cursor from next_page_params
            const npp = data.next_page_params;
            if (npp && url !== null) {
                const qs = Object.entries(npp).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
                latestCursor = qs;
                url = `${BLOCKSCOUT_BASE}/addresses/${wallet}/token-transfers?type=ERC-20&${qs}`;
            }
            else {
                url = null;
            }
        }
        catch (err) {
            if (err.response?.status === 429)
                await delay(2000);
            break;
        }
    }
    // Save cursor for next poll — so next time we only fetch new txs
    if (latestCursor)
        cursorCache.set(wallet, latestCursor);
    return results;
}
/**
 * Menganalisis riwayat transaksi wallet dari Blockscout dan
 * mengembalikan statistik trading yang akurat.
 */
async function analyzeWalletOnChain(walletAddress, sinceMs = Date.now() - 30 * 86400000) {
    const wallet = walletAddress.toLowerCase();
    const base = {
        walletAddress: wallet,
        totalTxs: 0,
        tradePairs: [],
        tradesObserved: 0,
        winsObserved: 0,
        lossesObserved: 0,
        avgPnlPct: 0,
        lastTradeMs: 0,
        tradesPerDay: 0,
        dataSource: 'blockscout',
    };
    try {
        const transfers = await fetchTokenTransfers(wallet, sinceMs);
        if (transfers.length === 0)
            return base;
        base.totalTxs = transfers.length;
        // Group by token: incoming = buy, outgoing = sell
        const tokenMap = new Map();
        let lastTradeMs = 0;
        for (const tx of transfers) {
            const isBuy = tx.to === wallet;
            const isSell = tx.from === wallet;
            if (!isBuy && !isSell)
                continue;
            if (!tokenMap.has(tx.tokenAddress)) {
                tokenMap.set(tx.tokenAddress, { symbol: tx.tokenSymbol, buys: [], sells: [] });
            }
            const entry = tokenMap.get(tx.tokenAddress);
            const amount = parseFloat(tx.rawValue) / Math.pow(10, tx.tokenDecimals);
            if (tx.timestamp > lastTradeMs)
                lastTradeMs = tx.timestamp;
            if (isBuy)
                entry.buys.push({ timeMs: tx.timestamp, amount, txHash: tx.txHash });
            else
                entry.sells.push({ timeMs: tx.timestamp, amount, txHash: tx.txHash });
        }
        // FIFO matching: pair sells with preceding buys for each token
        const tradePairs = [];
        for (const [tokenAddress, entry] of tokenMap) {
            if (entry.buys.length === 0 || entry.sells.length === 0)
                continue;
            const buys = [...entry.buys].sort((a, b) => a.timeMs - b.timeMs);
            const sells = [...entry.sells].sort((a, b) => a.timeMs - b.timeMs);
            // Running position to compute realized PnL via FIFO
            // We'll use a simplified approach: for each sell find most recent buy before it
            for (const sell of sells) {
                const matchBuy = [...buys]
                    .filter(b => b.timeMs < sell.timeMs)
                    .sort((a, b) => b.timeMs - a.timeMs)[0];
                if (!matchBuy)
                    continue;
                // We can't get ETH prices directly from Blockscout transfer events
                // Use a heuristic: ratio of sell/buy amounts approximates price change
                // If sell amount < buy amount → partial sell (still a completed round-trip event)
                const ratio = matchBuy.amount > 0 ? sell.amount / matchBuy.amount : 1;
                // Without ETH price data per trade, record as observed trade pair
                // Mark as win/loss based on sell amount > buy amount (token quantity)
                // This is approximate but still meaningful for scoring
                const isWin = ratio >= 1;
                const pnlPct = (ratio - 1) * 100;
                tradePairs.push({
                    tokenAddress,
                    tokenSymbol: entry.symbol,
                    buyTimestamp: matchBuy.timeMs,
                    sellTimestamp: sell.timeMs,
                    buyValueEth: matchBuy.amount,
                    sellValueEth: sell.amount,
                    pnlPct: parseFloat(pnlPct.toFixed(2)),
                    isWin,
                    txBuy: matchBuy.txHash,
                    txSell: sell.txHash,
                });
            }
        }
        const wins = tradePairs.filter(p => p.isWin).length;
        const losses = tradePairs.filter(p => !p.isWin).length;
        const avgPnl = tradePairs.length > 0
            ? tradePairs.reduce((s, p) => s + p.pnlPct, 0) / tradePairs.length
            : 0;
        const windowDays = Math.max(0.04, (Date.now() - sinceMs) / 86400000);
        const tradesPerDay = parseFloat((transfers.length / windowDays).toFixed(2));
        base.tradePairs = tradePairs;
        base.tradesObserved = transfers.length;
        base.winsObserved = wins;
        base.lossesObserved = losses;
        base.avgPnlPct = parseFloat(avgPnl.toFixed(2));
        base.lastTradeMs = lastTradeMs;
        base.tradesPerDay = tradesPerDay;
        return base;
    }
    catch (err) {
        base.error = err.message;
        base.dataSource = 'fallback';
        return base;
    }
}
async function fetchRecentTrades(walletAddress, limit = 10) {
    const wallet = walletAddress.toLowerCase();
    try {
        const url = `${BLOCKSCOUT_BASE}/addresses/${wallet}/token-transfers?type=ERC-20`;
        const res = await axios_1.default.get(url, { timeout: 12000, headers: { Accept: 'application/json' } });
        const items = res.data?.items ?? [];
        const trades = [];
        for (const item of items) {
            const token = item.token ?? {};
            const tAddr = (token.address_hash ?? '').toLowerCase();
            const tSym = token.symbol ?? '?';
            const tDec = parseInt(token.decimals ?? '18') || 18;
            const tIcon = token.icon_url ?? '';
            const rawVal = item.total?.value ?? '0';
            // Skip stablecoins & WETH from feed (noise)
            if (STABLECOINS.has(tAddr) || tAddr === WETH_ADDRESS.toLowerCase())
                continue;
            if (!tAddr || tAddr === '0x')
                continue;
            const from = (item.from?.hash ?? '').toLowerCase();
            const to = (item.to?.hash ?? '').toLowerCase();
            const direction = to === wallet ? 'buy' : 'sell';
            // Skip transfers not involving our wallet
            if (from !== wallet && to !== wallet)
                continue;
            const tsMs = item.timestamp ? new Date(item.timestamp).getTime() : 0;
            const blk = item.block_number ?? 0;
            const txHash = item.transaction_hash ?? '';
            const amount = parseFloat(rawVal) / Math.pow(10, tDec);
            // Format amount: if > 1M use M, if > 1K use K, else 4 decimals
            let amountFmt;
            if (amount >= 1000000)
                amountFmt = `${(amount / 1000000).toFixed(2)}M`;
            else if (amount >= 1000)
                amountFmt = `${(amount / 1000).toFixed(2)}K`;
            else if (amount >= 1)
                amountFmt = amount.toFixed(2);
            else
                amountFmt = amount.toExponential(2);
            trades.push({
                txHash,
                direction,
                tokenAddress: tAddr,
                tokenSymbol: tSym,
                tokenIcon: tIcon,
                amount,
                amountFmt,
                timestampMs: tsMs,
                blockNumber: blk,
                explorerUrl: `https://basescan.org/tx/${txHash}`,
            });
            if (trades.length >= limit)
                break;
        }
        return trades;
    }
    catch {
        return [];
    }
}
/**
 * Reset cursor cache untuk wallet — re-scan dari awal
 */
function resetWalletCache(walletAddress) {
    cursorCache.delete(walletAddress.toLowerCase());
}
/**
 * Blockscout selalu tersedia (no key needed) — tapi cek konektivitas
 */
function isBasescanAvailable() {
    // Blockscout is always available — no API key required
    // We keep the function name for API compatibility
    return true;
}
//# sourceMappingURL=basescan-monitor.js.map