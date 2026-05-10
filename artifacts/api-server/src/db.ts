/**
 * db.ts — SQLite persistent storage for Base Sniper
 * Uses sql.js (pure JS, no native build tools required)
 *
 * Tables: whale_candidates, trade_history, blacklist, copy_wallets
 */

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.resolve(__dirname, '../../base-sniper/base.db');
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
        const cols = runQuery<{name: string}>('PRAGMA table_info(monitored_wallets)').map((c: any) => c.name);
        if (!cols.includes('data_source')) {
            _db!.run("ALTER TABLE monitored_wallets ADD COLUMN data_source TEXT NOT NULL DEFAULT 'gecko'");
        }

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

// ── Whale candidates ──────────────────────────────────────────────────────────

export interface WhaleRow {
    address:          string;
    estimatedWinRate: number;
    tradeCount:       number;
    avgProfitPct:     number;
    totalVolumeEth:   number;
    lastActiveMs:     number;
    discoveredAt:     number;
    score:            number;
    tokens:           string[];
    status:           'pending' | 'approved' | 'rejected' | 'monitoring';
    approvedAt?:      number;
}

function rowToWhale(row: any): WhaleRow {
    return {
        address:          row.address,
        estimatedWinRate: row.estimated_win_rate,
        tradeCount:       row.trade_count,
        avgProfitPct:     row.avg_profit_pct,
        totalVolumeEth:   row.total_volume_eth,
        lastActiveMs:     row.last_active_ms,
        discoveredAt:     row.discovered_at,
        score:            row.score,
        tokens:           JSON.parse(row.tokens),
        status:           row.status,
        approvedAt:       row.approved_at ?? undefined,
    };
}

