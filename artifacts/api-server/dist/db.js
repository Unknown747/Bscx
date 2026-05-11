"use strict";
/**
 * db.ts — SQLite persistent storage for Base Sniper
 * Uses sql.js (pure JS, no native build tools required)
 *
 * Tables: trade_history, blacklist, screener_signal_history, activity_logs, open_positions, app_settings, push_subscriptions
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDb = initDb;
exports.dbInsertTrade = dbInsertTrade;
exports.dbGetTrades = dbGetTrades;
exports.dbAddToBlacklist = dbAddToBlacklist;
exports.dbRemoveFromBlacklist = dbRemoveFromBlacklist;
exports.dbGetBlacklist = dbGetBlacklist;
exports.dbIsBlacklisted = dbIsBlacklisted;
exports.dbGetPushSubscriptions = dbGetPushSubscriptions;
exports.dbSavePushSubscription = dbSavePushSubscription;
exports.dbDeletePushSubscription = dbDeletePushSubscription;
exports.dbGetPushSubscriptionCount = dbGetPushSubscriptionCount;
exports.dbSaveSettings = dbSaveSettings;
exports.dbLoadSettings = dbLoadSettings;
exports.dbSaveRuntimeConfig = dbSaveRuntimeConfig;
exports.dbLoadRuntimeConfig = dbLoadRuntimeConfig;
exports.dbSaveScreenerConfig = dbSaveScreenerConfig;
exports.dbLoadScreenerConfig = dbLoadScreenerConfig;
exports.dbSaveScreenerSignal = dbSaveScreenerSignal;
exports.dbGetScreenerHistory = dbGetScreenerHistory;
exports.dbSaveOpenPosition = dbSaveOpenPosition;
exports.dbDeleteOpenPosition = dbDeleteOpenPosition;
exports.dbLoadOpenPositions = dbLoadOpenPositions;
exports.dbInsertActivityLog = dbInsertActivityLog;
exports.dbGetRecentActivityLogs = dbGetRecentActivityLogs;
exports.dbSavePaperPosition = dbSavePaperPosition;
exports.dbDeletePaperPosition = dbDeletePaperPosition;
exports.dbGetPaperPositions = dbGetPaperPositions;
exports.dbInsertPaperTrade = dbInsertPaperTrade;
exports.dbGetPaperTrades = dbGetPaperTrades;
exports.dbResetPaperTrading = dbResetPaperTrading;
exports.dbGetPaperConfig = dbGetPaperConfig;
exports.dbSetPaperConfig = dbSetPaperConfig;
const sql_js_1 = __importDefault(require("sql.js"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// DB_PATH can be overridden via environment variable for VPS deployments.
// Default: artifacts/base-sniper/base.db (relative to compiled dist/)
const DB_PATH = process.env.DB_PATH
    ? path_1.default.resolve(process.env.DB_PATH)
    : path_1.default.resolve(__dirname, '../../base-sniper/base.db');
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

            CREATE TABLE IF NOT EXISTS app_settings (
                key        TEXT PRIMARY KEY,
                value      TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS push_subscriptions (
                endpoint   TEXT PRIMARY KEY,
                data       TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
            );

            CREATE TABLE IF NOT EXISTS screener_signal_history (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                token_addr    TEXT    NOT NULL,
                symbol        TEXT    NOT NULL,
                signal        TEXT    NOT NULL,
                score_total   INTEGER NOT NULL,
                liq_usd       REAL    NOT NULL DEFAULT 0,
                vol_h24       REAL    NOT NULL DEFAULT 0,
                price_chg_h1  REAL    NOT NULL DEFAULT 0,
                buy_tx_h1     INTEGER NOT NULL DEFAULT 0,
                age_minutes   REAL    NOT NULL DEFAULT 0,
                dex_url       TEXT    NOT NULL DEFAULT '',
                source        TEXT    NOT NULL DEFAULT '',
                discovered_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ssh_time   ON screener_signal_history(discovered_at);
            CREATE INDEX IF NOT EXISTS idx_ssh_signal ON screener_signal_history(signal);

            CREATE TABLE IF NOT EXISTS activity_logs (
                id         TEXT    PRIMARY KEY,
                type       TEXT    NOT NULL,
                message    TEXT    NOT NULL,
                detail     TEXT,
                timestamp  INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_al_time ON activity_logs(timestamp);

            CREATE TABLE IF NOT EXISTS open_positions (
                token_address   TEXT    PRIMARY KEY,
                token_symbol    TEXT    NOT NULL DEFAULT '',
                amount_in_wei   TEXT    NOT NULL,
                amount_out_wei  TEXT    NOT NULL,
                entry_price_eth REAL    NOT NULL,
                opened_at       INTEGER NOT NULL,
                tx_hash         TEXT    NOT NULL,
                peak_value_eth  REAL    NOT NULL DEFAULT 0,
                tp1_hit         INTEGER NOT NULL DEFAULT 0,
                tp2_hit         INTEGER NOT NULL DEFAULT 0,
                tp3_hit         INTEGER NOT NULL DEFAULT 0,
                tp1_sold_pct    REAL    NOT NULL DEFAULT 0,
                tp2_sold_pct    REAL    NOT NULL DEFAULT 0,
                dca_done        INTEGER NOT NULL DEFAULT 0,
                source_wallet   TEXT,
                init_liq_usd    REAL    NOT NULL DEFAULT 0
            );
        `);
        _db.run(`
            CREATE TABLE IF NOT EXISTS paper_positions (
                token_address   TEXT    PRIMARY KEY,
                token_symbol    TEXT    NOT NULL DEFAULT '',
                entry_price_usd REAL    NOT NULL,
                entry_price_eth REAL    NOT NULL DEFAULT 0,
                virtual_eth_in  REAL    NOT NULL,
                tokens_bought   REAL    NOT NULL DEFAULT 0,
                remaining_pct   REAL    NOT NULL DEFAULT 100,
                opened_at       INTEGER NOT NULL,
                peak_price_usd  REAL    NOT NULL DEFAULT 0,
                tp1_hit         INTEGER NOT NULL DEFAULT 0,
                tp2_hit         INTEGER NOT NULL DEFAULT 0,
                source          TEXT    NOT NULL DEFAULT 'screener',
                dex_url         TEXT    NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS paper_trades (
                id              TEXT    PRIMARY KEY,
                token_address   TEXT    NOT NULL,
                token_symbol    TEXT    NOT NULL,
                entry_price_usd REAL    NOT NULL,
                exit_price_usd  REAL    NOT NULL,
                virtual_eth_in  REAL    NOT NULL,
                virtual_eth_out REAL    NOT NULL,
                profit_pct      REAL    NOT NULL,
                profit_eth      REAL    NOT NULL,
                hold_ms         INTEGER NOT NULL,
                closed_at       INTEGER NOT NULL,
                reason          TEXT    NOT NULL,
                tp_level        INTEGER,
                source          TEXT    NOT NULL DEFAULT 'screener',
                dex_url         TEXT    NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_pt_closed ON paper_trades(closed_at);

            CREATE TABLE IF NOT EXISTS paper_config (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);
        // Migration: add data_source column if it doesn't exist yet
        const cols = runQuery('PRAGMA table_info(monitored_wallets)').map((c) => c.name);
        if (!cols.includes('data_source')) {
            _db.run("ALTER TABLE monitored_wallets ADD COLUMN data_source TEXT NOT NULL DEFAULT 'gecko'");
        }
        // Migration: add remaining_pct to paper_positions if missing
        try {
            const ppCols = runQuery('PRAGMA table_info(paper_positions)').map((c) => c.name);
            if (!ppCols.includes('remaining_pct')) {
                _db.run("ALTER TABLE paper_positions ADD COLUMN remaining_pct REAL NOT NULL DEFAULT 100");
            }
        }
        catch { /* table may not exist yet on first run */ }
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
// ── App Settings (persisted runtime config) ────────────────────────────────────
function dbSaveSettings(key, value) {
    runExec(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, [key, JSON.stringify(value), Date.now()]);
}
function dbLoadSettings(key) {
    const row = runGet('SELECT value FROM app_settings WHERE key = ?', [key]);
    if (!row)
        return null;
    try {
        return JSON.parse(row.value);
    }
    catch {
        return null;
    }
}
function dbSaveRuntimeConfig(config) {
    dbSaveSettings('runtime_config', config);
}
function dbLoadRuntimeConfig() {
    return dbLoadSettings('runtime_config');
}
function dbSaveScreenerConfig(config) {
    dbSaveSettings('screener_config', config);
}
function dbLoadScreenerConfig() {
    return dbLoadSettings('screener_config');
}
function dbSaveScreenerSignal(s) {
    try {
        runExec(`
            INSERT INTO screener_signal_history
                (token_addr, symbol, signal, score_total, liq_usd, vol_h24, price_chg_h1, buy_tx_h1, age_minutes, dex_url, source, discovered_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [s.tokenAddr, s.symbol, s.signal, s.scoreTotal, s.liqUsd, s.volH24, s.priceChgH1, s.buyTxH1, s.ageMinutes, s.dexUrl, s.source, s.discoveredAt]);
        // Cap at 500 most recent rows
        runExec(`DELETE FROM screener_signal_history WHERE id NOT IN (SELECT id FROM screener_signal_history ORDER BY discovered_at DESC LIMIT 500)`);
    }
    catch { /* non-critical — DB may not be ready yet */ }
}
function dbGetScreenerHistory(limit = 100, signal) {
    const where = signal ? 'WHERE signal = ?' : '';
    const params = signal ? [signal, limit] : [limit];
    return runQuery(`SELECT * FROM screener_signal_history ${where} ORDER BY discovered_at DESC LIMIT ?`, params).map(r => ({
        id: r.id,
        tokenAddr: r.token_addr,
        symbol: r.symbol,
        signal: r.signal,
        scoreTotal: r.score_total,
        liqUsd: r.liq_usd,
        volH24: r.vol_h24,
        priceChgH1: r.price_chg_h1,
        buyTxH1: r.buy_tx_h1,
        ageMinutes: r.age_minutes,
        dexUrl: r.dex_url,
        source: r.source,
        discoveredAt: r.discovered_at,
    }));
}
function dbSaveOpenPosition(p) {
    try {
        runExec(`
            INSERT INTO open_positions
                (token_address, token_symbol, amount_in_wei, amount_out_wei, entry_price_eth,
                 opened_at, tx_hash, peak_value_eth, tp1_hit, tp2_hit, tp3_hit,
                 tp1_sold_pct, tp2_sold_pct, dca_done, source_wallet, init_liq_usd)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(token_address) DO UPDATE SET
                token_symbol    = excluded.token_symbol,
                amount_in_wei   = excluded.amount_in_wei,
                amount_out_wei  = excluded.amount_out_wei,
                entry_price_eth = excluded.entry_price_eth,
                opened_at       = excluded.opened_at,
                tx_hash         = excluded.tx_hash,
                peak_value_eth  = excluded.peak_value_eth,
                tp1_hit         = excluded.tp1_hit,
                tp2_hit         = excluded.tp2_hit,
                tp3_hit         = excluded.tp3_hit,
                tp1_sold_pct    = excluded.tp1_sold_pct,
                tp2_sold_pct    = excluded.tp2_sold_pct,
                dca_done        = excluded.dca_done,
                source_wallet   = excluded.source_wallet,
                init_liq_usd    = excluded.init_liq_usd
        `, [
            p.tokenAddress.toLowerCase(), p.tokenSymbol,
            p.amountInWei, p.amountOutWei, p.entryPriceEth,
            p.openedAt, p.txHash, p.peakValueEth,
            p.tp1Hit ? 1 : 0, p.tp2Hit ? 1 : 0, p.tp3Hit ? 1 : 0,
            p.tp1SoldPct, p.tp2SoldPct, p.dcaDone ? 1 : 0,
            p.sourceWallet ?? null, p.initLiqUsd,
        ]);
    }
    catch { /* non-critical */ }
}
function dbDeleteOpenPosition(tokenAddress) {
    try {
        runExec('DELETE FROM open_positions WHERE token_address = ?', [tokenAddress.toLowerCase()]);
    }
    catch { /* non-critical */ }
}
function dbLoadOpenPositions() {
    try {
        return runQuery('SELECT * FROM open_positions').map(r => ({
            tokenAddress: r.token_address,
            tokenSymbol: r.token_symbol,
            amountInWei: r.amount_in_wei,
            amountOutWei: r.amount_out_wei,
            entryPriceEth: r.entry_price_eth,
            openedAt: r.opened_at,
            txHash: r.tx_hash,
            peakValueEth: r.peak_value_eth,
            tp1Hit: !!r.tp1_hit,
            tp2Hit: !!r.tp2_hit,
            tp3Hit: !!r.tp3_hit,
            tp1SoldPct: r.tp1_sold_pct,
            tp2SoldPct: r.tp2_sold_pct,
            dcaDone: !!r.dca_done,
            sourceWallet: r.source_wallet ?? undefined,
            initLiqUsd: r.init_liq_usd,
        }));
    }
    catch {
        return [];
    }
}
function dbInsertActivityLog(entry) {
    try {
        runExec(`
            INSERT OR IGNORE INTO activity_logs (id, type, message, detail, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `, [entry.id, entry.type, entry.message, entry.detail ?? null, entry.timestamp]);
        // Keep only the latest 500 entries
        runExec(`DELETE FROM activity_logs WHERE id NOT IN (SELECT id FROM activity_logs ORDER BY timestamp DESC LIMIT 500)`);
    }
    catch { /* non-critical */ }
}
function dbGetRecentActivityLogs(limit = 200) {
    try {
        return runQuery('SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT ?', [limit]).map(r => ({
            id: r.id,
            type: r.type,
            message: r.message,
            detail: r.detail ?? undefined,
            timestamp: r.timestamp,
        }));
    }
    catch {
        return [];
    }
}
function rowToPaperPosition(r) {
    return {
        tokenAddress: r.token_address,
        tokenSymbol: r.token_symbol,
        entryPriceUsd: r.entry_price_usd,
        entryPriceEth: r.entry_price_eth,
        virtualEthIn: r.virtual_eth_in,
        tokensBought: r.tokens_bought,
        remainingPct: r.remaining_pct ?? 100,
        openedAt: r.opened_at,
        peakPriceUsd: r.peak_price_usd,
        tp1Hit: !!r.tp1_hit,
        tp2Hit: !!r.tp2_hit,
        source: r.source,
        dexUrl: r.dex_url,
    };
}
function rowToPaperTrade(r) {
    return {
        id: r.id,
        tokenAddress: r.token_address,
        tokenSymbol: r.token_symbol,
        entryPriceUsd: r.entry_price_usd,
        exitPriceUsd: r.exit_price_usd,
        virtualEthIn: r.virtual_eth_in,
        virtualEthOut: r.virtual_eth_out,
        profitPct: r.profit_pct,
        profitEth: r.profit_eth,
        holdMs: r.hold_ms,
        closedAt: r.closed_at,
        reason: r.reason,
        tpLevel: r.tp_level ?? undefined,
        source: r.source,
        dexUrl: r.dex_url,
    };
}
function dbSavePaperPosition(p) {
    try {
        runExec(`
            INSERT INTO paper_positions
                (token_address, token_symbol, entry_price_usd, entry_price_eth, virtual_eth_in,
                 tokens_bought, remaining_pct, opened_at, peak_price_usd, tp1_hit, tp2_hit, source, dex_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(token_address) DO UPDATE SET
                token_symbol    = excluded.token_symbol,
                entry_price_usd = excluded.entry_price_usd,
                entry_price_eth = excluded.entry_price_eth,
                virtual_eth_in  = excluded.virtual_eth_in,
                tokens_bought   = excluded.tokens_bought,
                remaining_pct   = excluded.remaining_pct,
                peak_price_usd  = excluded.peak_price_usd,
                tp1_hit         = excluded.tp1_hit,
                tp2_hit         = excluded.tp2_hit,
                source          = excluded.source,
                dex_url         = excluded.dex_url
        `, [
            p.tokenAddress.toLowerCase(), p.tokenSymbol, p.entryPriceUsd, p.entryPriceEth,
            p.virtualEthIn, p.tokensBought, p.remainingPct, p.openedAt,
            p.peakPriceUsd, p.tp1Hit ? 1 : 0, p.tp2Hit ? 1 : 0, p.source, p.dexUrl,
        ]);
    }
    catch { /* non-critical */ }
}
function dbDeletePaperPosition(tokenAddress) {
    try {
        runExec('DELETE FROM paper_positions WHERE token_address = ?', [tokenAddress.toLowerCase()]);
    }
    catch { /* non-critical */ }
}
function dbGetPaperPositions() {
    try {
        return runQuery('SELECT * FROM paper_positions ORDER BY opened_at DESC').map(rowToPaperPosition);
    }
    catch {
        return [];
    }
}
function dbInsertPaperTrade(t) {
    try {
        runExec(`
            INSERT OR IGNORE INTO paper_trades
                (id, token_address, token_symbol, entry_price_usd, exit_price_usd,
                 virtual_eth_in, virtual_eth_out, profit_pct, profit_eth,
                 hold_ms, closed_at, reason, tp_level, source, dex_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            t.id, t.tokenAddress, t.tokenSymbol, t.entryPriceUsd, t.exitPriceUsd,
            t.virtualEthIn, t.virtualEthOut, t.profitPct, t.profitEth,
            t.holdMs, t.closedAt, t.reason, t.tpLevel ?? null, t.source, t.dexUrl,
        ]);
        // Cap at 1000 most recent
        runExec(`DELETE FROM paper_trades WHERE id NOT IN (SELECT id FROM paper_trades ORDER BY closed_at DESC LIMIT 1000)`);
    }
    catch { /* non-critical */ }
}
function dbGetPaperTrades(limit = 200) {
    try {
        return runQuery('SELECT * FROM paper_trades ORDER BY closed_at DESC LIMIT ?', [limit]).map(rowToPaperTrade);
    }
    catch {
        return [];
    }
}
function dbResetPaperTrading() {
    try {
        runExec('DELETE FROM paper_positions');
        runExec('DELETE FROM paper_trades');
        runExec("DELETE FROM paper_config WHERE key = 'virtual_balance'");
        scheduleSave();
    }
    catch { /* non-critical */ }
}
function dbGetPaperConfig(key) {
    try {
        const row = runGet('SELECT value FROM paper_config WHERE key = ?', [key]);
        return row?.value ?? null;
    }
    catch {
        return null;
    }
}
function dbSetPaperConfig(key, value) {
    try {
        runExec(`
            INSERT INTO paper_config (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `, [key, value]);
    }
    catch { /* non-critical */ }
}
exports.default = { initDb };
//# sourceMappingURL=db.js.map