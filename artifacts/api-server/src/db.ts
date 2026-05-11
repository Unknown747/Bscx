/**
 * db.ts — SQLite persistent storage for Base Sniper
 * Uses sql.js (pure JS, no native build tools required)
 *
 * Tables: trade_history, blacklist, screener_signal_history, activity_logs, open_positions, app_settings, push_subscriptions
 */

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';

// DB_PATH can be overridden via environment variable for VPS deployments.
// Default: artifacts/base-sniper/base.db (relative to compiled dist/)
const DB_PATH = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.resolve(__dirname, '../../base-sniper/base.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let _db: SqlJsDatabase | null = null;
let _initPromise: Promise<void> | null = null;

function getDb(): SqlJsDatabase {
    if (!_db) throw new Error('Database not initialized. Call initDb() first.');
    return _db;
}

function saveDb(): void {
    if (!_db) return;
    const data = _db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}

let saveTimer: NodeJS.Timeout | null = null;
function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveDb(); saveTimer = null; }, 5000);
}

export async function initDb(): Promise<void> {
    if (_db) return;
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
        const SQL = await initSqlJs();
        if (fs.existsSync(DB_PATH)) {
            const fileBuffer = fs.readFileSync(DB_PATH);
            _db = new SQL.Database(fileBuffer);
        } else {
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
        const cols = runQuery<{name: string}>('PRAGMA table_info(monitored_wallets)').map((c: any) => c.name);
        if (!cols.includes('data_source')) {
            _db!.run("ALTER TABLE monitored_wallets ADD COLUMN data_source TEXT NOT NULL DEFAULT 'gecko'");
        }

        // Migration: add remaining_pct to paper_positions if missing
        try {
            const ppCols = runQuery<{name: string}>('PRAGMA table_info(paper_positions)').map((c: any) => c.name);
            if (!ppCols.includes('remaining_pct')) {
                _db!.run("ALTER TABLE paper_positions ADD COLUMN remaining_pct REAL NOT NULL DEFAULT 100");
            }
        } catch { /* table may not exist yet on first run */ }

        saveDb();
        console.log(`💾 SQLite DB ready: ${DB_PATH}`);
    })();

    return _initPromise;
}

// ── Query helpers ──────────────────────────────────────────────────────────────

function runQuery<T = any>(sql: string, params: any[] = []): T[] {
    const db = getDb();
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject() as unknown as T);
    }
    stmt.free();
    return rows;
}

function runGet<T = any>(sql: string, params: any[] = []): T | undefined {
    const rows = runQuery<T>(sql, params);
    return rows[0];
}

function runExec(sql: string, params: any[] = []): void {
    const db = getDb();
    const stmt = db.prepare(sql);
    stmt.run(params);
    stmt.free();
    scheduleSave();
}

// ── Trade history ─────────────────────────────────────────────────────────────

export interface TradeRow {
    id:           string;
    tokenAddress: string;
    tokenSymbol:  string;
    entryEth:     number;
    profitPct:    number | null;
    percentSold:  number;
    closedAt:     number;
    holdMs:       number;
    txHash:       string;
    reason:       string;
    tpLevel?:     number;
}

