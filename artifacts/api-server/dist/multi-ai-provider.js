"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiAIProvider = void 0;
const axios_1 = __importDefault(require("axios"));
const price_oracle_1 = require("./price-oracle");
const performance_optimizer_1 = require("./performance-optimizer");
// ============ MAIN AI PROVIDER CLASS ============
class MultiAIProvider {
    constructor() {
        this.currentProvider = 'groq';
        this.stats = new Map();
        this.API_KEYS = {
            GROQ: process.env.GROQ_API_KEY || '',
            GEMINI: process.env.GEMINI_API_KEY || '',
            HUGGINGFACE: process.env.HUGGINGFACE_API_KEY || ''
        };
        this.ENDPOINTS = {
            groq: 'https://api.groq.com/openai/v1/chat/completions',
            gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
            huggingface: 'https://api-inference.huggingface.co/models'
        };
        // ── Token analysis cache (5 min TTL) ─────────────────────────────────────
        this.tokenAnalysisCache = new Map();
        // ── Per-provider rate-limit cooldown ─────────────────────────────────────
        this.providerCooldown = new Map(); // provider → retryAfterMs
        this.groqClient = axios_1.default.create({
            headers: {
                'Authorization': `Bearer ${this.API_KEYS.GROQ}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });
        this.geminiClient = axios_1.default.create({ timeout: 10000 });
        this.huggingfaceClient = axios_1.default.create({
            headers: {
                'Authorization': `Bearer ${this.API_KEYS.HUGGINGFACE}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });
        this.stats.set('groq', { success: 0, fail: 0, avgLatency: 0 });
        this.stats.set('gemini', { success: 0, fail: 0, avgLatency: 0 });
        this.stats.set('huggingface', { success: 0, fail: 0, avgLatency: 0 });
        console.log('🤖 Multi-AI Provider initialized');
        console.log(`   Groq:         ${this.API_KEYS.GROQ ? '✅ set' : '❌ missing'}`);
        console.log(`   Gemini:       ${this.API_KEYS.GEMINI ? '✅ set' : '❌ missing'}`);
        console.log(`   HuggingFace:  ${this.API_KEYS.HUGGINGFACE ? '✅ set' : '❌ missing'}`);
    }
    // ============ CORE METHOD ============
    async query(prompt, preferredProvider) {
        const provider = preferredProvider || this.selectBestProvider(prompt);
        console.log(`🧠 AI Query [${provider}] (${prompt.length} chars)`);
        const startTime = Date.now();
        try {
            let response;
            switch (provider) {
                case 'groq':
                    response = await this.queryGroq(prompt);
                    break;
                case 'gemini':
                    response = await this.queryGemini(prompt);
                    break;
                case 'huggingface':
                    response = await this.queryHuggingFace(prompt);
                    break;
                default: response = await this.queryGroq(prompt);
            }
            response.latency = Date.now() - startTime;
            const stat = this.stats.get(provider);
            stat.success++;
            stat.avgLatency = (stat.avgLatency * (stat.success - 1) + response.latency) / stat.success;
            this.stats.set(provider, stat);
            if (provider === 'groq' && response.success) {
                this.currentProvider = 'groq';
            }
            return response;
        }
        catch (error) {
            const stat = this.stats.get(provider);
            stat.fail++;
            this.stats.set(provider, stat);
            const resp = error?.response;
            const errMsg = resp
                ? `HTTP ${resp.status} — ${resp.data?.error?.message ?? resp.statusText}`
                : error?.message ?? String(error);
            console.error(`❌ AI [${provider}] failed: ${errMsg}`);
            // Track rate-limit cooldown (429) — parse retry-after header
            if (resp?.status === 429) {
                const retryAfterSec = parseInt(resp.headers?.['retry-after'] ?? '60', 10);
                const cooldownMs = Math.min((isNaN(retryAfterSec) ? 60 : retryAfterSec) * 1000, 900000);
                this.providerCooldown.set(provider, Date.now() + cooldownMs);
                console.warn(`⏳ AI [${provider}] rate-limited — cooldown ${Math.round(cooldownMs / 1000)}s`);
            }
            return this.fallbackQuery(prompt, provider);
        }
    }
    isOnCooldown(provider) {
        const until = this.providerCooldown.get(provider) ?? 0;
        return Date.now() < until;
    }
    selectBestProvider(prompt) {
        const order = ['groq', 'gemini', 'huggingface'];
        // Try preferred order, skip any provider on rate-limit cooldown
        for (const p of order) {
            if (!this.isOnCooldown(p) && this.API_KEYS[p.toUpperCase()]) {
                return p;
            }
        }
        // All on cooldown — pick least recently cooled (closest to expiry)
        return order.reduce((best, p) => {
            const a = this.providerCooldown.get(best) ?? 0;
            const b = this.providerCooldown.get(p) ?? 0;
            return b < a ? p : best;
        });
    }
    // Call private provider methods directly to avoid infinite recursion
    async fallbackQuery(originalPrompt, failedProvider) {
        const providerMap = {
            groq: () => this.queryGroq(originalPrompt),
            gemini: () => this.queryGemini(originalPrompt),
            huggingface: () => this.queryHuggingFace(originalPrompt)
        };
        const fallbacks = ['groq', 'gemini', 'huggingface'].filter(p => p !== failedProvider);
        for (const fallback of fallbacks) {
            try {
                console.log(`🔄 Falling back to ${fallback}...`);
                const startTime = Date.now();
                const result = await providerMap[fallback]();
                result.latency = Date.now() - startTime;
                const stat = this.stats.get(fallback);
                stat.success++;
                stat.avgLatency = (stat.avgLatency * (stat.success - 1) + result.latency) / stat.success;
                this.stats.set(fallback, stat);
                return result;
            }
            catch {
                const stat = this.stats.get(fallback);
                stat.fail++;
                this.stats.set(fallback, stat);
                continue;
            }
        }
        console.warn('⚠️ All AI providers failed, using conservative fallback');
        return {
            success: true,
            content: JSON.stringify({
                recommendation: 'HOLD',
                confidence: 50,
                riskLevel: 'MEDIUM',
                reasoning: 'AI providers unavailable, using conservative fallback'
            }),
            latency: 0,
            provider: 'fallback',
            model: 'rule-based'
        };
    }
    // ============ GROQ (Primary - ~88ms) ============
    async queryGroq(prompt) {
        if (!this.API_KEYS.GROQ)
            throw new Error('Groq API key missing');
        const model = prompt.length < 500
            ? 'llama-3.1-8b-instant'
            : 'llama-3.3-70b-versatile';
        const response = await this.groqClient.post(this.ENDPOINTS.groq, {
            model,
            messages: [
                {
                    role: 'system',
                    content: `You are a crypto trading AI for Base Network. 
                              Respond ONLY in JSON format. 
                              Be concise and accurate.
                              For token analysis, return: {"recommendation":"BUY/SELL/HOLD/SKIP","confidence":0-100,"riskLevel":"LOW/MEDIUM/HIGH/CRITICAL","reasoning":"..."}`
                },
                { role: 'user', content: prompt }
            ],
            temperature: 0.3,
            max_tokens: 500,
            response_format: { type: 'json_object' }
        });
        return {
            success: true,
            content: response.data.choices[0].message.content,
            latency: 0,
            provider: 'groq',
            model,
            tokensUsed: response.data.usage?.total_tokens
        };
    }
    // ============ GEMINI (Quality - 1M context) ============
    async queryGemini(prompt) {
        if (!this.API_KEYS.GEMINI)
            throw new Error('Gemini API key missing');
        const url = `${this.ENDPOINTS.gemini}/gemini-2.0-flash:generateContent?key=${this.API_KEYS.GEMINI}`;
        const response = await this.geminiClient.post(url, {
            contents: [{ parts: [{ text: `You are a crypto trading AI. Analyze this and respond in JSON format ONLY: ${prompt}` }] }],
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 500,
                responseMimeType: 'application/json'
            }
        });
        return {
            success: true,
            content: response.data.candidates[0].content.parts[0].text,
            latency: 0,
            provider: 'gemini',
            model: 'gemini-2.0-flash',
            tokensUsed: response.data.usageMetadata?.totalTokenCount
        };
    }
    // ============ HUGGINGFACE (Fallback) ============
    async queryHuggingFace(prompt) {
        if (!this.API_KEYS.HUGGINGFACE)
            throw new Error('HuggingFace API key missing');
        const model = 'meta-llama/Llama-3.1-8B-Instruct';
        const response = await this.huggingfaceClient.post(`${this.ENDPOINTS.huggingface}/${model}`, {
            inputs: prompt,
            parameters: { max_new_tokens: 500, temperature: 0.3, return_full_text: false }
        });
        return {
            success: true,
            content: response.data[0]?.generated_text || '',
            latency: 0,
            provider: 'huggingface',
            model
        };
    }
    // ============ SPECIALIZED METHODS ============
    async analyzeToken(tokenAddress, tokenData) {
        // ── Cache check: avoid redundant AI calls for same token ──
        const cacheKey = tokenAddress.toLowerCase();
        const cached = this.tokenAnalysisCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.result;
        }
        // Rule-based fast path (no AI key needed)
        const ruleResult = this.getRuleBasedRecommendation(tokenData);
        // If AI is unavailable, use rule-based result
        if (!this.API_KEYS.GROQ && !this.API_KEYS.GEMINI && !this.API_KEYS.HUGGINGFACE) {
            return {
                tokenAddress,
                confidence: ruleResult.confidence,
                recommendation: ruleResult.action,
                riskLevel: ruleResult.confidence >= 70 ? 'MEDIUM' : 'HIGH',
                predictedProfit: ruleResult.confidence >= 70 ? 40 : 15,
                reasoning: `Rule-based: ${ruleResult.reasoning}`,
            };
        }
        const ethPrice = await (0, price_oracle_1.getEthPriceUsd)().catch(() => 3000);
        const liquidityUSD = tokenData.liquidity * ethPrice;
        const volOverLiq = liquidityUSD > 0 ? (tokenData.volume1m ?? 0) / liquidityUSD : 0;
        const bsr = tokenData.buySellRatio1m ?? 1;
        const buyTx = tokenData.buyTxH1 ?? 0;
        const sellTx = tokenData.sellTxH1 ?? 0;
        const txRatio = sellTx > 0 ? (buyTx / sellTx).toFixed(2) : buyTx > 0 ? '∞' : 'N/A';
        const fdvRatio = tokenData.fdvUsd && liquidityUSD > 0
            ? (tokenData.fdvUsd / liquidityUSD).toFixed(1) : 'N/A';
        const prompt = `
Anda adalah sniper token microcap profesional di Base Network. Harga ETH saat ini: $${ethPrice.toFixed(0)}.
Analisis token berikut untuk POTENSI PUMP dalam 5-20 menit:

Token: ${tokenAddress}
Usia: ${(tokenData.ageSeconds / 60).toFixed(1)} menit
Likuiditas: $${liquidityUSD.toFixed(0)} (${tokenData.liquidity.toFixed(4)} ETH)
Volume 24h: $${tokenData.volume24h.toFixed(0)}
${tokenData.volume1m !== undefined ? `Volume 1m: $${tokenData.volume1m.toFixed(0)} | Vol/Liq: ${(volOverLiq * 100).toFixed(0)}%` : ''}
${tokenData.buySellRatio1m !== undefined ? `Buy/Sell ratio 1m: ${bsr.toFixed(2)}` : ''}
${buyTx > 0 || sellTx > 0 ? `Tx 1h: ${buyTx} buy / ${sellTx} sell (ratio ${txRatio})` : ''}
${tokenData.priceChangeH1 !== undefined ? `Perubahan harga 1h: ${tokenData.priceChangeH1 >= 0 ? '+' : ''}${tokenData.priceChangeH1.toFixed(1)}%` : ''}
${tokenData.fdvUsd ? `FDV: $${tokenData.fdvUsd.toFixed(0)} | FDV/Liq: ${fdvRatio}x` : ''}
${tokenData.holderCount !== undefined ? `Holder: ${tokenData.holderCount}` : ''}
${tokenData.top10Concentration !== undefined ? `Top 10 konsentrasi: ${tokenData.top10Concentration}%` : ''}

SINYAL KUAT BUY:
✅ Buy pressure nyata: BSR 1m > 2.0 DAN buy Tx 1h > sell Tx
✅ Volume explosion: Vol 1m / Likuiditas > 30%
✅ Momentum positif: price change 1h > +5%
✅ Distribusi sehat: top10 < 40%, FDV/Liq < 20x
✅ Token sangat baru: < 5 menit

SINYAL BAHAYA (langsung SKIP):
🚫 BSR < 0.8 (lebih banyak seller dari buyer)
🚫 Price change 1h < -10% (dump sedang terjadi)
🚫 FDV/Liq > 50x (terlalu overvalued)
🚫 Top10 > 70% (kemungkinan rug)
🚫 Likuiditas < $3000

Berikan skor confidence 0-100 berdasarkan jumlah sinyal kuat yang terpenuhi.
Respond HANYA JSON (tidak ada teks lain):
{"recommendation":"BUY|HOLD|SKIP","confidence":0-100,"riskLevel":"LOW|MEDIUM|HIGH|CRITICAL","predictedProfit":0-200,"reasoning":"max 20 kata"}
`;
        const response = await this.query(prompt, 'groq');
        try {
            const parsed = JSON.parse(response.content);
            const result = {
                tokenAddress,
                confidence: parsed.confidence || 50,
                recommendation: parsed.recommendation || 'HOLD',
                riskLevel: parsed.riskLevel || 'MEDIUM',
                predictedProfit: parsed.predictedProfit || 0,
                reasoning: parsed.reasoning || 'No reasoning provided'
            };
            // Cache result for 5 minutes to conserve free-tier API quotas
            this.tokenAnalysisCache.set(cacheKey, { result, expiresAt: Date.now() + 300000 });
            return result;
        }
        catch {
            const fallback = {
                tokenAddress,
                confidence: 50,
                recommendation: 'HOLD',
                riskLevel: 'MEDIUM',
                predictedProfit: 0,
                reasoning: 'Failed to parse AI response'
            };
            this.tokenAnalysisCache.set(cacheKey, { result: fallback, expiresAt: Date.now() + 10000 });
            return fallback;
        }
    }
    async getMarketSentiment() {
        const prompt = `
            Analyze current Base Network market conditions.
            Return JSON:
            - sentiment: number 0-100 (0=bearish, 100=bullish)
            - gasAdvice: "HOLD" or "TRADE_NOW"
            - bestTime: timestamp or time range for best trading
        `;
        const response = await this.query(prompt, 'groq');
        try {
            return JSON.parse(response.content);
        }
        catch {
            return {
                sentiment: 50,
                gasAdvice: 'HOLD',
                bestTime: new Date().toISOString()
            };
        }
    }
    // ============ HOT-RELOAD KEYS ============
    updateKeys(keys) {
        if (keys.groq) {
            this.API_KEYS.GROQ = keys.groq;
            this.groqClient = axios_1.default.create({
                headers: { 'Authorization': `Bearer ${keys.groq}`, 'Content-Type': 'application/json' },
                timeout: 5000
            });
        }
        if (keys.gemini) {
            this.API_KEYS.GEMINI = keys.gemini;
        }
        if (keys.huggingface) {
            this.API_KEYS.HUGGINGFACE = keys.huggingface;
            this.huggingfaceClient = axios_1.default.create({
                headers: { 'Authorization': `Bearer ${keys.huggingface}`, 'Content-Type': 'application/json' },
                timeout: 15000
            });
        }
        console.log('🔑 AI keys updated:', `Groq=${this.API_KEYS.GROQ ? '✅' : '❌'}`, `Gemini=${this.API_KEYS.GEMINI ? '✅' : '❌'}`, `HuggingFace=${this.API_KEYS.HUGGINGFACE ? '✅' : '❌'}`);
    }
    getKeyStatus() {
        return {
            groq: !!this.API_KEYS.GROQ,
            gemini: !!this.API_KEYS.GEMINI,
            huggingface: !!this.API_KEYS.HUGGINGFACE
        };
    }
    // ============ RULE-BASED FALLBACK ============
    getRuleBasedRecommendation(tokenData) {
        let score = 0;
        const reasons = [];
        // Use cached live ETH price for rule-based (falls back to 3000 before first refresh)
        const ethEst = (0, performance_optimizer_1.getEthPriceSync)() || 3000;
        const liquidityUSD = tokenData.liquidity * ethEst;
        // Liquidity gates
        if (liquidityUSD < 3000)
            return { action: 'HOLD', confidence: 0, reasoning: 'liq terlalu rendah' };
        if (liquidityUSD >= 5000) {
            score += 20;
            reasons.push('liq OK');
        }
        if (liquidityUSD >= 15000) {
            score += 10;
            reasons.push('liq bagus');
        }
        // Buy/sell pressure
        const bsr = tokenData.buySellRatio1m ?? 1;
        if (bsr < 0.8) {
            return { action: 'HOLD', confidence: 0, reasoning: 'lebih banyak seller' };
        }
        if (bsr > 1.5) {
            score += 25;
            reasons.push(`BSR ${bsr.toFixed(1)}`);
        }
        if (bsr > 2.5) {
            score += 15;
            reasons.push('buy pressure kuat');
        }
        // Tx count signal (absolute buy vs sell)
        const buyTx = tokenData.buyTxH1 ?? 0;
        const sellTx = tokenData.sellTxH1 ?? 0;
        if (buyTx > 0 && buyTx > sellTx * 1.5) {
            score += 15;
            reasons.push(`${buyTx}buy/${sellTx}sell`);
        }
        // Volume over liquidity
        const volOverLiq = tokenData.volume1m ? tokenData.volume1m / Math.max(liquidityUSD, 1) : 0;
        if (volOverLiq > 0.3) {
            score += 20;
            reasons.push('vol/liq tinggi');
        }
        if (volOverLiq > 0.8) {
            score += 10;
            reasons.push('vol explosion');
        }
        // Price momentum
        const pch1 = tokenData.priceChangeH1 ?? 0;
        if (pch1 > 10) {
            score += 10;
            reasons.push(`+${pch1.toFixed(0)}% 1h`);
        }
        if (pch1 < -15) {
            score -= 20;
            reasons.push('dump 1h');
        }
        // FDV / liquidity ratio (lower = better)
        if (tokenData.fdvUsd && liquidityUSD > 0) {
            const fdvRatio = tokenData.fdvUsd / liquidityUSD;
            if (fdvRatio < 10) {
                score += 10;
                reasons.push('FDV OK');
            }
            if (fdvRatio > 50) {
                score -= 15;
                reasons.push('FDV terlalu tinggi');
            }
        }
        // Holder distribution
        const holders = tokenData.holderCount ?? 0;
        if (holders > 50) {
            score += 10;
            reasons.push(`${holders} holders`);
        }
        if (holders > 200) {
            score += 5;
        }
        // Concentration
        const conc = tokenData.top10Concentration ?? 100;
        if (conc < 40) {
            score += 10;
            reasons.push('spread baik');
        }
        if (conc > 70) {
            score -= 20;
            reasons.push('terkonsentrasi!');
        }
        // Token freshness
        if (tokenData.ageSeconds < 60) {
            score += 10;
            reasons.push('sangat baru');
        }
        if (tokenData.ageSeconds < 180) {
            score += 5;
        }
        if (tokenData.ageSeconds > 300) {
            score -= 15;
            reasons.push('sudah lama');
        }
        score = Math.max(0, Math.min(100, score));
        return {
            action: score >= 55 ? 'BUY' : 'HOLD',
            confidence: score,
            reasoning: reasons.join(', ') || 'sinyal tidak cukup',
        };
    }
    // ============ MONITORING ============
    getStats() {
        const now = Date.now();
        const providerKeys = ['groq', 'gemini', 'huggingface'];
        const providers = {};
        for (const p of providerKeys) {
            const s = this.stats.get(p);
            const coolUntil = this.providerCooldown.get(p) ?? 0;
            providers[p] = {
                ...s,
                hasKey: !!(this.API_KEYS[p.toUpperCase()]),
                onCooldown: now < coolUntil,
                cooldownUntil: coolUntil,
                cooldownSecsLeft: now < coolUntil ? Math.ceil((coolUntil - now) / 1000) : 0,
            };
        }
        return {
            providers,
            currentProvider: this.currentProvider,
            timestamp: now,
        };
    }
    healthCheck() {
        return {
            groq: !!this.API_KEYS.GROQ,
            gemini: !!this.API_KEYS.GEMINI,
            huggingface: !!this.API_KEYS.HUGGINGFACE,
        };
    }
}
exports.MultiAIProvider = MultiAIProvider;
exports.default = MultiAIProvider;
//# sourceMappingURL=multi-ai-provider.js.map