"use strict";
/**
 * whale-correlator.ts — Whale Correlation Map
 * Deteksi apakah 2+ whale membeli token yang sama dalam window waktu tertentu.
 * Sinyal kuat: multiple whale bergerak bersama = coordinated play.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordWhaleBuy = recordWhaleBuy;
exports.getActiveCorrelations = getActiveCorrelations;
exports.checkTokenCorrelation = checkTokenCorrelation;
exports.getCorrelationBonus = getCorrelationBonus;
const WINDOW_MS = 10 * 60000; // 10 menit
const MIN_WHALES_FOR_SIGNAL = 2;
// In-memory time-windowed buy events
const buyEvents = [];
// Track last clean time
let lastClean = Date.now();
function recordWhaleBuy(walletAddress, walletName, tokenAddress, tokenSymbol, buyAmountEth = 0) {
    buyEvents.push({
        walletAddress: walletAddress.toLowerCase(),
        walletName,
        tokenAddress: tokenAddress.toLowerCase(),
        tokenSymbol,
        timestamp: Date.now(),
        buyAmountEth,
    });
    // Periodic cleanup
    if (Date.now() - lastClean > 60000) {
        cleanupOldEvents();
        lastClean = Date.now();
    }
}
function cleanupOldEvents() {
    const cutoff = Date.now() - WINDOW_MS * 2; // keep 2x window for history
    let i = 0;
    while (i < buyEvents.length && buyEvents[i].timestamp < cutoff)
        i++;
    if (i > 0)
        buyEvents.splice(0, i);
}
function getActiveCorrelations() {
    cleanupOldEvents();
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    // Group recent events by token
    const byToken = new Map();
    for (const ev of buyEvents) {
        if (ev.timestamp < cutoff)
            continue;
        const list = byToken.get(ev.tokenAddress) ?? [];
        list.push(ev);
        byToken.set(ev.tokenAddress, list);
    }
    const signals = [];
    for (const [tokenAddress, events] of byToken) {
        // Deduplicate by wallet
        const uniqueWallets = new Map();
        for (const ev of events) {
            if (!uniqueWallets.has(ev.walletAddress) ||
                ev.timestamp < uniqueWallets.get(ev.walletAddress).timestamp) {
                uniqueWallets.set(ev.walletAddress, ev);
            }
        }
        if (uniqueWallets.size < MIN_WHALES_FOR_SIGNAL)
            continue;
        const walletList = Array.from(uniqueWallets.values());
        const timestamps = walletList.map(e => e.timestamp);
        const firstBuyAt = Math.min(...timestamps);
        const lastBuyAt = Math.max(...timestamps);
        const windowMin = (lastBuyAt - firstBuyAt) / 60000;
        // Confidence: more whales + tighter window = higher confidence
        const countScore = Math.min(50, (uniqueWallets.size - 1) * 15); // 15pt per extra whale
        const timeScore = Math.max(0, 50 - (windowMin / WINDOW_MS * 60000) * 5); // tighter window = better
        const confidence = Math.min(100, Math.round(countScore + timeScore));
        signals.push({
            tokenAddress,
            tokenSymbol: walletList[0].tokenSymbol,
            whaleCount: uniqueWallets.size,
            whales: walletList.map(e => ({
                address: e.walletAddress,
                name: e.walletName,
                timestamp: e.timestamp,
                amountEth: e.buyAmountEth,
            })),
            firstBuyAt,
            lastBuyAt,
            confidence,
            windowMinutes: Math.round(windowMin * 10) / 10,
        });
    }
    // Sort by confidence desc
    return signals.sort((a, b) => b.confidence - a.confidence);
}
function checkTokenCorrelation(tokenAddress) {
    const all = getActiveCorrelations();
    return all.find(s => s.tokenAddress === tokenAddress.toLowerCase()) ?? null;
}
function getCorrelationBonus(tokenAddress) {
    const sig = checkTokenCorrelation(tokenAddress);
    if (!sig)
        return 0;
    // Bonus multiplier for copy amount: 0-20% extra based on correlation confidence
    return Math.round(sig.confidence / 5); // 0-20 bonus points
}
exports.default = { recordWhaleBuy, getActiveCorrelations, checkTokenCorrelation, getCorrelationBonus };
//# sourceMappingURL=whale-correlator.js.map