export function dbInsertTrade(t: TradeRow): void {
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

export function dbGetTrades(limit = 200): TradeRow[] {
    return runQuery('SELECT * FROM trade_history ORDER BY closed_at DESC LIMIT ?', [limit]).map(row => ({
        id:           row.id,
        tokenAddress: row.token_address,
        tokenSymbol:  row.token_symbol,
        entryEth:     row.entry_eth,
        profitPct:    row.profit_pct,
        percentSold:  row.percent_sold,
        closedAt:     row.closed_at,
        holdMs:       row.hold_ms,
        txHash:       row.tx_hash,
        reason:       row.reason,
        tpLevel:      row.tp_level ?? undefined,
    }));
}

// ── Blacklist ─────────────────────────────────────────────────────────────────

export function dbAddToBlacklist(address: string, label?: string): void {
    runExec(`
        INSERT OR IGNORE INTO blacklist (address, label, added_at) VALUES (?, ?, ?)
    `, [address.toLowerCase(), label ?? null, Date.now()]);
}

export function dbRemoveFromBlacklist(address: string): void {
    runExec('DELETE FROM blacklist WHERE address = ?', [address.toLowerCase()]);
}

export function dbGetBlacklist(): { address: string; label?: string; addedAt: number }[] {
    return runQuery('SELECT * FROM blacklist ORDER BY added_at DESC').map(row => ({
        address: row.address,
        label:   row.label ?? undefined,
        addedAt: row.added_at,
    }));
}

export function dbIsBlacklisted(address: string): boolean {
    return !!runGet('SELECT 1 FROM blacklist WHERE address = ?', [address.toLowerCase()]);
}

// ── Push Subscriptions ────────────────────────────────────────────────────────

export function dbGetPushSubscriptions(): string[] {
    return runQuery('SELECT data FROM push_subscriptions').map(r => r.data);
}

export function dbSavePushSubscription(data: string): void {
    let endpoint = '';
    try { endpoint = JSON.parse(data).endpoint || ''; } catch { return; }
    if (!endpoint) return;
    runExec(`
        INSERT INTO push_subscriptions (endpoint, data, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET data = excluded.data
    `, [endpoint, data, Date.now()]);
}

export function dbDeletePushSubscription(endpoint: string): void {
    runExec('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
}

export function dbGetPushSubscriptionCount(): number {
    const row = runGet<{cnt: number}>('SELECT COUNT(*) as cnt FROM push_subscriptions');
    return row?.cnt ?? 0;
}

// ── App Settings (persisted runtime config) ────────────────────────────────────

export function dbSaveSettings(key: string, value: object | string | number | boolean): void {
    runExec(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, JSON.stringify(value), Date.now()]
    );
}

export function dbLoadSettings(key: string): any | null {
    const row = runGet<{value: string}>('SELECT value FROM app_settings WHERE key = ?', [key]);
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return null; }
}

export function dbSaveRuntimeConfig(config: object): void {
    dbSaveSettings('runtime_config', config);
}

export function dbLoadRuntimeConfig(): any | null {
    return dbLoadSettings('runtime_config');
}

export function dbSaveScreenerConfig(config: object): void {
    dbSaveSettings('screener_config', config);
}

export function dbLoadScreenerConfig(): any | null {
    return dbLoadSettings('screener_config');
}

// ── Screener Signal History ────────────────────────────────────────────────────

export interface ScreenerSignalHistoryRow {
    id:           number;
    tokenAddr:    string;
    symbol:       string;
    signal:       string;
    scoreTotal:   number;
    liqUsd:       number;
    volH24:       number;
    priceChgH1:   number;
    buyTxH1:      number;
    ageMinutes:   number;
    dexUrl:       string;
    source:       string;
    discoveredAt: number;
}

