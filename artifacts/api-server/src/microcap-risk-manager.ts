/**
 * microcap-risk-manager.ts
 * Manajemen risiko untuk modal kecil (0.006 ETH)
 * - Daily loss limit, consecutive loss protection, cooldown setelah profit besar
 * - Dynamic position sizing: 12% dari modal aktif
 */

export interface RiskState {
    todayLossEth:       number;
    consecutiveLosses:  number;
    cooldownUntil:      number;   // epoch ms, 0 = no cooldown
    totalCapital:       number;
    tradesBlockedToday: number;
    lastTradeResult:    'profit' | 'loss' | null;
    dailyResetAt:       number;   // epoch ms of next daily reset
}

export interface TradeGateResult {
    allowed: boolean;
    reason?: string;
}

const MAX_DAILY_LOSS_ETH      = parseFloat(process.env.MAX_DAILY_LOSS_ETH      || '0.0015');
const MAX_CONSECUTIVE_LOSSES  = parseInt  (process.env.MAX_CONSECUTIVE_LOSSES  || '3');
const COOLDOWN_AFTER_PROFIT_MS = parseInt (process.env.COOLDOWN_AFTER_BIG_PROFIT_MINUTES || '15') * 60_000;
const REINVEST_PERCENT         = parseFloat(process.env.REINVEST_PERCENT        || '50') / 100;
const MIN_LIQUIDITY_USD        = parseFloat(process.env.MIN_LIQUIDITY_USD       || '5000');
const MAX_TOKEN_AGE_SECONDS    = parseInt  (process.env.MAX_TOKEN_AGE_SECONDS   || '300');

export class MicroCapRiskManager {
    private todayLossEth      = 0;
    private consecutiveLosses = 0;
    private cooldownUntil     = 0;
    private totalCapital: number;
    private tradesBlockedToday = 0;
    private lastTradeResult: 'profit' | 'loss' | null = null;
    private dailyResetAt: number;

    constructor(initialCapital = 0.006) {
        this.totalCapital = initialCapital;
        this.dailyResetAt = this.nextMidnightUtc();
        // Schedule daily reset
        this.scheduleDailyReset();
    }

    private nextMidnightUtc(): number {
        const now = new Date();
        const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
        return next.getTime();
    }

    private scheduleDailyReset(): void {
        const msUntilReset = this.dailyResetAt - Date.now();
        setTimeout(() => {
            this.todayLossEth       = 0;
            this.tradesBlockedToday = 0;
            this.dailyResetAt       = this.nextMidnightUtc();
            console.log('[RiskManager] Daily reset — loss counter cleared');
            this.scheduleDailyReset();
        }, Math.max(msUntilReset, 1000));
    }

    // ── Gate: called BEFORE each trade ────────────────────────────────────────
    beforeTrade(token: {
        liquidityUSD?: number;
        createdAt?: number;
    } = {}): TradeGateResult {

        // Cooldown check
        if (this.cooldownUntil > Date.now()) {
            const remaining = Math.ceil((this.cooldownUntil - Date.now()) / 60_000);
            this.tradesBlockedToday++;
            return { allowed: false, reason: `⏳ Cooldown: ${remaining} menit tersisa` };
        }

        // Daily loss limit
        if (this.todayLossEth >= MAX_DAILY_LOSS_ETH) {
            this.tradesBlockedToday++;
            return { allowed: false, reason: `🔴 Daily loss limit: ${this.todayLossEth.toFixed(5)} ETH (maks ${MAX_DAILY_LOSS_ETH} ETH)` };
        }

        // Consecutive losses → force cooldown
        if (this.consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) {
            this.cooldownUntil = Date.now() + 30 * 60_000;
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
    afterTrade(profitETH: number): void {
        if (profitETH < 0) {
            this.todayLossEth    += Math.abs(profitETH);
            this.consecutiveLosses++;
            this.lastTradeResult = 'loss';
            console.log(`[RiskManager] Loss: ${profitETH.toFixed(5)} ETH | Today: ${this.todayLossEth.toFixed(5)} | Streak: ${this.consecutiveLosses}`);
        } else {
            this.consecutiveLosses = 0;
            this.lastTradeResult   = 'profit';

            // Big profit → reinvest partially + cooldown
            if (profitETH > this.totalCapital * 0.5) {
                this.cooldownUntil  = Date.now() + COOLDOWN_AFTER_PROFIT_MS;
                const reinvest = profitETH * REINVEST_PERCENT;
                const withdraw = profitETH * (1 - REINVEST_PERCENT);
                this.totalCapital  += reinvest;
                console.log(`[RiskManager] Big profit! Reinvest: ${reinvest.toFixed(5)} ETH | Set aside: ${withdraw.toFixed(5)} ETH | Cooldown: ${COOLDOWN_AFTER_PROFIT_MS / 60_000}min`);
            } else {
                this.totalCapital += profitETH;
            }
        }
    }

    // ── Dynamic position size ──────────────────────────────────────────────────
    getPositionSize(balanceEth?: number): number {
        const capital = balanceEth ?? this.totalCapital;
        const base    = capital * 0.12;        // 12% of capital
        const minSize = 0.001;                 // gas floor
        const maxSize = capital * 0.30;        // hard cap 30%
        return Math.max(minSize, Math.min(maxSize, base));
    }

    // ── Update capital from live balance ──────────────────────────────────────
    updateCapital(balanceEth: number): void {
        this.totalCapital = balanceEth;
    }

    // ── State read-out ────────────────────────────────────────────────────────
    getState(): RiskState {
        return {
            todayLossEth:       this.todayLossEth,
            consecutiveLosses:  this.consecutiveLosses,
            cooldownUntil:      this.cooldownUntil,
            totalCapital:       this.totalCapital,
            tradesBlockedToday: this.tradesBlockedToday,
            lastTradeResult:    this.lastTradeResult,
            dailyResetAt:       this.dailyResetAt,
        };
    }

    isInCooldown(): boolean {
        return this.cooldownUntil > Date.now();
    }
}

export default MicroCapRiskManager;
