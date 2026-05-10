/**
 * smart-screener.ts
 *
 * Independent multi-signal token screener for Base Network.
 * Designed for micro-cap trading with modal < $10.
 * Target profits: 20% → 40% → 100%+
 *
 * Score breakdown (0-100):
 *  • Momentum   (0-30): price change 1h, buy/sell tx ratio
 *  • Activity   (0-25): volume vs liquidity, buy tx count
 *  • Safety     (0-25): GoPlus honeypot + tax + concentration
 *  • Freshness  (0-20): age of pool (newer = better)
 *
 * Signal levels:
 *  STRONG_BUY  ≥ 75
 *  BUY         ≥ 60
 *  WATCH       ≥ 45
 *  SKIP        < 45
 */

import { EventEmitter } from 'events';
import axios from 'axios';

const GECKO_BASE    = 'https://api.geckoterminal.com/api/v2';
const GECKO_HEADERS = { Accept: 'application/json;version=20230302' };
const GOPLUS_BASE   = 'https://api.gopluslabs.io/api/v1';

export type SignalLevel = 'STRONG_BUY' | 'BUY' | 'WATCH' | 'SKIP';

export interface ScoreBreakdown {
    momentum:   number;   // 0-30
    activity:   number;   // 0-25
    safety:     number;   // 0-25
    freshness:  number;   // 0-20
    total:      number;   // 0-100
    reasons:    string[];
}

export interface ScreenerSignal {
    id:            string;
    tokenAddress:  string;
    tokenSymbol:   string;
    tokenName:     string;
    pairAddress:   string;
    network:       string;
    signal:        SignalLevel;
    score:         ScoreBreakdown;
    liquidityUsd:  number;
    volumeH24:     number;
    priceUsd:      string;
    priceChangeH1: number;
    priceChangeH24:number;
    buyTxH1:       number;
    sellTxH1:      number;
    ageMinutes:    number;
    fdvUsd:        number;
    mcapUsd:       number;
    safetyFlags:   string[];
    sellTax:       number;
    buyTax:        number;
    holderCount:   number;
    creatorPct:    number;
    source:        'new_pool' | 'trending' | 'top_gainers';
    dexUrl:        string;
    basescanUrl:   string;
    discoveredAt:  number;
    expiresAt:     number;
}

export interface ScreenerConfig {
    minLiquidityUsd:     number;
    maxLiquidityUsd:     number;
    minVolumeH24:        number;
    maxAgeMinutes:       number;
    minBuyTxH1:          number;
    maxSellBuyRatio:     number;
    minScore:            number;
    maxSellTax:          number;
    maxBuyTax:           number;
    maxCreatorPct:       number;
    scanIntervalMs:      number;
    maxSignalsKept:      number;
    targetProfitPct:     number[];  // [20, 40, 100]
    stopLossPct:         number;
}

const DEFAULT_CONFIG: ScreenerConfig = {
    minLiquidityUsd:    2_000,
    maxLiquidityUsd:    300_000,
    minVolumeH24:       300,
    maxAgeMinutes:      180,
    minBuyTxH1:         3,
    maxSellBuyRatio:    4.0,
    minScore:           45,
    maxSellTax:         10,
    maxBuyTax:          10,
    maxCreatorPct:      35,
    scanIntervalMs:     20_000,
    maxSignalsKept:     50,
    targetProfitPct:    [20, 40, 100],
    stopLossPct:        15,
};

interface GeckoPool {
    id:         string;
    attributes: {
        address:                        string;
        name:                           string;
        base_token_price_usd:           string;
        quote_token_price_usd:          string;
        base_token_price_native_currency: string;
        price_change_percentage:        { h1?: string; h24?: string; m5?: string };
        reserve_in_usd:                 string;
        volume_usd:                     { h24?: string; h1?: string };
        transactions:                   { h1?: { buys?: number; sells?: number }; h24?: { buys?: number; sells?: number } };
        pool_created_at:                string;
        fdv_usd:                        string;
        market_cap_usd:                 string;
    };
    relationships: {
        base_token?:  { data?: { id?: string } };
        quote_token?: { data?: { id?: string } };
        dex?:         { data?: { id?: string } };
    };
}

