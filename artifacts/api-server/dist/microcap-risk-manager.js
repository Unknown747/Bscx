"use strict";
/**
 * microcap-risk-manager.ts
 * Manajemen risiko untuk modal kecil (0.006 ETH)
 * - Daily loss limit → cooldown otomatis (bukan stop permanen), resume sendiri setelah cooldown habis
 * - Consecutive loss protection → cooldown 30 menit
 * - Cooldown setelah profit besar
 * - Hard circuit breaker: HANYA untuk Emergency Stop manual (bukan daily loss)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MicroCapRiskManager = void 0;
const REINVEST_PERCENT = parseFloat(process.env.REINVEST_PERCENT || '50') / 100;
const MIN_LIQUIDITY_USD = parseFloat(process.env.MIN_LIQUIDITY_USD || '5000');
const MAX_TOKEN_AGE_SECONDS = parseInt(process.env.MAX_TOKEN_AGE_SECONDS || '300');
class MicroCapRiskManager {
    constructor(initialCapital = 0.006) {
        this.todayLossEth = 0;
        this.consecutiveLosses = 0;
        this.cooldownUntil = 0;
        this.cooldownReason = '';
        this.tradesBlockedToday = 0;
        this.lastTradeResult = null;
        // ── Configurable limits (updated at runtime via settings) ─────────────────
        this.maxDailyLossEth = parseFloat(process.env.MAX_DAILY_LOSS_ETH || '0.0015');
        this.dailyLossCooldownHours = parseFloat(process.env.DAILY_LOSS_COOLDOWN_HOURS || '2');
        this.maxConsecutiveLosses = parseInt(process.env.MAX_CONSECUTIVE_LOSSES || '3');
        this.cooldownAfterProfitMs = parseInt(process.env.COOLDOWN_AFTER_BIG_PROFIT_MINUTES || '15') * 60000;
        // ── Hard circuit breaker — ONLY for manual Emergency Stop ─────────────────
        this.circuitBreakerTripped = false;
        this.circuitBreakerReason = '';
        this.totalCapital = initialCapital;
        this.dailyResetAt = this.nextMidnightUtc();
        this.scheduleDailyReset();
    }
    /** Update limits at runtime (called from settings save). */
    updateLimits(maxDailyLossEth, maxConsecutiveLosses, cooldownAfterProfitMinutes, dailyLossCooldownHours) {
        this.maxDailyLossEth = maxDailyLossEth;
        this.maxConsecutiveLosses = maxConsecutiveLosses;
        this.cooldownAfterProfitMs = cooldownAfterProfitMinutes * 60000;
        this.dailyLossCooldownHours = dailyLossCooldownHours;
        console.log(`[RiskManager] Limits updated — dailyLoss: ${maxDailyLossEth} ETH | CD: ${dailyLossCooldownHours}h | maxConsec: ${maxConsecutiveLosses} | profitCD: ${cooldownAfterProfitMinutes}min`);
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
            this.cooldownUntil = 0;
            this.cooldownReason = '';
            // Circuit breaker is intentionally NOT reset here — it requires a manual
            // call to resetCircuitBreaker() (Emergency Stop must be cleared explicitly).
            this.dailyResetAt = this.nextMidnightUtc();
            console.log('[RiskManager] ✅ Daily reset — loss counters cleared (circuit breaker unchanged)');
            this.scheduleDailyReset();
        }, Math.max(msUntilReset, 1000));
    }
    // ── Hard circuit breaker — Emergency Stop ONLY ────────────────────────────
    tripCircuitBreaker(reason) {
        if (this.circuitBreakerTripped)
            return;
        this.circuitBreakerTripped = true;
        this.circuitBreakerReason = reason;
        console.log(`\n🔴🔴🔴 [CircuitBreaker] EMERGENCY STOP: ${reason}`);
    }
    resetCircuitBreaker() {
        this.circuitBreakerTripped = false;
        this.circuitBreakerReason = '';
        console.log('[RiskManager] 🟢 Circuit breaker reset — trading dilanjutkan');
    }
    isCircuitBreakerTripped() { return this.circuitBreakerTripped; }
    getCircuitBreakerReason() { return this.circuitBreakerReason; }
    isDailyLimitHit() { return this.todayLossEth >= this.maxDailyLossEth; }
    // ── Helper: set cooldown ──────────────────────────────────────────────────
    setCooldown(durationMs, reason) {
        this.cooldownUntil = Date.now() + durationMs;
        this.cooldownReason = reason;
        const mins = Math.round(durationMs / 60000);
        const hrs = (durationMs / 3600000).toFixed(1);
        console.log(`[RiskManager] ⏳ Cooldown ${mins >= 60 ? hrs + 'j' : mins + 'mnt'}: ${reason}`);
    }
    // ── Gate: called BEFORE each trade ────────────────────────────────────────
    // skipCooldown=true → hanya Emergency Stop yg memblokir (untuk copy trade)
    beforeTrade(token = {}, skipCooldown = false) {
        // Emergency stop — highest priority, selalu dipatuhi
        if (this.circuitBreakerTripped) {
            this.tradesBlockedToday++;
            return { allowed: false, reason: `🔴 Emergency Stop aktif: ${this.circuitBreakerReason}` };
        }
        // Cooldown check (covers: daily loss CD, consecutive loss CD, big-profit CD)
        // Copy trade melewati ini — whale signal independen dari screener kami
        if (!skipCooldown && this.cooldownUntil > Date.now()) {
            const remaining = this.cooldownUntil - Date.now();
            const remainingMins = Math.ceil(remaining / 60000);
            const display = remainingMins >= 60
                ? `${(remaining / 3600000).toFixed(1)} jam`
                : `${remainingMins} menit`;
            this.tradesBlockedToday++;
            return { allowed: false, reason: `⏳ Cooldown ${display} tersisa — ${this.cooldownReason}` };
        }
        // Daily loss limit → cooldown otomatis (bukan hard stop)
        if (this.todayLossEth >= this.maxDailyLossEth) {
            this.tradesBlockedToday++;
            const cdMs = this.dailyLossCooldownHours * 3600000;
            const reason = `rugi harian ${this.todayLossEth.toFixed(5)} ETH (limit: ${this.maxDailyLossEth} ETH)`;
            this.setCooldown(cdMs, reason);
            return { allowed: false, reason: `⏳ Daily loss limit — cooldown ${this.dailyLossCooldownHours}j lalu lanjut otomatis` };
        }
        // Consecutive losses → 30-menit cooldown
        if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
            this.tradesBlockedToday++;
            this.setCooldown(30 * 60000, `${this.maxConsecutiveLosses}× kalah berturut`);
            return { allowed: false, reason: `⚠️ ${this.maxConsecutiveLosses}× kalah berturut → cooldown 30 menit` };
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
            console.log(`[RiskManager] Loss: ${profitETH.toFixed(5)} ETH | Hari ini: ${this.todayLossEth.toFixed(5)} | Streak: ${this.consecutiveLosses}`);
            // Daily loss limit exceeded → set cooldown (auto-resume, bukan hard stop)
            if (this.todayLossEth >= this.maxDailyLossEth && this.cooldownUntil <= Date.now()) {
                const cdMs = this.dailyLossCooldownHours * 3600000;
                const reason = `rugi harian ${this.todayLossEth.toFixed(5)} ETH (limit: ${this.maxDailyLossEth} ETH)`;
                this.setCooldown(cdMs, reason);
            }
        }
        else {
            this.consecutiveLosses = 0;
            this.lastTradeResult = 'profit';
            // Big profit → reinvest partially + cooldown
            if (profitETH > this.totalCapital * 0.5) {
                this.setCooldown(this.cooldownAfterProfitMs, `profit besar +${profitETH.toFixed(5)} ETH`);
                const reinvest = profitETH * REINVEST_PERCENT;
                const withdraw = profitETH * (1 - REINVEST_PERCENT);
                this.totalCapital += reinvest;
                console.log(`[RiskManager] Big profit! Reinvest: ${reinvest.toFixed(5)} ETH | Sisihkan: ${withdraw.toFixed(5)} ETH`);
            }
            else {
                this.totalCapital += profitETH;
            }
        }
    }
    // ── Dynamic position size ─────────────────────────────────────────────────
    getPositionSize(balanceEth) {
        const capital = balanceEth ?? this.totalCapital;
        const base = capital * 0.12;
        const minSize = 0.001;
        const maxSize = capital * 0.30;
        return Math.max(minSize, Math.min(maxSize, base));
    }
    updateCapital(balanceEth) { this.totalCapital = balanceEth; }
    // ── State read-out ────────────────────────────────────────────────────────
    getState() {
        return {
            todayLossEth: this.todayLossEth,
            dailyLossLimit: this.maxDailyLossEth,
            dailyLossCooldownHours: this.dailyLossCooldownHours,
            consecutiveLosses: this.consecutiveLosses,
            cooldownUntil: this.cooldownUntil,
            cooldownReason: this.cooldownReason,
            totalCapital: this.totalCapital,
            tradesBlockedToday: this.tradesBlockedToday,
            lastTradeResult: this.lastTradeResult,
            dailyResetAt: this.dailyResetAt,
            circuitBreakerTripped: this.circuitBreakerTripped,
            circuitBreakerReason: this.circuitBreakerReason,
        };
    }
    isInCooldown() { return this.cooldownUntil > Date.now(); }
}
exports.MicroCapRiskManager = MicroCapRiskManager;
exports.default = MicroCapRiskManager;
//# sourceMappingURL=microcap-risk-manager.js.map