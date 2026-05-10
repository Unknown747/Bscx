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
export declare class MultiAIProvider {
    private groqClient;
    private geminiClient;
    private huggingfaceClient;
    private currentProvider;
    private stats;
    private API_KEYS;
    private readonly ENDPOINTS;
    constructor();
    query(prompt: string, preferredProvider?: AIProvider): Promise<AIResponse>;
    private selectBestProvider;
    private fallbackQuery;
    private queryGroq;
    private queryGemini;
    private queryHuggingFace;
    private tokenAnalysisCache;
    analyzeToken(tokenAddress: string, tokenData: {
        liquidity: number;
        volume24h: number;
        ageSeconds: number;
        buySellRatio1m?: number;
        volume1m?: number;
        holderCount?: number;
        top10Concentration?: number;
        priceChangeH1?: number;
        buyTxH1?: number;
        sellTxH1?: number;
        fdvUsd?: number;
    }): Promise<TokenAnalysis>;
    analyzeWallet(walletAddress: string, walletHistory: {
        totalTrades: number;
        winRate: number;
        avgHoldTime: number;
        avgProfit: number;
    }): Promise<WalletAnalysis>;
    getMarketSentiment(): Promise<{
        sentiment: number;
        gasAdvice: string;
        bestTime: string;
    }>;
    updateKeys(keys: {
        groq?: string;
        gemini?: string;
        huggingface?: string;
    }): void;
    getKeyStatus(): {
        groq: boolean;
        gemini: boolean;
        huggingface: boolean;
    };
    getRuleBasedRecommendation(tokenData: {
        liquidity: number;
        volume24h: number;
        ageSeconds: number;
        buySellRatio1m?: number;
        volume1m?: number;
        holderCount?: number;
        top10Concentration?: number;
        priceChangeH1?: number;
        buyTxH1?: number;
        sellTxH1?: number;
        fdvUsd?: number;
    }): {
        action: 'BUY' | 'HOLD';
        confidence: number;
        reasoning: string;
    };
    getStats(): {
        providers: {
            groq: {
                success: number;
                fail: number;
                avgLatency: number;
            } | undefined;
            gemini: {
                success: number;
                fail: number;
                avgLatency: number;
            } | undefined;
            huggingface: {
                success: number;
                fail: number;
                avgLatency: number;
            } | undefined;
        };
        currentProvider: AIProvider;
        timestamp: number;
    };
    healthCheck(): Promise<Record<AIProvider, boolean>>;
}
export default MultiAIProvider;
//# sourceMappingURL=multi-ai-provider.d.ts.map