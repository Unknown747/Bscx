"use strict";
/**
 * push-manager.ts — Web Push Notification Manager
 * Mengelola VAPID keys, subscription storage, dan pengiriman notifikasi push ke browser.
 *
 * VAPID keys bisa di-override via env var VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
 * Jika tidak diset, pakai default yang sudah di-generate untuk project ini.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVapidPublicKey = getVapidPublicKey;
exports.savePushSubscription = savePushSubscription;
exports.removePushSubscription = removePushSubscription;
exports.getSubscriptionCount = getSubscriptionCount;
exports.sendPushToAll = sendPushToAll;
exports.pushBuySuccess = pushBuySuccess;
exports.pushTakeProfit = pushTakeProfit;
exports.pushStopLoss = pushStopLoss;
exports.pushWhaleMonitoring = pushWhaleMonitoring;
exports.pushWhalePromoted = pushWhalePromoted;
const web_push_1 = __importDefault(require("web-push"));
const db_1 = require("./db");
// ── VAPID Configuration ────────────────────────────────────────────────────────
// Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY as Replit Secrets to enable
// browser push notifications. Generate a pair with:
//   npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
let _pushEnabled = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    web_push_1.default.setVapidDetails('mailto:admin@base-sniper.local', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    _pushEnabled = true;
}
else {
    console.warn('⚠️  Push notifications disabled — VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set in Replit Secrets');
}
function getVapidPublicKey() {
    return VAPID_PUBLIC_KEY;
}
// ── Subscribe / Unsubscribe ─────────────────────────────────────────────────────
function savePushSubscription(subscription) {
    (0, db_1.dbSavePushSubscription)(JSON.stringify(subscription));
}
function removePushSubscription(endpoint) {
    (0, db_1.dbDeletePushSubscription)(endpoint);
}
function getSubscriptionCount() {
    return (0, db_1.dbGetPushSubscriptions)().length;
}
async function sendPushToAll(payload) {
    if (!_pushEnabled)
        return;
    const subs = (0, db_1.dbGetPushSubscriptions)();
    if (!subs.length)
        return;
    const json = JSON.stringify(payload);
    const results = await Promise.allSettled(subs.map(async (raw) => {
        let sub;
        try {
            sub = JSON.parse(raw);
        }
        catch {
            return;
        }
        try {
            await web_push_1.default.sendNotification(sub, json);
        }
        catch (err) {
            // 410 Gone = subscription expired/revoked by browser — clean up
            if (err?.statusCode === 410 || err?.statusCode === 404) {
                (0, db_1.dbDeletePushSubscription)(sub.endpoint);
                console.log(`🔔 Removed expired push subscription: ${sub.endpoint.slice(0, 40)}...`);
            }
        }
    }));
    const sent = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    if (subs.length > 0) {
        console.log(`🔔 Push sent to ${sent}/${subs.length} subscribers${failed ? ` (${failed} failed)` : ''}`);
    }
}
// ── Convenience helpers ────────────────────────────────────────────────────────
function pushBuySuccess(symbol, amountEth, txHash) {
    sendPushToAll({
        title: `🔥 BUY ${symbol}`,
        body: `Beli ${amountEth.toFixed(5)} ETH${txHash ? ` · TX: ${txHash.slice(0, 10)}...` : ''}`,
        tag: 'buy',
        data: { type: 'buy', symbol, txHash },
    }).catch(() => { });
}
function pushTakeProfit(symbol, level, profitPct, multiplier) {
    sendPushToAll({
        title: `🎯 TP${level} ${symbol}`,
        body: `+${profitPct.toFixed(1)}%${multiplier ? ` (${multiplier.toFixed(2)}x)` : ''}`,
        tag: 'take-profit',
        data: { type: 'take-profit', symbol, level, profitPct },
    }).catch(() => { });
}
function pushStopLoss(symbol, profitPct, reason) {
    const isEmergency = reason?.startsWith('🚨');
    sendPushToAll({
        title: isEmergency ? `🚨 EMERGENCY EXIT ${symbol}` : `🛑 Stop Loss ${symbol}`,
        body: `${profitPct.toFixed(1)}%${reason ? ` · ${reason.replace(/[🚨⏰🛑💧📉]/gu, '').trim().slice(0, 40)}` : ''}`,
        tag: 'stop-loss',
        data: { type: 'stop-loss', symbol, profitPct },
    }).catch(() => { });
}
function pushWhaleMonitoring(address, name) {
    sendPushToAll({
        title: '🐋 Whale Masuk Monitoring',
        body: `${name || address.slice(0, 10) + '...'} mulai dimonitor`,
        tag: 'whale',
        data: { type: 'whale', address },
    }).catch(() => { });
}
function pushWhalePromoted(address, name) {
    sendPushToAll({
        title: '✅ Whale Dipromosikan!',
        body: `${name || address.slice(0, 10) + '...'} masuk ke active copy list`,
        tag: 'whale-promote',
        data: { type: 'whale-promote', address },
    }).catch(() => { });
}
//# sourceMappingURL=push-manager.js.map