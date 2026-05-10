import axios, { AxiosInstance } from 'axios';

// ============ TYPES ============
export type AIProvider = 'groq' | 'gemini' | 'huggingface';

export interface AIResponse {
    success: boolean;
    content: string;
    latency: number;
    provider: AIProvider | 'fallback';
    model: string;
    tokensUsed?: number;
}

export interface TokenAnalysis {
    tokenAddress: string;
    confidence: number;
    recommendation: 'BUY' | 'SELL' | 'HOLD' | 'SKIP';
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    predictedProfit: number;
    reasoning: string;
}

export interface WalletAnalysis {
    address: string;
    score: number;
    tradingPattern: 'SCALPER' | 'SNIPER' | 'WHALE' | 'SWING';
    shouldCopy: boolean;
    reason: string;
}

// ============ MAIN AI PROVIDER CLASS ============
export class MultiAIProvider {
    private groqClient: AxiosInstance;
    private geminiClient: AxiosInstance;
    private huggingfaceClient: AxiosInstance;
    private currentProvider: AIProvider = 'groq';
    private stats: Map<AIProvider, { success: number; fail: number; avgLatency: number }> = new Map();

    private API_KEYS = {
        GROQ: process.env.GROQ_API_KEY || '',
        GEMINI: process.env.GEMINI_API_KEY || '',
        HUGGINGFACE: process.env.HUGGINGFACE_API_KEY || ''
    };

    private readonly ENDPOINTS = {
        groq: 'https://api.groq.com/openai/v1/chat/completions',
        gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
        huggingface: 'https://api-inference.huggingface.co/models'
    };