interface SafetyResult {
    safe:        boolean;
    score:       number;
    sellTax:     number;
    buyTax:      number;
    holderCount: number;
    creatorPct:  number;
    flags:       string[];
}

export class SmartScreener extends EventEmitter {
    private config:       ScreenerConfig;
    private signals:      Map<string, ScreenerSignal> = new Map();
    private seenPairs:    Map<string, number> = new Map(); // pairAddress → expiry timestamp
    private interval:     NodeJS.Timeout | null = null;
    private pruneTimer:   NodeJS.Timeout | null = null;
    private isScanning    = false;
    private scanCount     = 0;
    private lastNewPool   = 0;
    private lastTrending  = 0;
    private readonly SIGNAL_TTL_MS   = 4 * 60 * 60 * 1000;  // 4h
    private readonly NEW_POOL_EVERY  = 25_000;               // 25s
    private readonly TRENDING_EVERY  = 90_000;               // 90s

    constructor(configOverrides: Partial<ScreenerConfig> = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...configOverrides };
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    start(): void {
        if (this.interval) return;
        console.log('\n🔍 [SmartScreener] ACTIVE — Independent Token Screener');
        console.log(`   Liq: $${this.config.minLiquidityUsd.toLocaleString()} – $${this.config.maxLiquidityUsd.toLocaleString()}`);
        console.log(`   Min score: ${this.config.minScore} | Scan: ${this.config.scanIntervalMs / 1000}s`);

        this.interval   = setInterval(() => this.scan().catch(() => {}), this.config.scanIntervalMs);
        this.pruneTimer = setInterval(() => this.prune(), 30 * 60_000);
        this.scan().catch(() => {});
    }

    stop(): void {
        if (this.interval)   { clearInterval(this.interval);   this.interval   = null; }
        if (this.pruneTimer) { clearInterval(this.pruneTimer); this.pruneTimer = null; }
        console.log('🛑 [SmartScreener] Stopped');
    }

    updateConfig(updates: Partial<ScreenerConfig>): void {
        this.config = { ...this.config, ...updates };
    }

    getSignals(minSignal?: SignalLevel): ScreenerSignal[] {
        const order: Record<SignalLevel, number> = { STRONG_BUY: 4, BUY: 3, WATCH: 2, SKIP: 1 };
        const minOrder = minSignal ? order[minSignal] : 0;
        return [...this.signals.values()]
            .filter(s => order[s.signal] >= minOrder)
            .sort((a, b) => b.score.total - a.score.total);
    }

    getConfig(): ScreenerConfig { return { ...this.config }; }
    getScanCount(): number { return this.scanCount; }

    // ─── Main scan loop ───────────────────────────────────────────────────────

    private async scan(): Promise<void> {
        if (this.isScanning) return;
        this.isScanning = true;
        this.scanCount++;

        try {
            const now = Date.now();
            const pools: (GeckoPool & { _source: 'new_pool' | 'trending' })[] = [];

            if (now - this.lastNewPool > this.NEW_POOL_EVERY) {
                this.lastNewPool = now;
                const np = await this.fetchNewPools();
                pools.push(...np.map(p => ({ ...p, _source: 'new_pool' as const })));
            }

            if (now - this.lastTrending > this.TRENDING_EVERY) {
                this.lastTrending = now;
                const tr = await this.fetchTrending();
                pools.push(...tr.map(p => ({ ...p, _source: 'trending' as const })));
            }

            for (const pool of pools) {
                await this.processPool(pool, pool._source);
            }
        } finally {
            this.isScanning = false;
        }
    }

    // ─── GeckoTerminal fetchers ───────────────────────────────────────────────

    private async fetchNewPools(): Promise<GeckoPool[]> {
        try {
            const res = await axios.get(
                `${GECKO_BASE}/networks/base/new_pools?page=1&include=base_token,quote_token`,
                { headers: GECKO_HEADERS, timeout: 8000 }
            );
            return (res.data?.data ?? []) as GeckoPool[];
        } catch { return []; }
    }

