"use strict";
/**
 * token-safety.ts — Full Token Safety Checker
 * Menggunakan GoPlus Labs + Honeypot.is untuk analisis risiko token
 * Chain: Base (chainId 8453)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkTokenSafety = checkTokenSafety;
exports.clearSafetyCache = clearSafetyCache;
const axios_1 = __importDefault(require("axios"));
const GOPLUS_BASE = 'https://api.gopluslabs.io/api/v1/token_security/8453';
const HONEYPOT_BASE = 'https://api.honeypot.is/v2/IsHoneypot';
const safetyCache = new Map();
const CACHE_TTL_MS = 5 * 60000; // 5 menit
async function checkTokenSafety(tokenAddress) {
    const addr = tokenAddress.toLowerCase();
    const cached = safetyCache.get(addr);
    if (cached && cached.expiresAt > Date.now())
        return cached.result;
    const flags = [];
    let score = 100;
    const details = {
        isHoneypot: false,
        buyTax: 0,
        sellTax: 0,
        hasMintFunction: false,
        ownershipRenounced: false,
        ownerBalance: 0,
        isProxy: false,
        tradingCooldown: false,
        cannotSell: false,
        cannotBuy: false,
        liquidityLocked: false,
        topHolderConcentration: 0,
        honeypotIs: undefined,
    };
    // ── GoPlus Labs check (primary) ──────────────────────────────────────────
    try {
        const res = await axios_1.default.get(`${GOPLUS_BASE}?contract_addresses=${tokenAddress}`, {
            timeout: 8000,
            headers: { 'User-Agent': 'BaseSniper/1.0' },
        });
        const d = res.data?.result?.[addr];
        if (d) {
            details.isHoneypot = d.is_honeypot === '1';
            details.buyTax = parseFloat(d.buy_tax || '0');
            details.sellTax = parseFloat(d.sell_tax || '0');
            details.hasMintFunction = d.is_mintable === '1';
            details.ownershipRenounced = d.owner_address === '0x0000000000000000000000000000000000000000' ||
                d.is_renounced === '1';
            details.isProxy = d.is_proxy === '1';
            details.tradingCooldown = d.trading_cooldown === '1';
            details.cannotSell = d.cannot_sell_all === '1' || details.isHoneypot;
            details.cannotBuy = d.cannot_buy === '1';
            details.liquidityLocked = d.lp_is_locked === '1';
            // Owner balance: sum all lp holders named as "owner"
            const ownerPct = parseFloat(d.owner_percent || '0') * 100;
            details.ownerBalance = ownerPct;
            // Top holder concentration
            const holders = d.holders ?? [];
            const top10Pct = holders
                .slice(0, 10)
                .reduce((s, h) => s + parseFloat(h.percent || '0'), 0) * 100;
            details.topHolderConcentration = top10Pct;
            // ── Score deductions ──
            if (details.isHoneypot) {
                flags.push('🚨 HONEYPOT terdeteksi');
                score -= 100;
            }
            if (details.cannotSell) {
                flags.push('🚨 Tidak bisa dijual');
                score -= 80;
            }
            if (details.cannotBuy) {
                flags.push('🚨 Tidak bisa dibeli');
                score -= 80;
            }
            if (details.buyTax > 25) {
                flags.push(`⚠️ Buy tax tinggi: ${details.buyTax}%`);
                score -= 30;
            }
            else if (details.buyTax > 10) {
                flags.push(`⚠️ Buy tax: ${details.buyTax}%`);
                score -= 15;
            }
            if (details.sellTax > 25) {
                flags.push(`⚠️ Sell tax tinggi: ${details.sellTax}%`);
                score -= 35;
            }
            else if (details.sellTax > 10) {
                flags.push(`⚠️ Sell tax: ${details.sellTax}%`);
                score -= 20;
            }
            if (details.hasMintFunction && !details.ownershipRenounced) {
                flags.push('⚠️ Fungsi MINT aktif + owner belum renounce');
                score -= 25;
            }
            if (details.ownerBalance > 20) {
                flags.push(`⚠️ Owner pegang ${details.ownerBalance.toFixed(1)}% supply`);
                score -= 20;
            }
            else if (details.ownerBalance > 10) {
                score -= 10;
            }
            if (!details.ownershipRenounced) {
                score -= 5;
            }
            if (details.isProxy) {
                flags.push('⚠️ Kontrak proxy (owner bisa ganti kode)');
                score -= 15;
            }
            if (details.tradingCooldown) {
                flags.push('⚠️ Trading cooldown aktif');
                score -= 10;
            }
            if (details.topHolderConcentration > 80) {
                flags.push(`⚠️ Top 10 holder pegang ${details.topHolderConcentration.toFixed(0)}% supply`);
                score -= 15;
            }
            if (!details.liquidityLocked) {
                score -= 5;
            }
        }
    }
    catch { /* GoPlus not available — continue with Honeypot.is */ }
    // ── Honeypot.is check (secondary) ────────────────────────────────────────
    try {
        const res = await axios_1.default.get(`${HONEYPOT_BASE}?address=${tokenAddress}&chainID=8453`, {
            timeout: 6000,
        });
        const hp = res.data;
        if (hp) {
            const isHp = hp.honeypotResult?.isHoneypot === true;
            details.honeypotIs = isHp;
            if (isHp && !details.isHoneypot) {
                details.isHoneypot = true;
                flags.push('🚨 HONEYPOT (Honeypot.is)');
                score -= 80;
            }
            // Crosscheck taxes
            const buyTax2 = hp.simulationResult?.buyTax ?? 0;
            const sellTax2 = hp.simulationResult?.sellTax ?? 0;
            if (buyTax2 > details.buyTax)
                details.buyTax = buyTax2;
            if (sellTax2 > details.sellTax)
                details.sellTax = sellTax2;
        }
    }
    catch { /* Honeypot.is not available */ }
    score = Math.max(0, Math.min(100, score));
    // Hard fail conditions
    const hardFail = details.isHoneypot || details.cannotSell || details.cannotBuy || score < 20;
    const report = {
        tokenAddress,
        safe: !hardFail && score >= 55,
        score,
        flags: flags.length > 0 ? flags : ['✅ Tidak ada tanda bahaya terdeteksi'],
        details,
        checkedAt: Date.now(),
    };
    safetyCache.set(addr, { result: report, expiresAt: Date.now() + CACHE_TTL_MS });
    return report;
}
function clearSafetyCache(tokenAddress) {
    if (tokenAddress)
        safetyCache.delete(tokenAddress.toLowerCase());
    else
        safetyCache.clear();
}
exports.default = { checkTokenSafety, clearSafetyCache };
//# sourceMappingURL=token-safety.js.map