    constructor() {
        this.groqClient = axios.create({
            headers: {
                'Authorization': `Bearer ${this.API_KEYS.GROQ}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });

        this.geminiClient = axios.create({ timeout: 10000 });

        this.huggingfaceClient = axios.create({
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
        console.log(`   Groq:         ${this.API_KEYS.GROQ        ? '✅ set' : '❌ missing'}`);
        console.log(`   Gemini:       ${this.API_KEYS.GEMINI       ? '✅ set' : '❌ missing'}`);
        console.log(`   HuggingFace:  ${this.API_KEYS.HUGGINGFACE  ? '✅ set' : '❌ missing'}`);
    }

    // ============ CORE METHOD ============
    async query(prompt: string, preferredProvider?: AIProvider): Promise<AIResponse> {
        const provider = preferredProvider || this.selectBestProvider(prompt);
        console.log(`🧠 AI Query [${provider}] (${prompt.length} chars)`);
        const startTime = Date.now();

        try {
            let response: AIResponse;

            switch (provider) {
                case 'groq':        response = await this.queryGroq(prompt);         break;
                case 'gemini':      response = await this.queryGemini(prompt);       break;
                case 'huggingface': response = await this.queryHuggingFace(prompt);  break;
                default:            response = await this.queryGroq(prompt);
            }

            response.latency = Date.now() - startTime;

            const stat = this.stats.get(provider)!;
            stat.success++;
            stat.avgLatency = (stat.avgLatency * (stat.success - 1) + response.latency) / stat.success;
            this.stats.set(provider, stat);

            if (provider === 'groq' && response.success) {
                this.currentProvider = 'groq';
            }

            return response;

        } catch (error) {
            const stat = this.stats.get(provider)!;
            stat.fail++;
            this.stats.set(provider, stat);
            console.error(`❌ AI [${provider}] failed:`, error);
            return this.fallbackQuery(prompt, provider);
        }
    }

    private selectBestProvider(prompt: string): AIProvider {
        if (prompt.includes('detect') || prompt.includes('pool') || prompt.includes('transaction')) {
            return 'groq';
        }

        if (prompt.includes('wallet') || prompt.includes('analyze') || prompt.includes('pattern')) {
            if (this.API_KEYS.GEMINI && this.stats.get('gemini')!.fail < 3) {
                return 'gemini';
            }
            return 'groq';
        }

        if (this.stats.get('groq')!.fail > 5) return 'gemini';
        return this.currentProvider;
    }

    // Call private provider methods directly to avoid infinite recursion
    private async fallbackQuery(originalPrompt: string, failedProvider: AIProvider): Promise<AIResponse> {
        const providerMap: Record<AIProvider, () => Promise<AIResponse>> = {
            groq:         () => this.queryGroq(originalPrompt),
            gemini:       () => this.queryGemini(originalPrompt),
            huggingface:  () => this.queryHuggingFace(originalPrompt)
        };

        const fallbacks = (['groq', 'gemini', 'huggingface'] as AIProvider[]).filter(p => p !== failedProvider);

        for (const fallback of fallbacks) {
            try {
                console.log(`🔄 Falling back to ${fallback}...`);
                const startTime = Date.now();
                const result = await providerMap[fallback]();
                result.latency = Date.now() - startTime;

                const stat = this.stats.get(fallback)!;
                stat.success++;
                stat.avgLatency = (stat.avgLatency * (stat.success - 1) + result.latency) / stat.success;
                this.stats.set(fallback, stat);

                return result;
            } catch {
                const stat = this.stats.get(fallback)!;
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
    private async queryGroq(prompt: string): Promise<AIResponse> {
        if (!this.API_KEYS.GROQ) throw new Error('Groq API key missing');

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
    private async queryGemini(prompt: string): Promise<AIResponse> {
        if (!this.API_KEYS.GEMINI) throw new Error('Gemini API key missing');

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
    private async queryHuggingFace(prompt: string): Promise<AIResponse> {
        if (!this.API_KEYS.HUGGINGFACE) throw new Error('HuggingFace API key missing');

        const model = 'meta-llama/Llama-3.1-8B-Instruct';

        const response = await this.huggingfaceClient.post(
            `${this.ENDPOINTS.huggingface}/${model}`,
            {
                inputs: prompt,
                parameters: { max_new_tokens: 500, temperature: 0.3, return_full_text: false }
            }
        );

        return {
            success: true,
            content: response.data[0]?.generated_text || '',
            latency: 0,
            provider: 'huggingface',
            model
        };
    }

    // ============ SPECIALIZED METHODS ============
    async analyzeToken(tokenAddress: string, tokenData: {
        liquidity: number;
        volume24h: number;
        ageSeconds: number;
        buySellRatio1m?: number;
        volume1m?: number;
        holderCount?: number;
        top10Concentration?: number;
    }): Promise<TokenAnalysis> {
        // Rule-based fast path (no AI key needed)
        const ruleResult = this.getRuleBasedRecommendation(tokenData);

        // If AI is unavailable, use rule-based result
        if (!this.API_KEYS.GROQ && !this.API_KEYS.GEMINI && !this.API_KEYS.HUGGINGFACE) {
            return {
                tokenAddress,
                confidence:     ruleResult.confidence,
                recommendation: ruleResult.action as any,
                riskLevel:      ruleResult.confidence >= 70 ? 'MEDIUM' : 'HIGH',
                predictedProfit: ruleResult.confidence >= 70 ? 40 : 15,
                reasoning:      `Rule-based: ${ruleResult.reasoning}`,
            };
        }

        const liquidityUSD = tokenData.liquidity * 3000;
        const prompt = `
Anda adalah sniper token microcap profesional dengan modal kecil di Base Network.
Analisis token ini untuk POTENSI PUMP CEPAT (10-20 menit):

Token: ${tokenAddress}
Usia: ${Math.round(tokenData.ageSeconds)} detik (${(tokenData.ageSeconds / 60).toFixed(1)} menit)
Likuiditas: $${liquidityUSD.toFixed(0)} (${tokenData.liquidity.toFixed(4)} ETH)
Volume 24h: $${tokenData.volume24h.toFixed(0)}
${tokenData.volume1m !== undefined ? `Volume 1m: $${tokenData.volume1m.toFixed(0)}` : ''}
${tokenData.buySellRatio1m !== undefined ? `Buy/Sell ratio 1m: ${tokenData.buySellRatio1m.toFixed(2)}` : ''}
${tokenData.holderCount !== undefined ? `Holder: ${tokenData.holderCount}` : ''}
${tokenData.top10Concentration !== undefined ? `Top 10 konsentrasi: ${tokenData.top10Concentration}%` : ''}

KRITERIA BUY (cek 3 dari 4):
1. Ada buy pressure? (buy/sell ratio > 1.5 di 1 menit)
2. Market making aktif? (volume/liquidity > 0.3)
3. Tidak ada sell wall? (sell orders < 2x buy orders)
4. Tidak terpusat? (top 10 concentration < 40%)

Jika 3+ terpenuhi → BUY confidence 70-100
Jika 2 terpenuhi → BUY confidence 50-70
Jika 1 atau kurang → HOLD

Respond JSON (WAJIB HANYA JSON):
{"recommendation":"BUY|HOLD|SKIP","confidence":0-100,"riskLevel":"LOW|MEDIUM|HIGH|CRITICAL","predictedProfit":0-200,"reasoning":"singkat"}

Gunakan SKIP jika token terlalu berisiko atau tidak memenuhi kriteria minimum.
`;

        const response = await this.query(prompt, 'groq');

        try {
            const parsed = JSON.parse(response.content);
            return {
                tokenAddress,
                confidence:      parsed.confidence      || 50,
                recommendation:  parsed.recommendation  || 'HOLD',
                riskLevel:       parsed.riskLevel        || 'MEDIUM',
                predictedProfit: parsed.predictedProfit  || 0,
                reasoning:       parsed.reasoning        || 'No reasoning provided'
            };
        } catch {
            return {
                tokenAddress,
                confidence: 50,
                recommendation: 'HOLD',
                riskLevel: 'MEDIUM',
                predictedProfit: 0,
                reasoning: 'Failed to parse AI response'
            };
        }
    }

    async analyzeWallet(walletAddress: string, walletHistory: {
        totalTrades: number;
        winRate: number;
        avgHoldTime: number;
        avgProfit: number;
    }): Promise<WalletAnalysis> {
        const prompt = `
            Analyze this wallet's trading pattern on Base Network:
            Address: ${walletAddress}
            Total Trades: ${walletHistory.totalTrades}
            Win Rate: ${walletHistory.winRate}%
            Avg Hold Time: ${walletHistory.avgHoldTime}s
            Avg Profit: ${walletHistory.avgProfit}%

            Return JSON:
            - score: number 0-100 (how good to copy)
            - tradingPattern: "SCALPER", "SNIPER", "WHALE", or "SWING"
            - shouldCopy: boolean
            - reason: string
        `;

        const response = await this.query(prompt, 'gemini');

        try {
            const parsed = JSON.parse(response.content);
            return {
                address:        walletAddress,
                score:          parsed.score          || 50,
                tradingPattern: parsed.tradingPattern  || 'SWING',
                shouldCopy:     parsed.shouldCopy      || false,
                reason:         parsed.reason          || 'No reason provided'
            };
        } catch {
            return {
                address: walletAddress,
                score: 50,
                tradingPattern: 'SWING',
                shouldCopy: false,
                reason: 'AI analysis failed'
            };
        }
    }

    async getMarketSentiment(): Promise<{ sentiment: number; gasAdvice: string; bestTime: string }> {
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
        } catch {
            return {
                sentiment: 50,
                gasAdvice: 'HOLD',
                bestTime: new Date().toISOString()
            };
        }
    }

    // ============ HOT-RELOAD KEYS ============
    updateKeys(keys: { groq?: string; gemini?: string; huggingface?: string }): void {
        if (keys.groq) {
            this.API_KEYS.GROQ = keys.groq;
            this.groqClient = axios.create({
                headers: { 'Authorization': `Bearer ${keys.groq}`, 'Content-Type': 'application/json' },
                timeout: 5000
            });
        }
        if (keys.gemini) {
            this.API_KEYS.GEMINI = keys.gemini;
        }
        if (keys.huggingface) {
            this.API_KEYS.HUGGINGFACE = keys.huggingface;
            this.huggingfaceClient = axios.create({
                headers: { 'Authorization': `Bearer ${keys.huggingface}`, 'Content-Type': 'application/json' },
                timeout: 15000
            });
        }
        console.log('🔑 AI keys updated:',
            `Groq=${this.API_KEYS.GROQ ? '✅' : '❌'}`,
            `Gemini=${this.API_KEYS.GEMINI ? '✅' : '❌'}`,
            `HuggingFace=${this.API_KEYS.HUGGINGFACE ? '✅' : '❌'}`
        );
    }

    getKeyStatus(): { groq: boolean; gemini: boolean; huggingface: boolean } {
        return {
            groq:         !!this.API_KEYS.GROQ,
            gemini:       !!this.API_KEYS.GEMINI,
            huggingface:  !!this.API_KEYS.HUGGINGFACE
        };
    }

    // ============ RULE-BASED FALLBACK ============
    getRuleBasedRecommendation(tokenData: {
        liquidity: number;
        volume24h: number;
        ageSeconds: number;
        buySellRatio1m?: number;
        volume1m?: number;
        holderCount?: number;
        top10Concentration?: number;
    }): { action: 'BUY' | 'HOLD'; confidence: number; reasoning: string } {
        let score = 0;
        const reasons: string[] = [];

        const liquidityUSD = tokenData.liquidity * 3000;
        if (liquidityUSD >= 5000)  { score += 20; reasons.push('liq OK'); }
        if (liquidityUSD >= 10000) { score += 10; reasons.push('liq good'); }

        const bsr = tokenData.buySellRatio1m ?? 1;
        if (bsr > 1.5) { score += 30; reasons.push(`BSR ${bsr.toFixed(1)}`); }
        if (bsr > 2.5) { score += 20; }

        const volOverLiq = tokenData.volume1m ? tokenData.volume1m / Math.max(liquidityUSD, 1) : 0;
        if (volOverLiq > 0.3) { score += 25; reasons.push('vol/liq high'); }

        const holders = tokenData.holderCount ?? 0;
        if (holders > 100) { score += 15; reasons.push(`${holders} holders`); }

        const conc = tokenData.top10Concentration ?? 100;
        if (conc < 40) { score += 10; reasons.push('spread OK'); }
        if (conc > 70) { score -= 20; reasons.push('concentrated!'); }

        if (tokenData.ageSeconds < 60)  { score += 10; reasons.push('very fresh'); }
        if (tokenData.ageSeconds > 300) { score -= 15; reasons.push('stale'); }

        score = Math.max(0, Math.min(100, score));

        return {
            action:     score >= 55 ? 'BUY' : 'HOLD',
            confidence: score,
            reasoning:  reasons.join(', ') || 'not enough signals',
        };
    }

    // ============ MONITORING ============
    getStats() {
        return {
            providers: {
                groq:         this.stats.get('groq'),
                gemini:       this.stats.get('gemini'),
                huggingface:  this.stats.get('huggingface')
            },
            currentProvider: this.currentProvider,
            timestamp: Date.now()
        };
    }

    async healthCheck(): Promise<Record<AIProvider, boolean>> {
        const results: Record<AIProvider, boolean> = {
            groq: false,
            gemini: false,
            huggingface: false
        };

        await Promise.allSettled([
            this.queryGroq('Return {"test": "ok"}').then(() => { results.groq = true; }),
            this.queryGemini('Return {"test": "ok"}').then(() => { results.gemini = true; }),
            this.queryHuggingFace('Return {"test": "ok"}').then(() => { results.huggingface = true; })
        ]);

        return results;
    }
}

export default MultiAIProvider;