export function dbUpsertWhale(w: WhaleRow): void {
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

export function dbGetWhale(address: string): WhaleRow | null {
    const row = runGet('SELECT * FROM whale_candidates WHERE address = ?', [address.toLowerCase()]);
    return row ? rowToWhale(row) : null;
}

export function dbGetPendingWhales(): WhaleRow[] {
    return runQuery("SELECT * FROM whale_candidates WHERE status = 'pending' ORDER BY score DESC").map(rowToWhale);
}

export function dbGetAllWhales(): WhaleRow[] {
    return runQuery('SELECT * FROM whale_candidates ORDER BY discovered_at DESC').map(rowToWhale);
}

export function dbApproveWhale(address: string): WhaleRow | null {
    const addr = address.toLowerCase();
    runExec("UPDATE whale_candidates SET status = 'approved', approved_at = ? WHERE address = ?",
        [Date.now(), addr]);
    return dbGetWhale(addr);
}

export function dbRejectWhale(address: string): void {
    runExec("UPDATE whale_candidates SET status = 'rejected' WHERE address = ?",
        [address.toLowerCase()]);
}

export function dbWhaleExists(address: string): boolean {
    return !!runGet('SELECT 1 FROM whale_candidates WHERE address = ?', [address.toLowerCase()]);
}

export function dbIsRejected(address: string): boolean {
    return !!runGet("SELECT 1 FROM whale_candidates WHERE address = ? AND status = 'rejected'", [address.toLowerCase()]);
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

// ── Copy wallets ──────────────────────────────────────────────────────────────

export interface CopyWalletRow {
    address:  string;
    name:     string;
    isActive: boolean;
    addedAt:  number;
}

export function dbAddCopyWallet(address: string, name: string): void {
    runExec(`
        INSERT OR IGNORE INTO copy_wallets (address, name, is_active, added_at) VALUES (?, ?, 1, ?)
    `, [address.toLowerCase(), name, Date.now()]);
}

export function dbRemoveCopyWallet(address: string): void {
    runExec('DELETE FROM copy_wallets WHERE address = ?', [address.toLowerCase()]);
}

export function dbGetCopyWallets(): CopyWalletRow[] {
    return runQuery('SELECT * FROM copy_wallets ORDER BY added_at DESC').map(row => ({
        address:  row.address,
        name:     row.name,
        isActive: !!row.is_active,
        addedAt:  row.added_at,
    }));
}

export function dbUpdateCopyWallet(address: string, fields: { name?: string; isActive?: boolean }): void {
    if (fields.name !== undefined) {
        runExec('UPDATE copy_wallets SET name = ? WHERE address = ?', [fields.name, address.toLowerCase()]);
    }
    if (fields.isActive !== undefined) {
        runExec('UPDATE copy_wallets SET is_active = ? WHERE address = ?', [fields.isActive ? 1 : 0, address.toLowerCase()]);
    }
}

// ── Whale Waitlist Events ─────────────────────────────────────────────────────

export interface WaitlistEvent {
    id?:         number;
    address:     string;
    eventType:   string;
    token?:      string;
    profitPct?:  number;
    volumeEth?:  number;
    recordedAt:  number;
}

export function dbInsertWaitlistEvent(e: WaitlistEvent): void {
    runExec(`
        INSERT INTO whale_waitlist_events
            (address, event_type, token, profit_pct, volume_eth, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [e.address.toLowerCase(), e.eventType, e.token ?? null, e.profitPct ?? null, e.volumeEth ?? null, e.recordedAt]);
}

export function dbGetWaitlistEvents(address: string, limit = 50): WaitlistEvent[] {
    return runQuery(`
        SELECT * FROM whale_waitlist_events WHERE address = ? ORDER BY recorded_at DESC LIMIT ?
    `, [address.toLowerCase(), limit]).map(r => ({
        id:         r.id,
        address:    r.address,
        eventType:  r.event_type,
        token:      r.token ?? undefined,
        profitPct:  r.profit_pct ?? undefined,
        volumeEth:  r.volume_eth ?? undefined,
        recordedAt: r.recorded_at,
    }));
}

export function dbGetWaitlistSummary(address: string): {
    totalEvents: number;
    wins: number;
    losses: number;
    avgProfitPct: number;
} {
    const events = dbGetWaitlistEvents(address, 200);
    const trades = events.filter(e => e.profitPct != null);
    const wins   = trades.filter(e => (e.profitPct ?? 0) > 0).length;
    const losses = trades.filter(e => (e.profitPct ?? 0) < 0).length;
    const avg    = trades.length > 0 ? trades.reduce((s, e) => s + (e.profitPct ?? 0), 0) / trades.length : 0;
    return { totalEvents: events.length, wins, losses, avgProfitPct: parseFloat(avg.toFixed(1)) };
}

// ── Whale Candidates — monitoring status ──────────────────────────────────────

export function dbMonitorWhale(address: string): void {
    runExec("UPDATE whale_candidates SET status = 'monitoring' WHERE address = ?",
        [address.toLowerCase()]);
}

// ── Monitored Wallets ──────────────────────────────────────────────────────────

export interface MonitoredWalletRow {
    address:        string;
    name:           string;
    monitoredSince: number;
    tradesObserved: number;
    winsObserved:   number;
    lossesObserved: number;
    totalPnlPct:    number;
    tradesPerDay:   number;
    lastTradeMs:    number;
    aiVerdict:      'pending' | 'approved' | 'rejected';
    aiReason?:      string;
    aiScore?:       number;
    promotedAt?:    number;
    dataSource:     'basescan' | 'gecko';
}

function rowToMonitored(row: any): MonitoredWalletRow {
    return {
        address:        row.address,
        name:           row.name,
        monitoredSince: row.monitored_since,
        tradesObserved: row.trades_observed,
        winsObserved:   row.wins_observed,
        lossesObserved: row.losses_observed,
        totalPnlPct:    row.total_pnl_pct,
        tradesPerDay:   row.trades_per_day,
        lastTradeMs:    row.last_trade_ms,
        aiVerdict:      row.ai_verdict as 'pending' | 'approved' | 'rejected',
        aiReason:       row.ai_reason  ?? undefined,
        aiScore:        row.ai_score   ?? undefined,
        promotedAt:     row.promoted_at ?? undefined,
        dataSource:     (row.data_source ?? 'gecko') as 'basescan' | 'gecko',
    };
}

export function dbAddMonitoredWallet(address: string, name: string): void {
    runExec(`
        INSERT OR IGNORE INTO monitored_wallets
            (address, name, monitored_since, trades_observed, wins_observed,
             losses_observed, total_pnl_pct, trades_per_day, last_trade_ms, ai_verdict)
        VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 'pending')
    `, [address.toLowerCase(), name, Date.now()]);
}

export function dbRemoveMonitoredWallet(address: string): void {
    runExec('DELETE FROM monitored_wallets WHERE address = ?', [address.toLowerCase()]);
}

export function dbGetMonitoredWallets(): MonitoredWalletRow[] {
    return runQuery('SELECT * FROM monitored_wallets ORDER BY monitored_since DESC').map(rowToMonitored);
}

export function dbGetMonitoredWallet(address: string): MonitoredWalletRow | null {
    const row = runGet('SELECT * FROM monitored_wallets WHERE address = ?', [address.toLowerCase()]);
    return row ? rowToMonitored(row) : null;
}

export function dbIsMonitored(address: string): boolean {
    return !!runGet('SELECT 1 FROM monitored_wallets WHERE address = ?', [address.toLowerCase()]);
}

export function dbUpdateMonitoredStats(address: string, stats: {
    tradesObserved?: number;
    winsObserved?:   number;
    lossesObserved?: number;
    totalPnlPct?:    number;
    tradesPerDay?:   number;
    lastTradeMs?:    number;
    dataSource?:     'basescan' | 'gecko';
}): void {
    const sets: string[]  = [];
    const values: any[]   = [];
    if (stats.tradesObserved !== undefined) { sets.push('trades_observed = ?');  values.push(stats.tradesObserved); }
    if (stats.winsObserved   !== undefined) { sets.push('wins_observed = ?');    values.push(stats.winsObserved);   }
    if (stats.lossesObserved !== undefined) { sets.push('losses_observed = ?');  values.push(stats.lossesObserved); }
    if (stats.totalPnlPct    !== undefined) { sets.push('total_pnl_pct = ?');    values.push(stats.totalPnlPct);    }
    if (stats.tradesPerDay   !== undefined) { sets.push('trades_per_day = ?');   values.push(stats.tradesPerDay);   }
    if (stats.lastTradeMs    !== undefined) { sets.push('last_trade_ms = ?');    values.push(stats.lastTradeMs);    }
    if (stats.dataSource     !== undefined) { sets.push('data_source = ?');      values.push(stats.dataSource);     }
    if (sets.length === 0) return;
    values.push(address.toLowerCase());
    runExec(`UPDATE monitored_wallets SET ${sets.join(', ')} WHERE address = ?`, values);
}

export function dbSetMonitoredVerdict(address: string, verdict: 'pending' | 'approved' | 'rejected', score: number, reason: string): void {
    runExec(`
        UPDATE monitored_wallets SET ai_verdict = ?, ai_score = ?, ai_reason = ? WHERE address = ?
    `, [verdict, score, reason, address.toLowerCase()]);
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

export default { initDb };