    private async fetchTrending(): Promise<GeckoPool[]> {
        try {
            const res = await axios.get(
                `${GECKO_BASE}/networks/base/trending_pools?page=1&include=base_token,quote_token`,
                { headers: GECKO_HEADERS, timeout: 8000 }
            );
            return (res.data?.data ?? []) as GeckoPool[];
        } catch { return []; }
    }

    // ─── Pool processing ──────────────────────────────────────────────────────

    private async processPool(pool: GeckoPool, source: 'new_pool' | 'trending'): Promise<void> {
        const attr        = pool.attributes;
        const pairAddress = attr.address?.toLowerCase();
        if (!pairAddress) return;
        if (this.seenPairs.has(pairAddress)) return;

        // Extract token address from relationship
        const baseId       = pool.relationships?.base_token?.data?.id ?? '';
        const tokenAddress = baseId.includes('_')
            ? baseId.split('_')[1]?.toLowerCase()
            : pairAddress;
        if (!tokenAddress || !tokenAddress.startsWith('0x')) return;

        // Basic numeric parsing
        const liquidityUsd  = parseFloat(attr.reserve_in_usd           || '0');
        const volumeH24     = parseFloat(attr.volume_usd?.h24           || '0');
        const priceChangeH1 = parseFloat(attr.price_change_percentage?.h1  || '0');
        const priceChangeH24= parseFloat(attr.price_change_percentage?.h24 || '0');
        const fdvUsd        = parseFloat(attr.fdv_usd                   || '0');
        const mcapUsd       = parseFloat(attr.market_cap_usd            || '0');
        const priceUsd      = attr.base_token_price_usd || '0';
        const buyTxH1       = attr.transactions?.h1?.buys  ?? 0;
        const sellTxH1      = attr.transactions?.h1?.sells ?? 0;
        const pairCreatedAt = attr.pool_created_at ? new Date(attr.pool_created_at).getTime() : Date.now();
        const ageMinutes    = (Date.now() - pairCreatedAt) / 60_000;

        // ── Quick pre-filters (before safety API call) ────────────────────────
        if (liquidityUsd  < this.config.minLiquidityUsd)  return;
        if (liquidityUsd  > this.config.maxLiquidityUsd)  return;
        if (volumeH24     < this.config.minVolumeH24)      return;
        if (source === 'new_pool' && ageMinutes > this.config.maxAgeMinutes) return;
        if (buyTxH1       < this.config.minBuyTxH1)        return;

        // Sell/buy ratio gate
        const sbRatio = sellTxH1 > 0 ? sellTxH1 / Math.max(buyTxH1, 1) : 0;
        if (sbRatio > this.config.maxSellBuyRatio) return;

        this.seenPairs.set(pairAddress, Date.now() + this.SIGNAL_TTL_MS);

        // ── Safety check (GoPlus) ─────────────────────────────────────────────
        const safety = await this.checkSafety(tokenAddress);

        if (!safety.safe) return;
        if (safety.sellTax > this.config.maxSellTax) return;
        if (safety.buyTax  > this.config.maxBuyTax)  return;
        if (safety.creatorPct > this.config.maxCreatorPct) return;

        // ── Scoring ────────────────────────────────────────────────────────────
        const score = this.computeScore({
            liquidityUsd, volumeH24, priceChangeH1, priceChangeH24,
            buyTxH1, sellTxH1, ageMinutes, fdvUsd, mcapUsd,
            safetyScore: safety.score, sbRatio,
        });

        if (score.total < this.config.minScore) return;

        const signal = this.classifySignal(score.total);
        const poolName = attr.name ?? 'Unknown';

        // Token name / symbol from pool name (e.g. "SYMBOL / WETH")
        const symMatch = poolName.match(/^([^/\s]+)/);
        const tokenSymbol = symMatch ? symMatch[1] : 'UNKNOWN';

        const sig: ScreenerSignal = {
            id:             `${pairAddress.slice(0, 8)}-${Date.now()}`,
            tokenAddress,
            tokenSymbol,
            tokenName:      poolName.replace(/ \/ .*/, '') || tokenSymbol,
            pairAddress,
            network:        'base',
            signal,
            score,
            liquidityUsd,
            volumeH24,
            priceUsd,
            priceChangeH1,
            priceChangeH24,
            buyTxH1,
            sellTxH1,
            ageMinutes:     Math.round(ageMinutes),
            fdvUsd,
            mcapUsd,
            safetyFlags:    safety.flags,
            sellTax:        safety.sellTax,
            buyTax:         safety.buyTax,
            holderCount:    safety.holderCount,
            creatorPct:     safety.creatorPct,
            source,
            dexUrl:         `https://www.geckoterminal.com/base/pools/${pairAddress}`,
            basescanUrl:    `https://basescan.org/token/${tokenAddress}`,
            discoveredAt:   Date.now(),
            expiresAt:      Date.now() + this.SIGNAL_TTL_MS,
        };

        // Keep only top N by score
        this.signals.set(pairAddress, sig);
        if (this.signals.size > this.config.maxSignalsKept) {
            this.evictLowest();
        }

        console.log(`\n📡 [SmartScreener] ${signal} — ${tokenSymbol} (score: ${score.total})`);
        console.log(`   💧 Liq: $${liquidityUsd.toLocaleString()} | Vol24h: $${volumeH24.toLocaleString()}`);
        console.log(`   📈 1h: ${priceChangeH1 >= 0 ? '+' : ''}${priceChangeH1.toFixed(1)}% | Buys 1h: ${buyTxH1} | Age: ${Math.round(ageMinutes)}min`);
        console.log(`   🛡️  Safety: ${safety.score}/25 | Tax: ${safety.buyTax}/${safety.sellTax}% | ${safety.flags.join(', ') || 'Clean'}`);
        console.log(`   📊 Breakdown: momentum=${score.momentum} activity=${score.activity} safety=${score.safety} freshness=${score.freshness}`);

        this.emit('signal', sig);

        if (signal === 'STRONG_BUY' || signal === 'BUY') {
            this.emit('buy-signal', sig);
        }
    }

