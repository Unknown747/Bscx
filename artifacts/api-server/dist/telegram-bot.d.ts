/**
 * telegram-bot.ts — Telegram command interface for Base Sniper
 *
 * Uses long-polling (getUpdates). Only responds to messages from the
 * configured TELEGRAM_CHAT_ID so strangers cannot control the bot.
 *
 * Commands:
 *   /help       — show available commands
 *   /status     — scanner + open positions summary
 *   /balance    — ETH balance + USD value
 *   /candidates — list pending whale candidates
 *   /approve <addr> — approve a whale candidate
 *   /reject  <addr> — reject a whale candidate
 *   /history    — last 5 closed trades + P&L stats
 *   /blacklist  — show current blacklist
 *   /positions  — open positions detail
 */
import type { AISniperBot } from './ai-sniper-integration';
export declare class TelegramBot {
    private token;
    private chatId;
    private bot;
    private offset;
    private running;
    private pollTimer;
    constructor(token: string, chatId: string, bot: AISniperBot);
    start(): void;
    stop(): void;
    private scheduleNext;
    private poll;
    private handleUpdate;
    private cmdHelp;
    private cmdStatus;
    private cmdBalance;
    private cmdCandidates;
    private cmdApprove;
    private cmdReject;
    private cmdPositions;
    private cmdHistory;
    private cmdDailyReport;
    private cmdBlacklist;
    sendTradeAlert(trade: {
        action: 'BUY' | 'SELL' | 'COPY_BUY';
        tokenSymbol: string;
        tokenAddress: string;
        amountEth: number;
        profitPct?: number;
        reason?: string;
        confidence?: number;
        txHash?: string;
        whaleAddress?: string;
        whaleName?: string;
    }): Promise<void>;
    sendRiskAlert(type: 'daily_loss' | 'consecutive_loss' | 'cooldown' | 'blocked', details: string): Promise<void>;
    sendWaitlistAlert(candidate: {
        address: string;
        score: number;
        estimatedWinRate: number;
        avgProfitPct: number;
        tradeCount: number;
        index: number;
        total: number;
    }): Promise<void>;
    send(text: string): Promise<void>;
}
export declare function startTelegramBot(bot: AISniperBot): TelegramBot | null;
//# sourceMappingURL=telegram-bot.d.ts.map