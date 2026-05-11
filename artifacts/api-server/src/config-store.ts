/**
 * config-store.ts
 *
 * Persistent configuration manager with two layers:
 *
 *  1. trading-config.json  — committed to git, survives redeployments.
 *     Stores all non-secret trading settings (TP/SL, copy amounts, flags).
 *     Changes made via the UI are saved here immediately.
 *
 *  2. .runtime-keys.json   — gitignored, survives server restarts but NOT
 *     redeployments. Stores Telegram token/chatId and AI API keys that the
 *     user sets through the UI.  PRIVATE_KEY is NEVER stored here — it must
 *     be a Replit Secret.
 *
 * Priority order (highest wins):
 *   SQLite (runtime overrides) > trading-config.json > env vars
 */

import fs from 'fs';
import path from 'path';

const ROOT         = path.resolve(__dirname, '..');
const CONFIG_PATH  = path.join(ROOT, 'trading-config.json');
const KEYS_PATH    = path.join(ROOT, '.runtime-keys.json');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJson(filePath: string): Record<string, any> {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch (e: any) {
        console.warn(`[ConfigStore] Could not read ${filePath}: ${e?.message}`);
    }
    return {};
}

function writeJson(filePath: string, data: Record<string, any>): void {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e: any) {
        console.warn(`[ConfigStore] Could not write ${filePath}: ${e?.message}`);
    }
}

// ─── Trading Config (committed, non-secret) ───────────────────────────────────

export function loadTradingConfig(): Record<string, any> {
    return readJson(CONFIG_PATH);
}

export function saveTradingConfig(config: Record<string, any>): void {
    const existing = readJson(CONFIG_PATH);
    writeJson(CONFIG_PATH, { ...existing, ...config });
    console.log(`[ConfigStore] ✅ Saved trading config → ${CONFIG_PATH}`);
}

// ─── Runtime Keys (gitignored, non-PRIVATE_KEY secrets) ──────────────────────

export interface RuntimeKeys {
    groqKey?:        string;
    geminiKey?:      string;
    huggingfaceKey?: string;
    telegramToken?:  string;
    telegramChatId?: string;
}

export function loadRuntimeKeys(): RuntimeKeys {
    return readJson(KEYS_PATH) as RuntimeKeys;
}

export function saveRuntimeKeys(keys: Partial<RuntimeKeys>): void {
    const existing = readJson(KEYS_PATH);
    const merged: Record<string, any> = { ...existing, ...keys };
    // Remove any empty strings
    for (const k of Object.keys(merged)) {
        if (merged[k] === '') delete merged[k];
    }
    writeJson(KEYS_PATH, merged);
}

// Apply saved keys to process.env so the rest of the app can read them
export function applyRuntimeKeys(): RuntimeKeys {
    const keys = loadRuntimeKeys();
    if (keys.groqKey)        process.env.GROQ_API_KEY        = keys.groqKey;
    if (keys.geminiKey)      process.env.GEMINI_API_KEY      = keys.geminiKey;
    if (keys.huggingfaceKey) process.env.HUGGINGFACE_API_KEY = keys.huggingfaceKey;
    if (keys.telegramToken)  process.env.TELEGRAM_BOT_TOKEN  = keys.telegramToken;
    if (keys.telegramChatId) process.env.TELEGRAM_CHAT_ID    = keys.telegramChatId;

    const loaded = Object.keys(keys).filter(k => !!(keys as any)[k]);
    if (loaded.length > 0) {
        console.log(`[ConfigStore] ✅ Applied runtime keys: ${loaded.join(', ')}`);
    }
    return keys;
}