    // ─── Scoring engine ───────────────────────────────────────────────────────

    private computeScore(d: {
        liquidityUsd:  number;
        volumeH24:     number;
        priceChangeH1: number;
        priceChangeH24:number;
        buyTxH1:       number;
        sellTxH1:      number;
        ageMinutes:    number;
        fdvUsd:        number;
        mcapUsd:       number;
        safetyScore:   number;
        sbRatio:       number;
    }): ScoreBreakdown {
        const reasons: string[] = [];
        let momentum  = 0;
        let activity  = 0;
        let safety    = 0;
        let freshness = 0;

        // ── MOMENTUM (0-30) ──────────────────────────────────────────────────
        // Price change 1h
        if      (d.priceChangeH1 > 50)  { momentum += 12; reasons.push(`+${d.priceChangeH1.toFixed(0)}% 1h 🔥`); }
        else if (d.priceChangeH1 > 20)  { momentum += 9;  reasons.push(`+${d.priceChangeH1.toFixed(0)}% 1h`); }
        else if (d.priceChangeH1 > 5)   { momentum += 6;  reasons.push(`+${d.priceChangeH1.toFixed(0)}% 1h`); }
        else if (d.priceChangeH1 > 0)   { momentum += 3; }
        else if (d.priceChangeH1 < -15) { momentum -= 5;  reasons.push(`${d.priceChangeH1.toFixed(0)}% 1h ⚠️`); }

        // Buy/sell ratio
        const bsr = d.buyTxH1 / Math.max(d.sellTxH1, 1);
        if      (bsr > 5)   { momentum += 12; reasons.push(`BSR ${bsr.toFixed(1)} 🚀`); }
        else if (bsr > 3)   { momentum += 9;  reasons.push(`BSR ${bsr.toFixed(1)}`); }
        else if (bsr > 1.5) { momentum += 6;  reasons.push(`BSR ${bsr.toFixed(1)}`); }
        else if (bsr > 1)   { momentum += 3; }
        else if (bsr < 0.7) { momentum -= 5;  reasons.push('Sell pressure ⚠️'); }

        // 24h price (secondary signal)
        if (d.priceChangeH24 > 100) { momentum += 6;  reasons.push(`+${d.priceChangeH24.toFixed(0)}% 24h`); }
        else if (d.priceChangeH24 > 30) { momentum += 3; }

        momentum = Math.max(0, Math.min(30, momentum));

        // ── ACTIVITY (0-25) ──────────────────────────────────────────────────
        // Buy tx count
        if      (d.buyTxH1 > 100) { activity += 10; reasons.push(`${d.buyTxH1} buys/h 🔥`); }
        else if (d.buyTxH1 > 50)  { activity += 8;  reasons.push(`${d.buyTxH1} buys/h`); }
        else if (d.buyTxH1 > 20)  { activity += 6;  reasons.push(`${d.buyTxH1} buys/h`); }
        else if (d.buyTxH1 > 10)  { activity += 4; }
        else if (d.buyTxH1 > 3)   { activity += 2; }

        // Volume vs liquidity (vol/liq ratio — key signal for microcap pumps)
        const volLiq = d.liquidityUsd > 0 ? d.volumeH24 / d.liquidityUsd : 0;
        if      (volLiq > 5)    { activity += 10; reasons.push(`Vol/Liq: ${volLiq.toFixed(1)}x 🔥`); }
        else if (volLiq > 2)    { activity += 8;  reasons.push(`Vol/Liq: ${volLiq.toFixed(1)}x`); }
        else if (volLiq > 1)    { activity += 6;  reasons.push(`Vol/Liq: ${volLiq.toFixed(1)}x`); }
        else if (volLiq > 0.5)  { activity += 4; }
        else if (volLiq > 0.1)  { activity += 2; }

        // FDV/liquidity ratio (lower = better, higher = overvalued)
        if (d.fdvUsd > 0 && d.liquidityUsd > 0) {
            const fdvRatio = d.fdvUsd / d.liquidityUsd;
            if      (fdvRatio < 5)   { activity += 5; reasons.push(`FDV/Liq: ${fdvRatio.toFixed(1)}x ✅`); }
            else if (fdvRatio < 15)  { activity += 3; }
            else if (fdvRatio > 100) { activity -= 5; reasons.push(`FDV/Liq: ${fdvRatio.toFixed(0)}x ⚠️`); }
        }

        activity = Math.max(0, Math.min(25, activity));

        // ── SAFETY (0-25) ────────────────────────────────────────────────────
        // Map GoPlus safety score (0-100) → (0-25)
        safety = Math.round((d.safetyScore / 100) * 25);
        safety = Math.max(0, Math.min(25, safety));

        // ── FRESHNESS (0-20) ─────────────────────────────────────────────────
        // Fresher pools have more upside (catching early)
        if      (d.ageMinutes < 5)   { freshness = 20; reasons.push('< 5min old 🆕'); }
        else if (d.ageMinutes < 15)  { freshness = 16; reasons.push('< 15min old'); }
        else if (d.ageMinutes < 30)  { freshness = 13; }
        else if (d.ageMinutes < 60)  { freshness = 10; }
        else if (d.ageMinutes < 120) { freshness = 6; }
        else if (d.ageMinutes < 180) { freshness = 3; }
        else                         { freshness = 0; }

        const total = Math.min(100, momentum + activity + safety + freshness);

        return { momentum, activity, safety, freshness, total, reasons };
    }

