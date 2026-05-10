"use strict";
/**
 * db.ts — SQLite persistent storage for Base Sniper
 * Uses sql.js (pure JS, no native build tools required)
 *
 * Tables: whale_candidates, trade_history, blacklist, copy_wallets
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDb = initDb;
exports.dbUpsertWhale = dbUpsertWhale;
exports.dbGetWhale = dbGetWhale;
exports.dbGetPendingWhales = dbGetPendingWhales;
exports.dbGetAllWhales = dbGetAllWhales;
exports.dbApproveWhale = dbApproveWhale;
exports.dbRejectWhale = dbRejectWhale;
exports.dbWhaleExists = dbWhaleExists;
exports.dbIsRejected = dbIsRejected;
exports.dbInsertTrade = dbInsertTrade;
exports.dbGetTrades = dbGetTrades;
exports.dbAddToBlacklist = dbAddToBlacklist;
exports.dbRemoveFromBlacklist = dbRemoveFromBlacklist;
exports.dbGetBlacklist = dbGetBlacklist;
exports.dbIsBlacklisted = dbIsBlacklisted;
exports.dbAddCopyWallet = dbAddCopyWallet;
exports.dbRemoveCopyWallet = dbRemoveCopyWallet;
exports.dbGetCopyWallets = dbGetCopyWallets;
exports.dbUpdateCopyWallet = dbUpdateCopyWallet;
exports.dbInsertWaitlistEvent = dbInsertWaitlistEvent;
exports.dbGetWaitlistEvents = dbGetWaitlistEvents;
exports.dbGetWaitlistSummary = dbGetWaitlistSummary;
exports.dbMonitorWhale = dbMonitorWhale;
exports.dbAddMonitoredWallet = dbAddMonitoredWallet;
exports.dbRemoveMonitoredWallet = dbRemoveMonitoredWallet;
exports.dbGetMonitoredWallets = dbGetMonitoredWallets;
exports.dbGetMonitoredWallet = dbGetMonitoredWallet;
exports.dbIsMonitored = dbIsMonitored;
exports.dbUpdateMonitoredStats = dbUpdateMonitoredStats;
exports.dbSetMonitoredVerdict = dbSetMonitoredVerdict;
exports.dbGetPushSubscriptions = dbGetPushSubscriptions;
exports.dbSavePushSubscription = dbSavePushSubscription;
exports.dbDeletePushSubscription = dbDeletePushSubscription;
exports.dbGetPushSubscriptionCount = dbGetPushSubscriptionCount;
const sql_js_1 = __importDefault(require("sql.js"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const DB_PATH = path_1.default.resolve(__dirname, '../../base-sniper/base.db');
fs_1.default.mkdirSync(path_1.default.dirname(DB_PATH), { recursive: true });
let _db = null;
let _initPromise = null;
function getDb() {
    if (!_db)
        throw new Error('Database not initialized. Call initDb() first.');
    return _db;
}
function saveDb() {
    if (!_db)
        return;
    const data = _db.export();
    fs_1.default.writeFileSync(DB_PATH, Buffer.from(data));
}
let saveTimer = null;
function scheduleSave() {
    if (saveTimer)
        clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveDb(); saveTimer = null; }, 5000);
}
async function initDb() {
    if (_db)
        return;
    if (_initPromise)
        return _initPromise;
    _initPromise = (async () => {
        const SQL = await (0, sql_js_1.default)();
        if (fs_1.default.existsSync(DB_PATH)) {
            const fileBuffer = fs_1.default.readFileSync(DB_PATH);
            _db = new SQL.Database(fileBuffer);
        }
        else {
            _db = new SQL.Database();
        }
        _db.run(`PRAGMA foreign_keys = ON;`);
        _db.run(`
            CREATE TABLE IF NOT EXISTS whale_candidates (
                address            TEXT PRIMARY KEY,
                estimated_win_rate INTEGER NOT NULL,
                trade_count        INTEGER NOT NULL,
                avg_profit_pct     REAL    NOT NULL,
                total_volume_eth   REAL    NOT NULL,
                last_active_ms     INTEGER NOT NULL,
                discovered_at      INTEGER NOT NULL,
                score              INTEGER NOT NULL,
                tokens             TEXT    NOT NULL,
                status             TEXT    NOT NULL DEFAULT 'pending',
                approved_at        INTEGER
            );

            CREATE TABLE IF NOT EXISTS trade_history (
                id            TEXT PRIMARY KEY,
                token_address TEXT    NOT NULL,
                token_symbol  TEXT    NOT NULL,
                entry_eth     REAL    NOT NULL,
                profit_pct    REAL,
                percent_sold  INTEGER NOT NULL,
                closed_at     INTEGER NOT NULL,
                hold_ms       INTEGER NOT NULL,
                tx_hash       TEXT    NOT NULL,
                reason        TEXT    NOT NULL,
                tp_level      INTEGER
            );

            CREATE TABLE IF NOT EXISTS blacklist (
                address  TEXT PRIMARY KEY,
                label    TEXT,
                added_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS copy_wallets (
                address   TEXT PRIMARY KEY,
                name      TEXT    NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                added_at  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS whale_waitlist_events (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                address      TEXT    NOT NULL,
                event_type   TEXT    NOT NULL,
                token        TEXT,
                profit_pct   REAL,
                volume_eth   REAL,
                recorded_at  INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_wwe_address ON whale_waitlist_events(address);
            CREATE INDEX IF NOT EXISTS idx_wwe_time    ON whale_waitlist_events(recorded_at);

            CREATE TABLE IF NOT EXISTS push_subscriptions (
                endpoint   TEXT PRIMARY KEY,
                data       TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
            );

            CREATE TABLE IF NOT EXISTS monitored_wallets (
                address          TEXT    PRIMARY KEY,
                name             TEXT    NOT NULL,
                monitored_since  INTEGER NOT NULL,
                trades_observed  INTEGER NOT NULL DEFAULT 0,
                wins_observed    INTEGER NOT NULL DEFAULT 0,
                losses_observed  INTEGER NOT NULL DEFAULT 0,
                total_pnl_pct    REAL    NOT NULL DEFAULT 0,
                trades_per_day   REAL    NOT NULL DEFAULT 0,
                last_trade_ms    INTEGER NOT NULL DEFAULT 0,
                ai_verdict       TEXT    NOT NULL DEFAULT 'pending',
                ai_reason        TEXT,
                ai_score         INTEGER,
                promoted_at      INTEGER
            );
        `);
        // Migration: add data_source column if it doesn't exist yet
        const cols = runQuery('PRAGMA table_info(monitored_wallets)').map((c) => c.name);
        if (!cols.includes('data_source')) {
            _db.run("ALTER TABLE monitored_wallets ADD COLUMN data_source TEXT NOT NULL DEFAULT 'gecko'");
        }
        saveDb();
        console.log(`💾 SQLite DB ready: ${DB_PATH}`);
    })();
    return _initPromise;
}
// ── Query helpers ──────────────────────────────────────────────────────────────
function runQuery(sql, params = []) {
    const db = getDb();
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}
function runGet(sql, params = []) {
    const rows = runQuery(sql, params);
    return rows[0];
}
function runExec(sql, params = []) {
    const db = getDb();
    const stmt = db.prepare(sql);
    stmt.run(params);
    stmt.free();
    scheduleSave();
}
function rowToWhale(row) {
    return {
        address: row.address,
        estimatedWinRate: row.estimated_win_rate,
        tradeCount: row.trade_count,
        avgProfitPct: row.avg_profit_pct,
        totalVolumeEth: row.total_volume_eth,
        lastActiveMs: row.last_active_ms,
        discoveredAt: row.discovered_at,
        score: row.score,
        tokens: JSON.parse(row.tokens),
        status: row.status,
        approvedAt: row.approved_at ?? undefined,
    };
}
function dbUpsertWhale(w) {
    runExec(`
        INSERT INTO whale_candidates
            (address, estimated_win_rate, trade_count, avg_profit_pct, total_volume_eth,
             last_active_ms, discovered_at, score, tokens, status, approved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(address) DO UPDATE SET
            estimated_win_rate = excluded.estimated_win_rate,
            trade_count        = excluded.trade_count,
            avg_profit_pct     = excluded.avg_profit_pct,
            total_volume_eth   = excluded.total_volume_eth,
            last_active_ms     = excluded.last_active_ms,
            score              = excluded.score,
            tokens             = excluded.tokens,
            status             = excluded.status,
            approved_at        = excluded.approved_at
    `, [
        w.address, w.estimatedWinRate, w.tradeCount, w.avgProfitPct,
        w.totalVolumeEth, w.lastActiveMs, w.discoveredAt, w.score,
        JSON.stringify(w.tokens), w.status, w.approvedAt ?? null
    ]);
}
function dbGetWhale(address) {
    const row = runGet('SELECT * FROM whale_candidates WHERE address = ?', [address.toLowerCase()]);
    return row ? rowToWhale(row) : null;
}
function dbGetPendingWhales() {
    return runQuery("SELECT * FROM whale_candidates WHERE status = 'pending' ORDER BY score DESC").map(rowToWhale);
}
function dbGetAllWhales() {
    return runQuery('SELECT * FROM whale_candidates ORDER BY discovered_at DESC').map(rowToWhale);
}
function dbApproveWhale(address) {
    const addr = address.toLowerCase();
    runExec("UPDATE whale_candidates SET status = 'approved', approved_at = ? WHERE address = ?", [Date.now(), addr]);
    return dbGetWhale(addr);
}
function dbRejectWhale(address) {
    runExec("UPDATE whale_candidates SET status = 'rejected' WHERE address = ?", [address.toLowerCase()]);
}
function dbWhaleExists(address) {
    return !!runGet('SELECT 1 FROM whale_candidates WHERE address = ?', [address.toLowerCase()]);
}
function dbIsRejected(address) {
    return !!runGet("SELECT 1 FROM whale_candidates WHERE address = ? AND status = 'rejected'", [address.toLowerCase()]);
}
function dbInsertTrade(t) {
    runExec(`
        INSERT OR IGNORE INTO trade_history
            (id, token_address, token_symbol, entry_eth, profit_pct,
             percent_sold, closed_at, hold_ms, tx_hash, reason, tp_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        t.id, t.tokenAddress, t.tokenSymbol, t.entryEth,
        t.profitPct ?? null, t.percentSold, t.closedAt,
        t.holdMs, t.txHash, t.reason, t.tpLevel ?? null
    ]);
}
function dbGetTrades(limit = 200) {
    return runQuery('SELECT * FROM trade_history ORDER BY closed_at DESC LIMIT ?', [limit]).map(row => ({
        id: row.id,
        tokenAddress: row.token_address,
        tokenSymbol: row.token_symbol,
        entryEth: row.entry_eth,
        profitPct: row.profit_pct,
        percentSold: row.percent_sold,
        closedAt: row.closed_at,
        holdMs: row.hold_ms,
        txHash: row.tx_hash,
        reason: row.reason,
        tpLevel: row.tp_level ?? undefined,
    }));
}
// ── Blacklist ─────────────────────────────────────────────────────────────────
function dbAddToBlacklist(address, label) {
    runExec(`
        INSERT OR IGNORE INTO blacklist (address, label, added_at) VALUES (?, ?, ?)
    `, [address.toLowerCase(), label ?? null, Date.now()]);
}
function dbRemoveFromBlacklist(address) {
    runExec('DELETE FROM blacklist WHERE address = ?', [address.toLowerCase()]);
}
function dbGetBlacklist() {
    return runQuery('SELECT * FROM blacklist ORDER BY added_at DESC').map(row => ({
        address: row.address,
        label: row.label ?? undefined,
        addedAt: row.added_at,
    }));
}
function dbIsBlacklisted(address) {
    return !!runGet('SELECT 1 FROM blacklist WHERE address = ?', [address.toLowerCase()]);
}
function dbAddCopyWallet(address, name) {
    runExec(`
        INSERT OR IGNORE INTO copy_wallets (address, name, is_active, added_at) VALUES (?, ?, 1, ?)
    `, [address.toLowerCase(), name, Date.now()]);
}
function dbRemoveCopyWallet(address) {
    runExec('DELETE FROM copy_wallets WHERE address = ?', [address.toLowerCase()]);
}
function dbGetCopyWallets() {
    return runQuery('SELECT * FROM copy_wallets ORDER BY added_at DESC').map(row => ({
        address: row.address,
        name: row.name,
        isActive: !!row.is_active,
        addedAt: row.added_at,
    }));
}
function dbUpdateCopyWallet(address, fields) {
    if (fields.name !== undefined) {
        runExec('UPDATE copy_wallets SET name = ? WHERE address = ?', [fields.name, address.toLowerCase()]);
    }
    if (fields.isActive !== undefined) {
        runExec('UPDATE copy_wallets SET is_active = ? WHERE address = ?', [fields.isActive ? 1 : 0, address.toLowerCase()]);
    }
}
function dbInsertWaitlistEvent(e) {
    runExec(`
        INSERT INTO whale_waitlist_events
            (address, event_type, token, profit_pct, volume_eth, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [e.address.toLowerCase(), e.eventType, e.token ?? null, e.profitPct ?? null, e.volumeEth ?? null, e.recordedAt]);
}
function dbGetWaitlistEvents(address, limit = 50) {
    return runQuery(`
        SELECT * FROM whale_waitlist_events WHERE address = ? ORDER BY recorded_at DESC LIMIT ?
    `, [address.toLowerCase(), limit]).map(r => ({
        id: r.id,
        address: r.address,
        eventType: r.event_type,
        token: r.token ?? undefined,
        profitPct: r.profit_pct ?? undefined,
        volumeEth: r.volume_eth ?? undefined,
        recordedAt: r.recorded_at,
    }));
}
function dbGetWaitlistSummary(address) {
    const events = dbGetWaitlistEvents(address, 200);
    const trades = events.filter(e => e.profitPct != null);
    const wins = trades.filter(e => (e.profitPct ?? 0) > 0).length;
    const losses = trades.filter(e => (e.profitPct ?? 0) < 0).length;
    const avg = trades.length > 0 ? trades.reduce((s, e) => s + (e.profitPct ?? 0), 0) / trades.length : 0;
    return { totalEvents: events.length, wins, losses, avgProfitPct: parseFloat(avg.toFixed(1)) };
}
// ── Whale Candidates — monitoring status ──────────────────────────────────────
function dbMonitorWhale(address) {
    runExec("UPDATE whale_candidates SET status = 'monitoring' WHERE address = ?", [address.toLowerCase()]);
}
function rowToMonitored(row) {
    return {
        address: row.address,
        name: row.name,
        monitoredSince: row.monitored_since,
        tradesObserved: row.trades_observed,
        winsObserved: row.wins_observed,
        lossesObserved: row.losses_observed,
        totalPnlPct: row.total_pnl_pct,
        tradesPerDay: row.trades_per_day,
        lastTradeMs: row.last_trade_ms,
        aiVerdict: row.ai_verdict,
        aiReason: row.ai_reason ?? undefined,
        aiScore: row.ai_score ?? undefined,
        promotedAt: row.promoted_at ?? undefined,
        dataSource: (row.data_source ?? 'gecko'),
    };
}
function dbAddMonitoredWallet(address, name) {
    runExec(`
        INSERT OR IGNORE INTO monitored_wallets
            (address, name, monitored_since, trades_observed, wins_observed,
             losses_observed, total_pnl_pct, trades_per_day, last_trade_ms, ai_verdict)
        VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 'pending')
    `, [address.toLowerCase(), name, Date.now()]);
}
function dbRemoveMonitoredWallet(address) {
    runExec('DELETE FROM monitored_wallets WHERE address = ?', [address.toLowerCase()]);
}
function dbGetMonitoredWallets() {
    return runQuery('SELECT * FROM monitored_wallets ORDER BY monitored_since DESC').map(rowToMonitored);
}
function dbGetMonitoredWallet(address) {
    const row = runGet('SELECT * FROM monitored_wallets WHERE address = ?', [address.toLowerCase()]);
    return row ? rowToMonitored(row) : null;
}
function dbIsMonitored(address) {
    return !!runGet('SELECT 1 FROM monitored_wallets WHERE address = ?', [address.toLowerCase()]);
}
function dbUpdateMonitoredStats(address, stats) {
    const sets = [];
    const values = [];
    if (stats.tradesObserved !== undefined) {
        sets.push('trades_observed = ?');
        values.push(stats.tradesObserved);
    }
    if (stats.winsObserved !== undefined) {
        sets.push('wins_observed = ?');
        values.push(stats.winsObserved);
    }
    if (stats.lossesObserved !== undefined) {
        sets.push('losses_observed = ?');
        values.push(stats.lossesObserved);
    }
    if (stats.totalPnlPct !== undefined) {
        sets.push('total_pnl_pct = ?');
        values.push(stats.totalPnlPct);
    }
    if (stats.tradesPerDay !== undefined) {
        sets.push('trades_per_day = ?');
        values.push(stats.tradesPerDay);
    }
    if (stats.lastTradeMs !== undefined) {
        sets.push('last_trade_ms = ?');
        values.push(stats.lastTradeMs);
    }
    if (stats.dataSource !== undefined) {
        sets.push('data_source = ?');
        values.push(stats.dataSource);
    }
    if (sets.length === 0)
        return;
    values.push(address.toLowerCase());
    runExec(`UPDATE monitored_wallets SET ${sets.join(', ')} WHERE address = ?`, values);
}
function dbSetMonitoredVerdict(address, verdict, score, reason) {
    runExec(`
        UPDATE monitored_wallets SET ai_verdict = ?, ai_score = ?, ai_reason = ? WHERE address = ?
    `, [verdict, score, reason, address.toLowerCase()]);
}
// ── Push Subscriptions ────────────────────────────────────────────────────────
function dbGetPushSubscriptions() {
    return runQuery('SELECT data FROM push_subscriptions').map(r => r.data);
}
function dbSavePushSubscription(data) {
    let endpoint = '';
    try {
        endpoint = JSON.parse(data).endpoint || '';
    }
    catch {
        return;
    }
    if (!endpoint)
        return;
    runExec(`
        INSERT INTO push_subscriptions (endpoint, data, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET data = excluded.data
    `, [endpoint, data, Date.now()]);
}
function dbDeletePushSubscription(endpoint) {
    runExec('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
}
function dbGetPushSubscriptionCount() {
    const row = runGet('SELECT COUNT(*) as cnt FROM push_subscriptions');
    return row?.cnt ?? 0;
}
exports.default = { initDb };
//# sourceMappingURL=db.js.map