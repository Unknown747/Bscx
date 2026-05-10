"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramBot = void 0;
exports.startTelegramBot = startTelegramBot;
const axios_1 = __importDefault(require("axios"));
const POLL_TIMEOUT = 30; // seconds for long-poll
const HELP_TEXT = `🔥 <b>Base Sniper Bot Commands</b>\n\n` +
    `/status        — Status scanner & posisi aktif\n` +
    `/balance       — Cek saldo ETH wallet\n` +
    `/candidates    — Whale kandidat yang menunggu\n` +
    `/approve &lt;addr&gt; — Setujui whale kandidat\n` +
    `/reject &lt;addr&gt;  — Tolak whale kandidat\n` +
    `/positions     — Detail posisi yang sedang terbuka\n` +
    `/history       — 5 trade terakhir + statistik\n` +
    `/blacklist     — Daftar token yang diblacklist\n` +
    `/dailyreport   — Laporan P&amp;L hari ini\n` +
    `/help          — Tampilkan menu ini`;
class TelegramBot {
    constructor(token, chatId, bot) {
        this.offset = 0;
        this.running = false;
        this.pollTimer = null;
        this.token = token;
        this.chatId = chatId;
        this.bot = bot;
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        console.log('🤖 Telegram command bot started (polling)');
        this.poll();
    }
    stop() {
        this.running = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }
    scheduleNext() {
        if (!this.running)
            return;
        this.pollTimer = setTimeout(() => this.poll(), 500);
    }
    async poll() {
        if (!this.running)
            return;
        try {
            const res = await axios_1.default.get(`https://api.telegram.org/bot${this.token}/getUpdates`, { params: { offset: this.offset, timeout: POLL_TIMEOUT, allowed_updates: ['message'] }, timeout: (POLL_TIMEOUT + 5) * 1000 });
            const updates = res.data?.result ?? [];
            for (const update of updates) {
                this.offset = update.update_id + 1;
                await this.handleUpdate(update).catch(() => { });
            }
        }
        catch {
            // Network blip — wait a bit longer before retry
            await new Promise(r => setTimeout(r, 5000));
        }
        this.scheduleNext();
    }
    async handleUpdate(update) {
        const msg = update.message;
        if (!msg?.text)
            return;
        const fromId = String(msg.chat?.id ?? msg.from?.id ?? '');
        if (fromId !== this.chatId) {
            await this.send('⛔ Akses ditolak.');
            return;
        }
        const text = msg.text.trim();
        const parts = text.split(/\s+/);
        const cmd = parts[0].toLowerCase().replace(/^\//, '').split('@')[0];
        const arg = parts[1] ?? '';
        switch (cmd) {
            case 'start':
            case 'help':
                await this.cmdHelp();
                break;
            case 'status':
                await this.cmdStatus();
                break;
            case 'balance':
                await this.cmdBalance();
                break;
            case 'candidates':
                await this.cmdCandidates();
                break;
            case 'approve':
                await this.cmdApprove(arg);
                break;
            case 'reject':
                await this.cmdReject(arg);
                break;
            case 'positions':
                await this.cmdPositions();
                break;
            case 'history':
                await this.cmdHistory();
                break;
            case 'blacklist':
                await this.cmdBlacklist();
                break;
            case 'dailyreport':
                await this.cmdDailyReport();
                break;
            default:
                await this.send(`❓ Perintah tidak dikenal: <code>${text}</code>\nKetik /help untuk daftar perintah.`);
        }
    }
    // ── Commands ──────────────────────────────────────────────────────────────
    async cmdHelp() {
        await this.send(HELP_TEXT);
    }
    async cmdStatus() {
        const st = this.bot.getStatus();
        const pos = st.openPositions ?? [];
        const cfg = this.bot.getRuntimeConfig();
        const posLine = pos.length > 0
            ? pos.map((p) => `  • ${p.tokenSymbol || p.tokenAddress?.slice(0, 10)}`).join('\n')
            : '  (tidak ada)';
        await this.send(`📊 <b>Status Base Sniper</b>\n\n` +
            `🔌 WebSocket: ${st.connected ? '✅ Terhubung' : '❌ Terputus'}\n` +
            `🤖 AI: ${cfg.aiEnabled ? '✅ Aktif' : '⏸ Nonaktif'}\n` +
            `🐋 Copy Trading: ${cfg.copyEnabled ? '✅ Aktif' : '⏸ Nonaktif'}\n` +
            `🦎 Gecko Scanner: ${cfg.geckoScannerEnabled ? '✅ Aktif' : '⏸ Nonaktif'}\n` +
            `💰 Modal: ${cfg.totalCapital} ETH\n\n` +
            `📂 Posisi aktif (${pos.length}):\n${posLine}`);
    }
    async cmdBalance() {
        try {
            const portfolio = await this.bot.getPortfolio();
            const ethBal = parseFloat(portfolio.ethBalance ?? '0');
            const usdVal = portfolio.ethValueUsd ?? 0;
            const totalUsd = portfolio.totalValueUsd ?? usdVal;
            const tokens = (portfolio.tokens ?? []);
            const tokenLines = tokens.length > 0
                ? tokens.map((t) => `  • ${t.symbol || '?'}: ${parseFloat(t.balanceFormatted ?? '0').toFixed(4)} (~$${(t.valueUsd ?? 0).toFixed(2)})`).join('\n')
                : '  (tidak ada token)';
            await this.send(`💰 <b>Saldo Wallet</b>\n\n` +
                `ETH: <b>${ethBal.toFixed(6)} ETH</b> (~$${usdVal.toFixed(2)})\n\n` +
                `📦 Token di portfolio:\n${tokenLines}\n\n` +
                `💼 Total nilai: <b>$${totalUsd.toFixed(2)}</b>`);
        }
        catch (err) {
            await this.send(`❌ Gagal cek saldo: ${err.message}`);
        }
    }
    async cmdCandidates() {
        const pending = this.bot.getPendingWhales();
        if (pending.length === 0) {
            await this.send('🐋 Tidak ada whale kandidat yang menunggu.\n\nGunakan fitur Auto Scan di dashboard atau tunggu scan berikutnya.');
            return;
        }
        const lines = pending.slice(0, 8).map((c, i) => {
            const stars = c.score >= 80 ? '⭐⭐⭐' : c.score >= 65 ? '⭐⭐' : '⭐';
            const days = ((Date.now() - c.lastActiveMs) / 86400000).toFixed(1);
            return (`${stars} <b>#${i + 1}</b> Skor: ${c.score}/100\n` +
                `   <code>${c.address}</code>\n` +
                `   WR: ${c.estimatedWinRate}% | Profit: +${c.avgProfitPct}% | ${days}h lalu\n` +
                `   ✅ /approve ${c.address.slice(0, 10)}...\n` +
                `   ❌ /reject ${c.address.slice(0, 10)}...`);
        }).join('\n\n');
        await this.send(`🐋 <b>${pending.length} Whale Kandidat Menunggu</b>\n\n${lines}\n\n` +
            `<i>Gunakan /approve &lt;alamat-lengkap&gt; atau /reject &lt;alamat-lengkap&gt;</i>`);
    }
    async cmdApprove(addr) {
        if (!addr || !addr.match(/^0x[0-9a-fA-F]{10,40}$/i)) {
            const pending = this.bot.getPendingWhales();
            if (pending.length === 0) {
                await this.send('❌ Tidak ada kandidat pending. Gunakan /candidates untuk melihat daftar.');
                return;
            }
            const matched = pending.find((c) => c.address.toLowerCase().startsWith(addr.toLowerCase()));
            if (!matched) {
                await this.send(`❌ Format: /approve &lt;alamat-lengkap&gt;\nContoh: /approve ${pending[0]?.address ?? '0x...'}`);
                return;
            }
            addr = matched.address;
        }
        const full = addr.length < 42
            ? this.bot.getPendingWhales().find((c) => c.address.toLowerCase().startsWith(addr.toLowerCase()))?.address
            : addr;
        if (!full) {
            await this.send('❌ Kandidat tidak ditemukan.');
            return;
        }
        const ok = this.bot.addToMonitoring(full);
        if (!ok) {
            await this.send(`❌ Kandidat tidak ditemukan atau sudah diproses:\n<code>${full}</code>`);
        }
        else {
            await this.send(`🔬 <b>Whale Masuk Monitoring!</b>\n\n` +
                `<code>${full}</code>\n\n` +
                `Bot akan mengamati trade wallet ini.\n` +
                `Gunakan dashboard → 🔬 Monitor untuk evaluasi AI & promosikan ke copy.`);
        }
    }
    async cmdReject(addr) {
        if (!addr || !addr.match(/^0x[0-9a-fA-F]{10,40}$/i)) {
            const pending = this.bot.getPendingWhales();
            const matched = pending.find((c) => c.address.toLowerCase().startsWith(addr.toLowerCase()));
            if (!matched) {
                await this.send(`❌ Format: /reject &lt;alamat-lengkap&gt;\nContoh: /reject ${pending[0]?.address ?? '0x...'}`);
                return;
            }
            addr = matched.address;
        }
        const full = addr.length < 42
            ? this.bot.getPendingWhales().find((c) => c.address.toLowerCase().startsWith(addr.toLowerCase()))?.address
            : addr;
        if (!full) {
            await this.send('❌ Kandidat tidak ditemukan.');
            return;
        }
        this.bot.rejectWhale(full);
        await this.send(`❌ <b>Whale Ditolak</b>\n<code>${full}</code>`);
    }
    async cmdPositions() {
        const st = this.bot.getStatus();
        const pos = st.openPositions ?? [];
        if (pos.length === 0) {
            await this.send('📂 Tidak ada posisi yang sedang terbuka.');
            return;
        }
        const lines = pos.map((p) => {
            const holdMin = p.openedAt ? ((Date.now() - p.openedAt) / 60000).toFixed(0) : '?';
            const pnl = p.currentPnlPct != null ? `${p.currentPnlPct >= 0 ? '+' : ''}${p.currentPnlPct.toFixed(1)}%` : 'N/A';
            return (`🪙 <b>${p.tokenSymbol || 'UNKNOWN'}</b>\n` +
                `   Masuk: ${p.amountEth?.toFixed(5) ?? '?'} ETH\n` +
                `   P&amp;L saat ini: <b>${pnl}</b>\n` +
                `   Hold: ${holdMin} menit\n` +
                `   <a href="https://basescan.org/address/${p.tokenAddress}">Basescan</a>`);
        }).join('\n\n');
        await this.send(`📂 <b>${pos.length} Posisi Terbuka</b>\n\n${lines}`);
    }
    async cmdHistory() {
        const { trades, stats } = this.bot.getTradeHistory();
        const recent = trades.slice(0, 5);
        const tradeLines = recent.length === 0
            ? '  (belum ada)'
            : recent.map((t) => {
                const pnl = t.profitPct != null ? `${t.profitPct >= 0 ? '+' : ''}${t.profitPct.toFixed(1)}%` : 'N/A';
                const icon = !t.profitPct ? '⚪' : t.profitPct > 0 ? '✅' : '❌';
                return `${icon} <b>${t.tokenSymbol}</b> — ${pnl} (${t.reason})`;
            }).join('\n');
        await this.send(`📈 <b>Trade History</b>\n\n` +
            `Total: ${stats.total} | ✅ ${stats.wins} | ❌ ${stats.losses}\n` +
            `Win Rate: ${stats.winRate.toFixed(1)}%\n` +
            `Total P&amp;L: ${stats.totalProfitPct >= 0 ? '+' : ''}${stats.totalProfitPct.toFixed(1)}%\n\n` +
            `<b>5 Trade Terakhir:</b>\n${tradeLines}`);
    }
    async cmdDailyReport() {
        try {
            const report = await this.bot.getDailyPnlReport();
            await this.send(report);
        }
        catch {
            await this.send('❌ Gagal mengambil laporan P&L. Coba lagi nanti.');
        }
    }
    async cmdBlacklist() {
        const bl = this.bot.getBlacklist();
        if (bl.length === 0) {
            await this.send('🚫 Blacklist kosong.');
            return;
        }
        const lines = bl.slice(0, 10).map((b) => `• <code>${b.address.slice(0, 18)}...</code>${b.label ? ' — ' + b.label : ''}`).join('\n');
        await this.send(`🚫 <b>Blacklist (${bl.length} token)</b>\n\n${lines}`);
    }
    // ── Pro trade alert ──────────────────────────────────────────────────────
    async sendTradeAlert(trade) {
        const chartUrl = `https://www.geckoterminal.com/base/pools/${trade.tokenAddress}`;
        const scanUrl = trade.txHash ? `https://basescan.org/tx/${trade.txHash}` : '';
        const icon = trade.action === 'BUY' ? '🟢' : trade.action === 'COPY_BUY' ? '🐋' : '🔴';
        const pnlLine = trade.profitPct != null
            ? `\n📈 P&L: <b>${trade.profitPct >= 0 ? '+' : ''}${trade.profitPct.toFixed(1)}%</b>`
            : '';
        const confLine = trade.confidence != null ? `\n🤖 AI Confidence: ${trade.confidence}%` : '';
        const whaleLine = trade.whaleName ? `\n🐋 Whale: <b>${trade.whaleName}</b>` : '';
        const txLine = scanUrl ? `\n🔗 <a href="${scanUrl}">Lihat TX</a> · <a href="${chartUrl}">Chart</a>` : `\n📊 <a href="${chartUrl}">Lihat Chart</a>`;
        const reasonLine = trade.reason ? `\n💡 ${trade.reason}` : '';
        await this.send(`${icon} <b>${trade.action === 'COPY_BUY' ? 'COPY TRADE' : trade.action}</b>\n` +
            `Token: <code>${trade.tokenSymbol}</code>${whaleLine}\n` +
            `💰 Jumlah: ${trade.amountEth.toFixed(5)} ETH` +
            pnlLine + confLine + reasonLine + txLine);
    }
    // ── Risk alert ──────────────────────────────────────────────────────────
    async sendRiskAlert(type, details) {
        const icons = {
            daily_loss: '🔴',
            consecutive_loss: '⚠️',
            cooldown: '⏳',
            blocked: '🚫',
        };
        const titles = {
            daily_loss: 'Daily Loss Limit Tercapai',
            consecutive_loss: 'Consecutive Loss Alert',
            cooldown: 'Cooldown Aktif',
            blocked: 'Trade Diblokir Risk Manager',
        };
        await this.send(`${icons[type] || '⚠️'} <b>Risk Alert: ${titles[type] || type}</b>\n\n` +
            `${details}\n\n` +
            `<i>Bot akan melanjutkan trading setelah kondisi terpenuhi.</i>`);
    }
    // ── Waitlist entry alert ─────────────────────────────────────────────────
    async sendWaitlistAlert(candidate) {
        const stars = candidate.score >= 80 ? '⭐⭐⭐' : candidate.score >= 65 ? '⭐⭐' : '⭐';
        const scoreBar = '█'.repeat(Math.round(candidate.score / 10)) + '░'.repeat(10 - Math.round(candidate.score / 10));
        await this.send(`🐋 <b>Whale Baru Masuk Waitlist</b> (${candidate.index + 1}/${candidate.total})\n\n` +
            `${stars} <code>${candidate.address}</code>\n\n` +
            `📊 Skor: <b>${candidate.score}/100</b>\n` +
            `${scoreBar}\n\n` +
            `📈 Win Rate:  <b>${candidate.estimatedWinRate}%</b>\n` +
            `💰 Avg Profit: <b>+${candidate.avgProfitPct}%</b>\n` +
            `🔢 Total Trade: ${candidate.tradeCount}\n\n` +
            `✅ Setujui: /approve ${candidate.address}\n` +
            `❌ Tolak:   /reject  ${candidate.address}`);
    }
    // ── Helper ────────────────────────────────────────────────────────────────
    async send(text) {
        try {
            await axios_1.default.post(`https://api.telegram.org/bot${this.token}/sendMessage`, { chat_id: this.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }, { timeout: 8000 });
        }
        catch { /* silent */ }
    }
}
exports.TelegramBot = TelegramBot;
function startTelegramBot(bot) {
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    const chatId = process.env.TELEGRAM_CHAT_ID || '';
    if (!token || !chatId) {
        console.log('ℹ️  Telegram bot: no token/chatId — command interface disabled');
        return null;
    }
    const tgBot = new TelegramBot(token, chatId, bot);
    tgBot.start();
    return tgBot;
}
//# sourceMappingURL=telegram-bot.js.map