    private classifySignal(score: number): SignalLevel {
        if (score >= 75) return 'STRONG_BUY';
        if (score >= 60) return 'BUY';
        if (score >= 45) return 'WATCH';
        return 'SKIP';
    }

    // ─── Safety via GoPlus ────────────────────────────────────────────────────

    private async checkSafety(tokenAddress: string): Promise<SafetyResult> {
        const FAIL: SafetyResult = { safe: false, score: 0, sellTax: 0, buyTax: 0, holderCount: 0, creatorPct: 0, flags: ['API_FAIL'] };
        try {
            const res = await axios.get(
                `${GOPLUS_BASE}/token_security/8453?contract_addresses=${tokenAddress}`,
                { timeout: 7000 }
            );
            const data = res.data?.result?.[tokenAddress.toLowerCase()];
            if (!data) return { safe: true, score: 50, sellTax: 0, buyTax: 0, holderCount: 0, creatorPct: 0, flags: [] };

            const sellTax    = parseFloat(data.sell_tax     || '0');
            const buyTax     = parseFloat(data.buy_tax      || '0');
            const creatorPct = parseFloat(data.creator_percent || '0') * 100;
            const holderCount= parseInt(data.holder_count   || '0');
            const flags: string[] = [];

            // Hard fails
            if (data.is_honeypot        === '1') return { ...FAIL, flags: ['HONEYPOT'] };
            if (data.cannot_sell_all    === '1') return { ...FAIL, flags: ['CANNOT_SELL'] };
            if (sellTax > this.config.maxSellTax) return { ...FAIL, flags: [`SELL_TAX_${sellTax.toFixed(0)}%`] };
            if (buyTax  > this.config.maxBuyTax)  return { ...FAIL, flags: [`BUY_TAX_${buyTax.toFixed(0)}%`] };
            if (creatorPct > this.config.maxCreatorPct) return { ...FAIL, flags: [`CREATOR_${creatorPct.toFixed(0)}%`] };
            if (holderCount < 5 && holderCount > 0) return { ...FAIL, flags: ['TOO_FEW_HOLDERS'] };

            // Warnings (reduce score)
            let score = 100;
            if (data.is_mintable        === '1' && data.owner_address) { score -= 15; flags.push('MINTABLE'); }
            if (data.is_proxy           === '1')   { score -= 10; flags.push('PROXY'); }
            if (data.hidden_owner       === '1')   { score -= 20; flags.push('HIDDEN_OWNER'); }
            if (data.can_take_back_ownership==='1'){ score -= 15; flags.push('TAKE_BACK_OWN'); }
            if (sellTax > 5)   { score -= sellTax * 1.5; flags.push(`SELL_TAX_${sellTax.toFixed(0)}%`); }
            if (buyTax  > 5)   { score -= buyTax  * 1.5; flags.push(`BUY_TAX_${buyTax.toFixed(0)}%`); }
            if (creatorPct > 15) { score -= 20; flags.push(`CREATOR_${creatorPct.toFixed(0)}%`); }
            if (holderCount < 20 && holderCount > 0) { score -= 10; flags.push('FEW_HOLDERS'); }

            score = Math.max(0, Math.min(100, score));

            return { safe: score >= 40, score, sellTax, buyTax, holderCount, creatorPct, flags };
        } catch {
            // If GoPlus fails, use a neutral score (50) — don't block trade, but don't boost either
            return { safe: true, score: 50, sellTax: 0, buyTax: 0, holderCount: 0, creatorPct: 0, flags: ['GOPLUS_UNAVAIL'] };
        }
    }

