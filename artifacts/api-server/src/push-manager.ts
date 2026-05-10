/**
 * push-manager.ts — Web Push Notification Manager
 * Mengelola VAPID keys, subscription storage, dan pengiriman notifikasi push ke browser.
 *
 * VAPID keys bisa di-override via env var VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
 * Jika tidak diset, pakai default yang sudah di-generate untuk project ini.
 */

import webpush, { PushSubscription } from 'web-push';
import { dbGetPushSubscriptions, dbSavePushSubscription, dbDeletePushSubscription } from './db';

// ── VAPID Configuration ────────────────────────────────────────────────────────
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || 'BD23jRxqCgCzdXZTFSu170FgkghSYuX1UqAjfbVyr732TNU_SwrWiPPZxQKfQZm8wfmGJDDMKY4jGX6eUhjbwuY';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'Y1vAvLm527TmA7XGz_f12j9PZHiXNmkj_PVbLEAgEJM';

webpush.setVapidDetails('mailto:admin@base-sniper.local', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export function getVapidPublicKey(): string {
    return VAPID_PUBLIC_KEY;
}

// ── Subscribe / Unsubscribe ─────────────────────────────────────────────────────
export function savePushSubscription(subscription: PushSubscription): void {
    dbSavePushSubscription(JSON.stringify(subscription));
}

export function removePushSubscription(endpoint: string): void {
    dbDeletePushSubscription(endpoint);
}

export function getSubscriptionCount(): number {
    return dbGetPushSubscriptions().length;
}

// ── Send Push Notification ──────────────────────────────────────────────────────
export interface PushPayload {
    title: string;
    body:  string;
    icon?: string;
    tag?:  string;
    data?: Record<string, unknown>;
}

export async function sendPushToAll(payload: PushPayload): Promise<void> {
    const subs = dbGetPushSubscriptions();
    if (!subs.length) return;

    const json = JSON.stringify(payload);
    const results = await Promise.allSettled(
        subs.map(async (raw) => {
            let sub: PushSubscription;
            try { sub = JSON.parse(raw); } catch { return; }
            try {
                await webpush.sendNotification(sub, json);
            } catch (err: any) {
                // 410 Gone = subscription expired/revoked by browser — clean up
                if (err?.statusCode === 410 || err?.statusCode === 404) {
                    dbDeletePushSubscription(sub.endpoint);
                    console.log(`🔔 Removed expired push subscription: ${sub.endpoint.slice(0, 40)}...`);
                }
            }
        })
    );

    const sent   = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    if (subs.length > 0) {
        console.log(`🔔 Push sent to ${sent}/${subs.length} subscribers${failed ? ` (${failed} failed)` : ''}`);
    }
}

// ── Convenience helpers ────────────────────────────────────────────────────────

export function pushBuySuccess(symbol: string, amountEth: number, txHash?: string): void {
    sendPushToAll({
        title: `🔥 BUY ${symbol}`,
        body:  `Beli ${amountEth.toFixed(5)} ETH${txHash ? ` · TX: ${txHash.slice(0, 10)}...` : ''}`,
        tag:   'buy',
        data:  { type: 'buy', symbol, txHash },
    }).catch(() => {});
}

export function pushTakeProfit(symbol: string, level: number, profitPct: number, multiplier?: number): void {
    sendPushToAll({
        title: `🎯 TP${level} ${symbol}`,
        body:  `+${profitPct.toFixed(1)}%${multiplier ? ` (${multiplier.toFixed(2)}x)` : ''}`,
        tag:   'take-profit',
        data:  { type: 'take-profit', symbol, level, profitPct },
    }).catch(() => {});
}

export function pushStopLoss(symbol: string, profitPct: number, reason?: string): void {
    const isEmergency = reason?.startsWith('🚨');
    sendPushToAll({
        title: isEmergency ? `🚨 EMERGENCY EXIT ${symbol}` : `🛑 Stop Loss ${symbol}`,
        body:  `${profitPct.toFixed(1)}%${reason ? ` · ${reason.replace(/[🚨⏰🛑💧📉]/gu, '').trim().slice(0, 40)}` : ''}`,
        tag:   'stop-loss',
        data:  { type: 'stop-loss', symbol, profitPct },
    }).catch(() => {});
}

export function pushWhaleMonitoring(address: string, name?: string): void {
    sendPushToAll({
        title: '🐋 Whale Masuk Monitoring',
        body:  `${name || address.slice(0, 10) + '...'} mulai dimonitor`,
        tag:   'whale',
        data:  { type: 'whale', address },
    }).catch(() => {});
}

export function pushWhalePromoted(address: string, name?: string): void {
    sendPushToAll({
        title: '✅ Whale Dipromosikan!',
        body:  `${name || address.slice(0, 10) + '...'} masuk ke active copy list`,
        tag:   'whale-promote',
        data:  { type: 'whale-promote', address },
    }).catch(() => {});
}
