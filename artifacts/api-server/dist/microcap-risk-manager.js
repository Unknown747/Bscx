"use strict";
/**
 * microcap-risk-manager.ts
 * Manajemen risiko untuk modal kecil (0.006 ETH)
 * - Daily loss limit, consecutive loss protection, cooldown setelah profit besar
 * - Dynamic position sizing: 12% dari modal aktif
 * - Hard circuit breaker: when daily loss limit is hit, breaker trips until midnight reset
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MicroCapRiskManager = void 0;
const MAX_DAILY_LOSS_ETH = parseFloat(process.env.MAX_DAILY_LOSS_ETH || '0.0015');
const MAX_CONSECUTIVE_LOSSES = parseInt(process.env.MAX_CONSECUTIVE_LOSSES || '3');
const COOLDOWN_AFTER_PROFIT_MS = parseInt(process.env.COOLDOWN_AFTER_BIG_PROFIT_MINUTES || '15') * 60000;
const REINVEST_PERCENT = parseFloat(process.env.REINVEST_PERCENT || '50') / 100;
const MIN_LIQUIDITY_USD = parseFloat(process.env.MIN_LIQUIDITY_USD || '5000');
const MAX_TOKEN_AGE_SECONDS = parseInt(process.env.MAX_TOKEN_AGE_SECONDS || '300');
class MicroCapRiskManager {
    constructor(initialCapital = 0.006) {
        this.todayLossEth = 0;
        this.consecutiveLosses = 0;
        this.cooldownUntil = 0;
        this.tradesBlockedToday = 0;
        this.lastTradeResult = null;
        // ── Hard circuit breaker state ────────────────────────────────────────────
        this.circuitBreakerTripped = false;
        this.circuitBreakerReason = '';
        this.totalCapital = initialCapital;
        this.dailyResetAt = this.nextMidnightUtc();
        this.scheduleDailyReset();
    }
    nextMidnightUtc() {
        const now = new Date();
        const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
        return next.getTime();
    }
    scheduleDailyReset() {
        const msUntilReset = this.dailyResetAt - Date.now();
        setTimeout(() => {
            this.todayLossEth = 0;
            this.tradesBlockedToday = 0;
            this.consecutiveLosses = 0;
            this.circuitBreakerTripped = false;
            this.circuitBreakerReason = '';
            this.dailyResetAt = this.nextMidnightUtc();
            console.log('[RiskManager] ✅ Daily reset — loss counter + circuit breaker cleared');
            this.scheduleDailyReset();
        }, Math.max(msUntilReset, 1000));
    }
    // ── Hard circuit breaker ──────────────────────────────────────────────────
    /**
     * Trip the hard circuit breaker. Once tripped, isCircuitBreakerTripped()
     * returns true and ALL new signals should be rejected at the gate — not
     * just individual executeBuy calls. Resets automatically at midnight.
     */
    tripCircuitBreaker(reason) {
        if (this.circuitBreakerTripped)
            return;
        this.circuitBreakerTripped = true;
        this.circuitBreakerReason = reason;
        console.log(`\n🔴🔴🔴 [CircuitBreaker] HARD STOP TRIPPED: ${reason}`);
        console.log(`[CircuitBreaker] All new signals will be rejected until midnight reset.`);
    }
    isCircuitBreakerTripped() {
        return this.circuitBreakerTripped;
    }
    getCircuitBreakerReason() {
        return this.circuitBreakerReason;
    }
    /** True when daily loss limit has been reached (used for pre-signal checks). */
    isDailyLimitHit() {
        return this.todayLossEth >= MAX_DAILY_LOSS_ETH;
    }
    // ── Gate: called BEFORE each trade ────────────────────────────────────────
    beforeTrade(token = {}) {
        // Hard circuit breaker — highest priority
        if (this.circuitBreakerTripped) {
            this.tradesBlockedToday++;
            return { allowed: false, reason: `🔴 Circuit breaker active: ${this.circuitBreakerReason}` };
        }
        // Cooldown check
        if (this.cooldownUntil > Date.now()) {
            const remaining = Math.ceil((this.cooldownUntil - Date.now()) / 60000);
            this.tradesBlockedToday++;
            return { allowed: false, reason: `⏳ Cooldown: ${remaining} menit tersisa` };
        }
        // Daily loss limit — trips the hard circuit breaker
        if (this.todayLossEth >= MAX_DAILY_LOSS_ETH) {
            this.tradesBlockedToday++;
            const reason = `🔴 Daily loss limit: ${this.todayLossEth.toFixed(5)} ETH (maks ${MAX_DAILY_LOSS_ETH} ETH)`;
            this.tripCircuitBreaker(reason);
            return { allowed: false, reason };
        }
        // Consecutive losses → force cooldown
        if (this.consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) {
            this.cooldownUntil = Date.now() + 30 * 60000;
            this.tradesBlockedToday++;
            return { allowed: false, reason: `⚠️ ${MAX_CONSECUTIVE_LOSSES} consecutive losses → cooldown 30 menit` };
        }
        // Minimum liquidity
        if (token.liquidityUSD !== undefined && token.liquidityUSD < MIN_LIQUIDITY_USD) {
            return { allowed: false, reason: `💧 Likuiditas terlalu rendah: $${token.liquidityUSD.toFixed(0)} (min $${MIN_LIQUIDITY_USD})` };
        }
        // Token age
        if (token.createdAt !== undefined) {
            const ageSeconds = (Date.now() - token.createdAt) / 1000;
            if (ageSeconds > MAX_TOKEN_AGE_SECONDS) {
                return { allowed: false, reason: `⏰ Token terlalu tua: ${Math.floor(ageSeconds)}s (maks ${MAX_TOKEN_AGE_SECONDS}s)` };
            }
        }
        return { allowed: true };
    }
    // ── Gate: called AFTER each trade settles ─────────────────────────────────
    afterTrade(profitETH) {
        if (profitETH < 0) {
            this.todayLossEth += Math.abs(profitETH);
            this.consecutiveLosses++;
            this.lastTradeResult = 'loss';
            console.log(`[RiskManager] Loss: ${profitETH.toFixed(5)} ETH | Today: ${this.todayLossEth.toFixed(5)} | Streak: ${this.consecutiveLosses}`);
            // Trip the hard circuit breaker immediately if daily limit is now exceeded
            if (this.todayLossEth >= MAX_DAILY_LOSS_ETH && !this.circuitBreakerTripped) {
                this.tripCircuitBreaker(`Daily loss limit reached: ${this.todayLossEth.toFixed(5)} ETH / ${MAX_DAILY_LOSS_ETH} ETH`);
            }
        }
        else {
            this.consecutiveLosses = 0;
            this.lastTradeResult = 'profit';
            // Big profit → reinvest partially + cooldown
            if (profitETH > this.totalCapital * 0.5) {
                this.cooldownUntil = Date.now() + COOLDOWN_AFTER_PROFIT_MS;
                const reinvest = profitETH * REINVEST_PERCENT;
                const withdraw = profitETH * (1 - REINVEST_PERCENT);
                this.totalCapital += reinvest;
                console.log(`[RiskManager] Big profit! Reinvest: ${reinvest.toFixed(5)} ETH | Set aside: ${withdraw.toFixed(5)} ETH | Cooldown: ${COOLDOWN_AFTER_PROFIT_MS / 60000}min`);
            }
            else {
                this.totalCapital += profitETH;
            }
        }
    }
    // ── Dynamic position size ──────────────────────────────────────────────────
    getPositionSize(balanceEth) {
        const capital = balanceEth ?? this.totalCapital;
        const base = capital * 0.12; // 12% of capital
        const minSize = 0.001; // gas floor
        const maxSize = capital * 0.30; // hard cap 30%
        return Math.max(minSize, Math.min(maxSize, base));
    }
    // ── Update capital from live balance ──────────────────────────────────────
    updateCapital(balanceEth) {
        this.totalCapital = balanceEth;
    }
    // ── State read-out ────────────────────────────────────────────────────────
    getState() {
        return {
            todayLossEth: this.todayLossEth,
            consecutiveLosses: this.consecutiveLosses,
            cooldownUntil: this.cooldownUntil,
            totalCapital: this.totalCapital,
            tradesBlockedToday: this.tradesBlockedToday,
            lastTradeResult: this.lastTradeResult,
            dailyResetAt: this.dailyResetAt,
            circuitBreakerTripped: this.circuitBreakerTripped,
            circuitBreakerReason: this.circuitBreakerReason,
        };
    }
    isInCooldown() {
        return this.cooldownUntil > Date.now();
    }
}
exports.MicroCapRiskManager = MicroCapRiskManager;
exports.default = MicroCapRiskManager;
//# sourceMappingURL=microcap-risk-manager.js.map