    // ─── Memory management ────────────────────────────────────────────────────

    private evictLowest(): void {
        let lowestAddr = '';
        let lowestScore = Infinity;
        for (const [addr, sig] of this.signals) {
            if (sig.score.total < lowestScore) {
                lowestScore = sig.score.total;
                lowestAddr  = addr;
            }
        }
        if (lowestAddr) this.signals.delete(lowestAddr);
    }

    private prune(): void {
        const now = Date.now();
        let prunedSignals = 0;
        let prunedPairs   = 0;
        for (const [addr, sig] of this.signals) {
            if (sig.expiresAt < now) { this.signals.delete(addr); prunedSignals++; }
        }
        for (const [addr, expiry] of this.seenPairs) {
            if (expiry < now) { this.seenPairs.delete(addr); prunedPairs++; }
        }
        if (prunedSignals || prunedPairs) {
            console.log(`🔍 [SmartScreener] Pruned ${prunedSignals} signals, ${prunedPairs} seen-pairs`);
        }
    }

    // ─── Stats ────────────────────────────────────────────────────────────────

    getStats() {
        const all = [...this.signals.values()];
        return {
            total:      all.length,
            strongBuy:  all.filter(s => s.signal === 'STRONG_BUY').length,
            buy:        all.filter(s => s.signal === 'BUY').length,
            watch:      all.filter(s => s.signal === 'WATCH').length,
            scanCount:  this.scanCount,
        };
    }
}

export default SmartScreener;