export function dbSaveScreenerSignal(s: Omit<ScreenerSignalHistoryRow, 'id'>): void {
    try {
        runExec(`
            INSERT INTO screener_signal_history
                (token_addr, symbol, signal, score_total, liq_usd, vol_h24, price_chg_h1, buy_tx_h1, age_minutes, dex_url, source, discovered_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [s.tokenAddr, s.symbol, s.signal, s.scoreTotal, s.liqUsd, s.volH24, s.priceChgH1, s.buyTxH1, s.ageMinutes, s.dexUrl, s.source, s.discoveredAt]);
        // Cap at 500 most recent rows
        runExec(`DELETE FROM screener_signal_history WHERE id NOT IN (SELECT id FROM screener_signal_history ORDER BY discovered_at DESC LIMIT 500)`);
    } catch { /* non-critical — DB may not be ready yet */ }
}

export function dbGetScreenerHistory(limit = 100, signal?: string): ScreenerSignalHistoryRow[] {
    const where  = signal ? 'WHERE signal = ?' : '';
    const params = signal ? [signal, limit] : [limit];
    return runQuery(`SELECT * FROM screener_signal_history ${where} ORDER BY discovered_at DESC LIMIT ?`, params).map(r => ({
        id:           r.id,
        tokenAddr:    r.token_addr,
        symbol:       r.symbol,
        signal:       r.signal,
        scoreTotal:   r.score_total,
        liqUsd:       r.liq_usd,
        volH24:       r.vol_h24,
        priceChgH1:   r.price_chg_h1,
        buyTxH1:      r.buy_tx_h1,
        ageMinutes:   r.age_minutes,
        dexUrl:       r.dex_url,
        source:       r.source,
        discoveredAt: r.discovered_at,
    }));
}

// ── Open Positions (persist across restarts) ──────────────────────────────────

export interface OpenPositionRow {
    tokenAddress:    string;
    tokenSymbol:     string;
    amountInWei:     string;
    amountOutWei:    string;
    entryPriceEth:   number;
    openedAt:        number;
    txHash:          string;
    peakValueEth:    number;
    tp1Hit:          boolean;
    tp2Hit:          boolean;
    tp3Hit:          boolean;
    tp1SoldPct:      number;
    tp2SoldPct:      number;
    dcaDone:         boolean;
    sourceWallet?:   string;
    initLiqUsd:      number;
}

export function dbSaveOpenPosition(p: OpenPositionRow): void {
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
    } catch { /* non-critical */ }
}

export function dbDeleteOpenPosition(tokenAddress: string): void {
    try {
        runExec('DELETE FROM open_positions WHERE token_address = ?', [tokenAddress.toLowerCase()]);
    } catch { /* non-critical */ }
}

export function dbLoadOpenPositions(): OpenPositionRow[] {
    try {
        return runQuery('SELECT * FROM open_positions').map(r => ({
            tokenAddress:  r.token_address,
            tokenSymbol:   r.token_symbol,
            amountInWei:   r.amount_in_wei,
            amountOutWei:  r.amount_out_wei,
            entryPriceEth: r.entry_price_eth,
            openedAt:      r.opened_at,
            txHash:        r.tx_hash,
            peakValueEth:  r.peak_value_eth,
            tp1Hit:        !!r.tp1_hit,
            tp2Hit:        !!r.tp2_hit,
            tp3Hit:        !!r.tp3_hit,
            tp1SoldPct:    r.tp1_sold_pct,
            tp2SoldPct:    r.tp2_sold_pct,
            dcaDone:       !!r.dca_done,
            sourceWallet:  r.source_wallet ?? undefined,
            initLiqUsd:    r.init_liq_usd,
        }));
    } catch { return []; }
}

// ── Activity Logs (persist across restarts) ───────────────────────────────────

export interface ActivityLogRow {
    id:        string;
    type:      string;
    message:   string;
    detail?:   string;
    timestamp: number;
}

export function dbInsertActivityLog(entry: ActivityLogRow): void {
    try {
        runExec(`
            INSERT OR IGNORE INTO activity_logs (id, type, message, detail, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `, [entry.id, entry.type, entry.message, entry.detail ?? null, entry.timestamp]);
        // Keep only the latest 500 entries
        runExec(`DELETE FROM activity_logs WHERE id NOT IN (SELECT id FROM activity_logs ORDER BY timestamp DESC LIMIT 500)`);
    } catch { /* non-critical */ }
}

export function dbGetRecentActivityLogs(limit = 200): ActivityLogRow[] {
    try {
        return runQuery('SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT ?', [limit]).map(r => ({
            id:        r.id,
            type:      r.type,
            message:   r.message,
            detail:    r.detail ?? undefined,
            timestamp: r.timestamp,
        }));
    } catch { return []; }
}

// ── Paper Trading ─────────────────────────────────────────────────────────────

export interface PaperPositionRow {
    tokenAddress:  string;
    tokenSymbol:   string;
    entryPriceUsd: number;
    entryPriceEth: number;
    virtualEthIn:  number;
    tokensBought:  number;
    remainingPct:  number;
    openedAt:      number;
    peakPriceUsd:  number;
    tp1Hit:        boolean;
    tp2Hit:        boolean;
    source:        string;
    dexUrl:        string;
}

export interface PaperTradeRow {
    id:            string;
    tokenAddress:  string;
    tokenSymbol:   string;
    entryPriceUsd: number;
    exitPriceUsd:  number;
    virtualEthIn:  number;
    virtualEthOut: number;
    profitPct:     number;
    profitEth:     number;
    holdMs:        number;
    closedAt:      number;
    reason:        string;
    tpLevel?:      number;
    source:        string;
    dexUrl:        string;
}

function rowToPaperPosition(r: any): PaperPositionRow {
    return {
        tokenAddress:  r.token_address,
        tokenSymbol:   r.token_symbol,
        entryPriceUsd: r.entry_price_usd,
        entryPriceEth: r.entry_price_eth,
        virtualEthIn:  r.virtual_eth_in,
        tokensBought:  r.tokens_bought,
        remainingPct:  r.remaining_pct ?? 100,
        openedAt:      r.opened_at,
        peakPriceUsd:  r.peak_price_usd,
        tp1Hit:        !!r.tp1_hit,
        tp2Hit:        !!r.tp2_hit,
        source:        r.source,
        dexUrl:        r.dex_url,
    };
}

function rowToPaperTrade(r: any): PaperTradeRow {
    return {
        id:            r.id,
        tokenAddress:  r.token_address,
        tokenSymbol:   r.token_symbol,
        entryPriceUsd: r.entry_price_usd,
        exitPriceUsd:  r.exit_price_usd,
        virtualEthIn:  r.virtual_eth_in,
        virtualEthOut: r.virtual_eth_out,
        profitPct:     r.profit_pct,
        profitEth:     r.profit_eth,
        holdMs:        r.hold_ms,
        closedAt:      r.closed_at,
        reason:        r.reason,
        tpLevel:       r.tp_level ?? undefined,
        source:        r.source,
        dexUrl:        r.dex_url,
    };
}

export function dbSavePaperPosition(p: PaperPositionRow): void {
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
    } catch { /* non-critical */ }
}

export function dbDeletePaperPosition(tokenAddress: string): void {
    try {
        runExec('DELETE FROM paper_positions WHERE token_address = ?', [tokenAddress.toLowerCase()]);
    } catch { /* non-critical */ }
}

export function dbGetPaperPositions(): PaperPositionRow[] {
    try {
        return runQuery('SELECT * FROM paper_positions ORDER BY opened_at DESC').map(rowToPaperPosition);
    } catch { return []; }
}

export function dbInsertPaperTrade(t: PaperTradeRow): void {
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
    } catch { /* non-critical */ }
}

export function dbGetPaperTrades(limit = 200): PaperTradeRow[] {
    try {
        return runQuery('SELECT * FROM paper_trades ORDER BY closed_at DESC LIMIT ?', [limit]).map(rowToPaperTrade);
    } catch { return []; }
}

export function dbResetPaperTrading(): void {
    try {
        runExec('DELETE FROM paper_positions');
        runExec('DELETE FROM paper_trades');
        runExec("DELETE FROM paper_config WHERE key = 'virtual_balance'");
        scheduleSave();
    } catch { /* non-critical */ }
}

export function dbGetPaperConfig(key: string): string | null {
    try {
        const row = runGet<{value: string}>('SELECT value FROM paper_config WHERE key = ?', [key]);
        return row?.value ?? null;
    } catch { return null; }
}

export function dbSetPaperConfig(key: string, value: string): void {
    try {
        runExec(`
            INSERT INTO paper_config (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `, [key, value]);
    } catch { /* non-critical */ }
}

export default { initDb };
