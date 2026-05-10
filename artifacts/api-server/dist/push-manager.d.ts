/**
 * push-manager.ts — Web Push Notification Manager
 * Mengelola VAPID keys, subscription storage, dan pengiriman notifikasi push ke browser.
 *
 * VAPID keys bisa di-override via env var VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
 * Jika tidak diset, pakai default yang sudah di-generate untuk project ini.
 */
import { PushSubscription } from 'web-push';
export declare function getVapidPublicKey(): string;
export declare function savePushSubscription(subscription: PushSubscription): void;
export declare function removePushSubscription(endpoint: string): void;
export declare function getSubscriptionCount(): number;
export interface PushPayload {
    title: string;
    body: string;
    icon?: string;
    tag?: string;
    data?: Record<string, unknown>;
}
export declare function sendPushToAll(payload: PushPayload): Promise<void>;
export declare function pushBuySuccess(symbol: string, amountEth: number, txHash?: string): void;
export declare function pushTakeProfit(symbol: string, level: number, profitPct: number, multiplier?: number): void;
export declare function pushStopLoss(symbol: string, profitPct: number, reason?: string): void;
export declare function pushWhaleMonitoring(address: string, name?: string): void;
export declare function pushWhalePromoted(address: string, name?: string): void;
//# sourceMappingURL=push-manager.d.ts.map