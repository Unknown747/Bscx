/**
 * telegram-bot.ts — Pro Telegram Command Interface for Base Sniper
 *
 * Features:
 *  • Long-polling with inline keyboard / callback query support
 *  • Visual score bars, structured sections, dividers
 *  • Inline buttons for whale approve/reject/promote
 *  • 17 commands covering status, trading, whale mgmt, settings
 *
 * Commands:
 *   INFO:     /status /balance /positions /screener /risk /history /dailyreport
 *   WHALE:    /candidates /approve /reject /promote /scan
 *   CONTROLS: /sell /pause /resume /blacklist
 *   SETTINGS: /set /help
 */

import axios from 'axios';
import type { AISniperBot } from './ai-sniper-integration';

// ─── Formatting helpers ───────────────────────────────────────────────────────

const DIV = '━'.repeat(26);

function bar(value: number, max: number, len = 10): string {
    const filled = Math.max(0, Math.min(len, Math.round((value / Math.max(max, 0.0001)) * len)));
    return '█'.repeat(filled) + '░'.repeat(len - filled);
}

function pct(v: number): string {
    return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function fmtHold(ms: number): string {
    const s   = Math.floor(ms / 1000);
    const h   = Math.floor(s / 3600);
    const m   = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
}

function fmtAddr(addr: string): string {
    if (!addr || addr.length < 10) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function stars(score: number): string {
    if (score >= 80) return '⭐⭐⭐';
    if (score >= 65) return '⭐⭐';
    return '⭐';
}

// ─── Help text ────────────────────────────────────────────────────────────────

const HELP_TEXT =
    `⚡ <b>Base Sniper — Commands</b>\n` +
    `<code>${DIV}</code>\n\n` +
    `<b>📊 Info</b>\n` +
    `/status        — Scanner &amp; bot health\n` +
    `/balance       — Wallet balance &amp; portfolio\n` +
    `/positions     — Open positions &amp; live P&amp;L\n` +
    `/screener      — Top SmartScreener signals\n` +
    `/risk          — Risk manager &amp; circuit breaker\n` +
    `/history       — Trade history &amp; all-time stats\n` +
    `/dailyreport   — Today's P&amp;L summary\n\n` +
    `<b>⚙️ Controls</b>\n` +
    `/sell &lt;sym|all&gt;  — Manual sell position\n` +
    `/pause         — Pause all trading (emergency)\n` +
    `/resume        — Re-enable scanners\n` +
    `/blacklist     — Show blacklisted tokens\n\n` +
    `<b>🔧 Settings</b>\n` +
    `/set sl &lt;%&gt;        — Stop loss %\n` +
    `/set tp1 &lt;x&gt;      — TP1 multiplier (e.g. 1.5)\n` +
    `/set tp2 &lt;x&gt;      — TP2 multiplier (e.g. 3)\n` +
    `/set capital &lt;eth&gt; — Total capital (ETH)\n` +
    `/set ai on|off   — Toggle AI analysis\n` +
    `<code>${DIV}</code>`;

// ─── Main class ───────────────────────────────────────────────────────────────

export class TelegramBot {
    private token:    string;
    private chatId:   string;
    private bot:      AISniperBot;
    private offset    = 0;
    private running   = false;
    private pollTimer: NodeJS.Timeout | null = null;

    constructor(token: string, chatId: string, bot: AISniperBot) {
        this.token  = token;
        this.chatId = chatId;
        this.bot    = bot;
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        console.log('🤖 Telegram command bot started (polling)');
        this.poll();
    }

    stop(): void {
        this.running = false;
        if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
    }

    private scheduleNext(): void {
        if (!this.running) return;
        this.pollTimer = setTimeout(() => this.poll(), 500);
    }

    private async poll(): Promise<void> {
        if (!this.running) return;
        try {
            const res = await axios.get(
                `https://api.telegram.org/bot${this.token}/getUpdates`,
                {
                    params: {
                        offset:          this.offset,
                        timeout:         30,
                        allowed_updates: ['message', 'callback_query'],
                    },
                    timeout: 35_000,
                }
            );
            const updates: any[] = res.data?.result ?? [];
            for (const update of updates) {
                this.offset = update.update_id + 1;
                if (update.message)        await this.handleMessage(update.message).catch(() => {});
                if (update.callback_query) await this.handleCallback(update.callback_query).catch(() => {});
            }
        } catch {
            await new Promise(r => setTimeout(r, 5000));
        }
        this.scheduleNext();
    }

    // ─── Auth ─────────────────────────────────────────────────────────────────

    private isAuthorized(obj: any): boolean {
        const id = String(obj?.chat?.id ?? obj?.from?.id ?? '');
        return id === this.chatId;
    }

    // ─── Message router ───────────────────────────────────────────────────────

    private async handleMessage(msg: any): Promise<void> {
        if (!msg?.text) return;
        if (!this.isAuthorized(msg)) { await this.send('⛔ Access denied.'); return; }

        const parts = (msg.text as string).trim().split(/\s+/);
        const cmd   = parts[0].toLowerCase().replace(/^\//, '').split('@')[0];
        const args  = parts.slice(1);

        switch (cmd) {
            case 'start':
            case 'help':        await this.cmdHelp();              break;
            case 'status':      await this.cmdStatus();            break;
            case 'balance':     await this.cmdBalance();           break;
            case 'positions':   await this.cmdPositions();         break;
            case 'screener':    await this.cmdScreener();          break;
            case 'risk':        await this.cmdRisk();              break;
            case 'history':     await this.cmdHistory();           break;
            case 'dailyreport': await this.cmdDailyReport();       break;
            case 'sell':        await this.cmdSell(args);          break;
            case 'pause':       await this.cmdPause();             break;
            case 'resume':      await this.cmdResume();            break;
            case 'blacklist':   await this.cmdBlacklist();         break;
            case 'set':         await this.cmdSet(args);           break;
            default:
                await this.send(
                    `❓ Unknown command: <code>/${cmd}</code>\n\nType /help for the full list.`
                );
        }
    }

    // ─── Callback router (inline buttons) ────────────────────────────────────

    private async handleCallback(cb: any): Promise<void> {
        if (!this.isAuthorized(cb)) return;
        await this.answerCallback(cb.id);
        const data             = (cb.data as string) ?? '';
        const [action, ...rest] = data.split(':');
        const addr             = rest.join(':');

        switch (action) {
            case 'sell_pos': await this.cmdSell([addr, '100']);  break;
            case 'status':   await this.cmdStatus();             break;
            case 'screener': await this.cmdScreener();           break;
            case 'risk':     await this.cmdRisk();               break;
            case 'balance':  await this.cmdBalance();            break;
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // COMMANDS
    // ══════════════════════════════════════════════════════════════════════════

    private async cmdHelp(): Promise<void> {
        await this.sendKb(HELP_TEXT, {
            inline_keyboard: [
                [
                    { text: '📊 Status',   callback_data: 'status'   },
                    { text: '💰 Balance',  callback_data: 'balance'  },
                ],
                [
                    { text: '📡 Screener', callback_data: 'screener' },
                    { text: '🛡️ Risk',     callback_data: 'risk'     },
                ],
            ],
        });
    }

    private async cmdStatus(): Promise<void> {
        const st  = this.bot.getStatus();
        const cfg = this.bot.getRuntimeConfig();
        const rs  = st.riskState;
        const pos = st.openPositions ?? [];

        const connIcon   = st.connected               ? '🟢' : '🔴';
        const aiIcon     = cfg.aiEnabled               ? '✅' : '⏸';
        const screenIcon = st.smartScreener?.enabled   ? '✅' : '⏸';
        const geckoIcon  = st.geckoScanner?.enabled    ? '✅' : '⏸';
        const cbIcon     = rs.circuitBreakerTripped    ? '🔴' : '🟢';

        const lossUsedPct = rs.dailyLossLimit > 0
            ? Math.min(100, (rs.todayLossEth / rs.dailyLossLimit) * 100)
            : 0;
        const lossBar = bar(lossUsedPct, 100);

        const posLines = pos.length > 0
            ? pos.map((p: any) => {
                const entryEth = p.amountIn ? (Number(p.amountIn) / 1e18).toFixed(5) : '?';
                return `  • <b>${p.tokenSymbol || fmtAddr(p.tokenAddress)}</b> — ${entryEth} ETH`;
            }).join('\n')
            : '  <i>None</i>';

        await this.sendKb(
            `⚡ <b>Base Sniper — Status</b>\n` +
            `<code>${DIV}</code>\n\n` +
            `${connIcon} WebSocket: <b>${st.connected ? 'Connected' : 'Disconnected'}</b>\n` +
            `${st.emergencyStop ? '🚨 <b>EMERGENCY STOP ACTIVE</b>\n' : ''}` +
            `\n<b>🔌 Modules</b>\n` +
            `AI Analysis    ${aiIcon}\n` +
            `SmartScreener  ${screenIcon}\n` +
            `GeckoScanner   ${geckoIcon}\n` +
            `\n<b>🛡️ Risk</b>\n` +
            `Circuit Breaker: ${cbIcon} ${rs.circuitBreakerTripped ? 'TRIPPED' : 'Clear'}\n` +
            `Daily Loss: <code>${lossBar}</code> ${lossUsedPct.toFixed(0)}%\n` +
            `Positions: ${pos.length} / ${this.bot['CONFIG']?.MAX_OPEN_POSITIONS ?? 3}\n` +
            `\n<b>📂 Open Positions (${pos.length})</b>\n` +
            `${posLines}\n` +
            `\n<code>${DIV}</code>\n` +
            `<i>Capital: ${cfg.totalCapital} ETH · SL: ${cfg.stopLoss}% · TP1: ${cfg.tp1Multiplier}x</i>`,
            {
                inline_keyboard: [[
                    { text: '📡 Screener',  callback_data: 'screener' },
                    { text: '💰 Balance',   callback_data: 'balance'  },
                    { text: '🛡️ Risk',      callback_data: 'risk'     },
                ]],
            }
        );
    }

    private async cmdBalance(): Promise<void> {
        try {
            const portfolio  = await this.bot.getPortfolio();
            const ethBal     = parseFloat(portfolio.ethBalance ?? '0');
            const usdVal     = portfolio.ethValueUsd ?? 0;
            const totalUsd   = portfolio.totalValueUsd ?? usdVal;
            const tokens     = (portfolio.tokens ?? []) as any[];

            const tokenLines = tokens.length > 0
                ? tokens.slice(0, 8).map((t: any) => {
                    const val = t.valueUsd != null ? `$${(t.valueUsd as number).toFixed(2)}` : 'N/A';
                    const chg = t.change24h != null ? `  ${pct(t.change24h as number)}` : '';
                    return `  • <b>${t.symbol}</b>: ${parseFloat(t.balance).toFixed(4)}${chg} — <i>${val}</i>`;
                }).join('\n')
                : '  <i>No tokens held</i>';

            await this.send(
                `💰 <b>Wallet Balance</b>\n` +
                `<code>${DIV}</code>\n\n` +
                `ETH: <b>${ethBal.toFixed(6)} ETH</b>  (~$${usdVal.toFixed(2)})\n\n` +
                `<b>📦 Token Holdings</b>\n` +
                `${tokenLines}\n\n` +
                `<code>${DIV}</code>\n` +
                `💼 Total portfolio: <b>$${totalUsd.toFixed(2)}</b>`
            );
        } catch (err: any) {
            await this.send(`❌ Failed to fetch balance: ${err.message}`);
        }
    }

    private async cmdPositions(): Promise<void> {
        const st  = this.bot.getStatus();
        const pos = st.openPositions ?? [];

        if (pos.length === 0) {
            await this.send(
                `📂 <b>Open Positions</b>\n` +
                `<code>${DIV}</code>\n\n` +
                `<i>No open positions right now.</i>`
            );
            return;
        }

        let livePnl: any[] = [];
        try { livePnl = await this.bot.getLivePnL(); } catch { /* silent */ }

        const lines = pos.map((p: any) => {
            const live    = livePnl.find((l: any) => l.tokenAddress === p.tokenAddress);
            const holdMs  = p.openedAt ? Date.now() - p.openedAt : 0;
            const pnlStr  = live?.profitPct != null ? pct(live.profitPct as number) : 'N/A';
            const multStr = live?.multiplier != null ? `${(live.multiplier as number).toFixed(2)}x` : '';
            const icon    = !live?.profitPct ? '⚪' : (live.profitPct as number) > 0 ? '📈' : '📉';
            const entryEth = p.amountIn ? (Number(p.amountIn) / 1e18).toFixed(5) : '?';
            return (
                `${icon} <b>${p.tokenSymbol || 'UNKNOWN'}</b>${multStr ? `  [${multStr}]` : ''}\n` +
                `   Entry: ${entryEth} ETH  |  P&amp;L: <b>${pnlStr}</b>\n` +
                `   Hold: ${fmtHold(holdMs)}\n` +
                `   <a href="https://basescan.org/address/${p.tokenAddress}">Basescan</a>` +
                ` · <a href="https://www.geckoterminal.com/base/pools/${p.tokenAddress}">Chart</a>`
            );
        }).join('\n\n');

        const buttons = pos.map((p: any) => ([
            {
                text:          `🔴 Sell ${p.tokenSymbol || fmtAddr(p.tokenAddress)} (100%)`,
                callback_data: `sell_pos:${p.tokenAddress}`,
            },
        ]));

        await this.sendKb(
            `📂 <b>Open Positions (${pos.length})</b>\n` +
            `<code>${DIV}</code>\n\n` +
            `${lines}`,
            { inline_keyboard: buttons }
        );
    }

    private async cmdScreener(): Promise<void> {
        const signals = this.bot.getScreenerSignals('BUY');
        const stats   = this.bot.getScreenerStats();

        if (signals.length === 0) {
            await this.send(
                `📡 <b>SmartScreener</b>\n` +
                `<code>${DIV}</code>\n\n` +
                `No BUY / STRONG_BUY signals at the moment.\n\n` +
                `<i>Scans run: ${stats.scanCount} · Signals tracked: ${stats.total}</i>`
            );
            return;
        }

        const top   = signals.slice(0, 5);
        const lines = top.map((s: any, i: number) => {
            const scoreBar = bar(s.score.total, 100, 8);
            const icon     = s.signal === 'STRONG_BUY' ? '🔥' : '📡';
            const chg      = s.priceChangeH1 >= 0 ? `+${s.priceChangeH1.toFixed(1)}%` : `${s.priceChangeH1.toFixed(1)}%`;
            return (
                `${icon} <b>#${i + 1} ${s.tokenSymbol}</b>  [${s.signal}]\n` +
                `   <code>${scoreBar}</code> ${s.score.total}/100\n` +
                `   Liq: $${s.liquidityUsd.toLocaleString()} · Vol: $${s.volumeH24.toLocaleString()}\n` +
                `   1h: <b>${chg}</b> · Buys/h: ${s.buyTxH1} · Age: ${s.ageMinutes}m\n` +
                `   🛡️ Tax: ${s.buyTax}/${s.sellTax}% · ${s.safetyFlags.length === 0 ? 'Clean' : s.safetyFlags.join(', ')}\n` +
                `   <a href="${s.dexUrl}">Chart</a> · <a href="${s.basescanUrl}">Basescan</a>`
            );
        }).join('\n\n');

        await this.send(
            `📡 <b>SmartScreener — Top Signals</b>\n` +
            `<code>${DIV}</code>\n\n` +
            `${lines}\n\n` +
            `<code>${DIV}</code>\n` +
            `<i>🔥 ${stats.strongBuy} STRONG_BUY  ·  📡 ${stats.buy} BUY  ·  Scans: ${stats.scanCount}</i>`
        );
    }

    private async cmdRisk(): Promise<void> {
        const rs  = this.bot.getRiskState();
        const cfg = this.bot.getRuntimeConfig();

        const cbIcon    = rs.circuitBreakerTripped ? '🔴' : '🟢';
        const lossUsed  = rs.dailyLossLimit > 0
            ? Math.min(100, (rs.todayLossEth / rs.dailyLossLimit) * 100)
            : 0;
        const lossBar   = bar(lossUsed, 100);
        const resetInMs = rs.dailyResetAt - Date.now();
        const resetIn   = resetInMs > 0 ? Math.ceil(resetInMs / 60_000) : 0;

        const cooldownLine = rs.cooldownUntil > Date.now()
            ? `⏳ Cooldown: ${Math.ceil((rs.cooldownUntil - Date.now()) / 60_000)}m remaining\n`
            : '';

        await this.send(
            `🛡️ <b>Risk Manager</b>\n` +
            `<code>${DIV}</code>\n\n` +
            `${cbIcon} Circuit Breaker: <b>${rs.circuitBreakerTripped ? 'TRIPPED' : 'Clear'}</b>\n` +
            `${rs.circuitBreakerTripped && rs.circuitBreakerReason
                ? `   <i>${rs.circuitBreakerReason}</i>\n`
                : ''}` +
            `\n<b>📉 Daily Loss Limit</b>\n` +
            `Limit:      <b>${rs.dailyLossLimit.toFixed(4)} ETH</b>\n` +
            `Lost today: <b>${rs.todayLossEth.toFixed(5)} ETH</b>\n` +
            `Used:       <code>${lossBar}</code> ${lossUsed.toFixed(0)}%\n` +
            `Resets in:  ${resetIn}m\n` +
            `\n<b>📊 Session</b>\n` +
            `Consecutive losses: ${rs.consecutiveLosses}\n` +
            `Trades blocked:     ${rs.tradesBlockedToday}\n` +
            `Last trade:         ${rs.lastTradeResult ?? 'N/A'}\n` +
            cooldownLine +
            `\n<b>⚙️ Trade Config</b>\n` +
            `Stop Loss: <b>${cfg.stopLoss}%</b>\n` +
            `TP1: <b>${cfg.tp1Multiplier}x</b>  TP2: <b>${cfg.tp2Multiplier}x</b>\n` +
            `Capital: <b>${cfg.totalCapital} ETH</b>\n` +
            `<code>${DIV}</code>`
        );
    }

    private async cmdHistory(): Promise<void> {
        const { trades, stats } = this.bot.getTradeHistory();
        const recent  = trades.slice(0, 8);
        const wrBar   = bar(stats.winRate, 100);
        const pnlIcon = stats.totalProfitPct >= 0 ? '📈' : '📉';

        const tradeLines = recent.length === 0
            ? '<i>No trades yet.</i>'
            : recent.map((t: any) => {
                const pnlStr = t.profitPct != null ? pct(t.profitPct as number) : 'N/A';
                const icon   = t.profitPct == null ? '⚪' : (t.profitPct as number) > 0 ? '✅' : '❌';
                return `${icon} <b>${t.tokenSymbol || '?'}</b> — <b>${pnlStr}</b>  <i>${t.reason || ''}</i>`;
            }).join('\n');

        await this.send(
            `📈 <b>Trade History</b>\n` +
            `<code>${DIV}</code>\n\n` +
            `Total: <b>${stats.total}</b>  ·  ✅ ${stats.wins}  ·  ❌ ${stats.losses}\n` +
            `Win Rate:    <code>${wrBar}</code> <b>${stats.winRate.toFixed(1)}%</b>\n` +
            `${pnlIcon} All-time P&amp;L: <b>${pct(stats.totalProfitPct)}</b>\n` +
            `${stats.bestTrade  ? `🏆 Best:  <b>+${(stats.bestTrade.profitPct ?? 0).toFixed(1)}%</b> (${stats.bestTrade.tokenSymbol})\n` : ''}` +
            `${stats.worstTrade ? `💀 Worst: <b>${(stats.worstTrade.profitPct ?? 0).toFixed(1)}%</b> (${stats.worstTrade.tokenSymbol})\n` : ''}` +
            `\n<b>Last ${recent.length} Trades</b>\n` +
            `${tradeLines}`
        );
    }

    private async cmdDailyReport(): Promise<void> {
        try {
            const report = await this.bot.getDailyPnlReport();
            await this.send(report);
        } catch {
            await this.send('❌ Failed to generate daily report. Try again later.');
        }
    }

    private async cmdSell(args: string[]): Promise<void> {
        const target = args[0]?.toLowerCase() ?? '';
        const pctNum = args[1] ? parseInt(args[1], 10) : 100;

        if (!target) {
            await this.send(
                `❌ <b>Usage</b>\n\n` +
                `/sell all          — Sell all positions\n` +
                `/sell &lt;symbol&gt;     — Sell 100% of that position\n` +
                `/sell &lt;symbol&gt; 50  — Sell 50% of that position\n\n` +
                `<i>See /positions for open positions.</i>`
            );
            return;
        }

        if (target === 'all') {
            await this.send(`🔴 <b>Emergency: Selling All Positions…</b>`);
            try {
                const result = await this.bot.emergencyStop();
                await this.send(
                    `🔴 <b>All Positions Sold</b>\n\n` +
                    `${result.positionsSold} position(s) closed.\n` +
                    `All scanners stopped.\n\n` +
                    `<i>Use /resume to re-enable scanners.</i>`
                );
            } catch (e: any) {
                await this.send(`❌ Failed: ${e?.message}`);
            }
            return;
        }

        const pos = this.bot.getStatus().openPositions ?? [];
        const position = pos.find((p: any) =>
            (p.tokenSymbol || '').toLowerCase() === target ||
            (p.tokenAddress || '').toLowerCase().startsWith(target)
        );

        if (!position) {
            const names = pos.map((p: any) => p.tokenSymbol || fmtAddr(p.tokenAddress)).join(', ');
            await this.send(
                `❌ Position not found: <code>${target}</code>\n\n` +
                `Open positions: ${names || 'none'}`
            );
            return;
        }

        await this.send(`🔴 Selling ${pctNum}% of <b>${position.tokenSymbol}</b>…`);
        try {
            const result = await this.bot.manualSell(position.tokenAddress, pctNum);
            if (result.success) {
                await this.send(
                    `✅ <b>Sell Executed</b>\n\n` +
                    `Token: <b>${position.tokenSymbol}</b>\n` +
                    `Amount: ${pctNum}%\n` +
                    `${result.txHash
                        ? `TX: <a href="https://basescan.org/tx/${result.txHash}">${result.txHash.slice(0, 14)}…</a>`
                        : ''}`
                );
            } else {
                await this.send(`❌ Sell failed: ${result.error}`);
            }
        } catch (e: any) {
            await this.send(`❌ Error: ${e?.message}`);
        }
    }

    private async cmdPause(): Promise<void> {
        if (this.bot.isEmergencyStopped()) {
            await this.send(
                '⚠️ Bot is already stopped.\n\nUse /resume to re-enable scanners.'
            );
            return;
        }
        await this.send(
            `🛑 <b>Pausing all trading…</b>\n` +
            `<i>Selling open positions and stopping all scanners.</i>`
        );
        try {
            const result = await this.bot.emergencyStop();
            await this.sendKb(
                `🛑 <b>Bot Paused</b>\n` +
                `<code>${DIV}</code>\n\n` +
                `✅ All scanners stopped\n` +
                `${result.positionsSold > 0 ? `🔴 ${result.positionsSold} position(s) sold\n` : ''}` +
                `\n<i>Use /resume to re-enable screeners without a full restart.</i>`,
                {
                    inline_keyboard: [[
                        { text: '▶️ Resume', callback_data: 'status' },
                    ]],
                }
            );
        } catch (e: any) {
            await this.send(`❌ Failed to pause: ${e?.message}`);
        }
    }

    private async cmdResume(): Promise<void> {
        this.bot.updateRuntimeConfig({
            geckoScannerEnabled: true,
        });
        this.bot.setSmartScreenerEnabled(true);
        await this.send(
            `✅ <b>Bot Resumed</b>\n\n` +
            `SmartScreener &amp; GeckoScanner re-enabled.\n\n` +
            `<i>For a full WebSocket reconnect, restart the server.</i>`
        );
    }

    private async cmdBlacklist(): Promise<void> {
        const bl = this.bot.getBlacklist();
        if (bl.length === 0) {
            await this.send(
                `🚫 <b>Blacklist</b>\n` +
                `<code>${DIV}</code>\n\n` +
                `<i>Empty — no tokens blacklisted.</i>`
            );
            return;
        }
        const lines = bl.slice(0, 12).map((b: any) => {
            const hoursAgo = Math.round((Date.now() - b.addedAt) / 3_600_000);
            return `• <code>${(b.address as string).slice(0, 20)}…</code>${b.label ? ` — ${b.label}` : ''} <i>(${hoursAgo}h ago)</i>`;
        }).join('\n');
        await this.send(
            `🚫 <b>Blacklist — ${bl.length} Tokens</b>\n` +
            `<code>${DIV}</code>\n\n` +
            `${lines}` +
            `${bl.length > 12 ? `\n<i>…and ${bl.length - 12} more</i>` : ''}`
        );
    }

    private async cmdSet(args: string[]): Promise<void> {
        const key = args[0]?.toLowerCase() ?? '';
        const val = args[1] ?? '';

        if (!key || !val) {
            await this.send(
                `⚙️ <b>Settings</b>\n` +
                `<code>${DIV}</code>\n\n` +
                `/set sl &lt;%&gt;        — Stop loss % (e.g. 20)\n` +
                `/set tp1 &lt;x&gt;       — TP1 multiplier (e.g. 1.5)\n` +
                `/set tp2 &lt;x&gt;       — TP2 multiplier (e.g. 3)\n` +
                `/set capital &lt;eth&gt; — Total capital in ETH\n` +
                `/set ai on|off     — Toggle AI analysis\n\n` +
                `<i>Changes take effect immediately.</i>`
            );
            return;
        }

        const num = parseFloat(val);
        let applied = '';

        switch (key) {
            case 'sl':
                if (isNaN(num) || num <= 0 || num > 100) {
                    await this.send('❌ Stop loss must be between 1 and 100%');
                    return;
                }
                this.bot.updateRuntimeConfig({ stopLoss: num });
                applied = `Stop Loss → <b>${num}%</b>`;
                break;

            case 'tp1':
                if (isNaN(num) || num <= 1) {
                    await this.send('❌ TP1 must be > 1.0  (e.g. 1.5 = exit at 50% profit)');
                    return;
                }
                this.bot.updateRuntimeConfig({ tp1Multiplier: num });
                applied = `TP1 → <b>${num}x</b>  (+${((num - 1) * 100).toFixed(0)}%)`;
                break;

            case 'tp2':
                if (isNaN(num) || num <= 1) {
                    await this.send('❌ TP2 must be > 1.0');
                    return;
                }
                this.bot.updateRuntimeConfig({ tp2Multiplier: num });
                applied = `TP2 → <b>${num}x</b>  (+${((num - 1) * 100).toFixed(0)}%)`;
                break;

            case 'capital':
                if (isNaN(num) || num <= 0) {
                    await this.send('❌ Capital must be a positive ETH amount');
                    return;
                }
                this.bot.updateRuntimeConfig({ totalCapital: num });
                applied = `Total Capital → <b>${num} ETH</b>`;
                break;

            case 'ai':
                if (!['on', 'off'].includes(val)) {
                    await this.send('❌ Use: /set ai on  or  /set ai off');
                    return;
                }
                this.bot.updateRuntimeConfig({ aiEnabled: val === 'on' });
                applied = `AI Analysis → <b>${val === 'on' ? 'ON ✅' : 'OFF ⏸'}</b>`;
                break;

            default:
                await this.send(
                    `❌ Unknown setting: <code>${key}</code>\n\nType /set to see available options.`
                );
                return;
        }

        await this.send(`✅ <b>Setting Updated</b>\n\n${applied}`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ALERT METHODS  (called from ai-sniper-integration.ts)
    // ══════════════════════════════════════════════════════════════════════════

    async sendTradeAlert(trade: {
        action:        'BUY' | 'SELL';
        tokenSymbol:   string;
        tokenAddress:  string;
        amountEth:     number;
        profitPct?:    number;
        reason?:       string;
        confidence?:   number;
        txHash?:       string;
    }): Promise<void> {
        const chartUrl   = `https://www.geckoterminal.com/base/pools/${trade.tokenAddress}`;
        const scanUrl    = trade.txHash ? `https://basescan.org/tx/${trade.txHash}` : '';
        const icon       = trade.action === 'BUY' ? '🟢' : '🔴';
        const pnlLine    = trade.profitPct  != null ? `\n📈 P&amp;L: <b>${pct(trade.profitPct)}</b>` : '';
        const confLine   = trade.confidence != null ? `\n🤖 AI: ${trade.confidence}% confidence` : '';
        const reasonLine = trade.reason     ? `\n💡 ${trade.reason}` : '';
        const linkLine   = scanUrl
            ? `\n🔗 <a href="${scanUrl}">TX</a> · <a href="${chartUrl}">Chart</a>`
            : `\n📊 <a href="${chartUrl}">Chart</a>`;

        await this.send(
            `${icon} <b>${trade.action}</b>\n` +
            `<code>${DIV}</code>\n` +
            `Token: <b>${trade.tokenSymbol}</b>\n` +
            `Amount: ${trade.amountEth.toFixed(5)} ETH` +
            pnlLine + confLine + reasonLine + linkLine
        );
    }

    async sendRiskAlert(
        type: 'daily_loss' | 'consecutive_loss' | 'cooldown' | 'blocked',
        details: string
    ): Promise<void> {
        const icons:  Record<string, string> = {
            daily_loss:       '🔴',
            consecutive_loss: '⚠️',
            cooldown:         '⏳',
            blocked:          '🚫',
        };
        const titles: Record<string, string> = {
            daily_loss:       'Daily Loss Limit Hit',
            consecutive_loss: 'Consecutive Loss Alert',
            cooldown:         'Cooldown Active',
            blocked:          'Trade Blocked',
        };
        await this.send(
            `${icons[type] ?? '⚠️'} <b>Risk Alert: ${titles[type] ?? type}</b>\n` +
            `<code>${DIV}</code>\n\n` +
            `${details}\n\n` +
            `<i>Trading resumes automatically when conditions clear.</i>`
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════════════════════════

    async send(text: string): Promise<void> {
        try {
            await axios.post(
                `https://api.telegram.org/bot${this.token}/sendMessage`,
                { chat_id: this.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true },
                { timeout: 8000 }
            );
        } catch { /* silent */ }
    }

    private async sendKb(text: string, reply_markup: object): Promise<void> {
        try {
            await axios.post(
                `https://api.telegram.org/bot${this.token}/sendMessage`,
                { chat_id: this.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup },
                { timeout: 8000 }
            );
        } catch { /* silent */ }
    }

    private async answerCallback(callbackQueryId: string): Promise<void> {
        try {
            await axios.post(
                `https://api.telegram.org/bot${this.token}/answerCallbackQuery`,
                { callback_query_id: callbackQueryId },
                { timeout: 5000 }
            );
        } catch { /* silent */ }
    }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function startTelegramBot(bot: AISniperBot): TelegramBot | null {
    const token  = process.env.TELEGRAM_BOT_TOKEN || '';
    const chatId = process.env.TELEGRAM_CHAT_ID   || '';
    if (!token || !chatId) {
        console.log('ℹ️  Telegram bot: no token/chatId — command interface disabled');
        return null;
    }
    const tgBot = new TelegramBot(token, chatId, bot);
    tgBot.start();
    return tgBot;
}
