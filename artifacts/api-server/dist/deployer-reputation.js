"use strict";
/**
 * deployer-reputation.ts
 *
 * Scores a deployer wallet's reputation based on the survival rate of their
 * previously deployed tokens. Tokens are checked against GeckoTerminal — still
 * trading with meaningful liquidity = alive, zero liquidity = likely rug.
 *
 * Score 0-100:
 *   ≥ 65  → trusted
 *   35-64 → neutral
 *   < 35  → risky
 *   null  → unknown (fewer than 2 tokens checked, fail-open)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeployerReputation = getDeployerReputation;
exports.getReputationForToken = getReputationForToken;
const axios_1 = __importDefault(require("axios"));
const deployer_checker_1 = require("./deployer-checker");
const BLOCKSCOUT = 'https://base.blockscout.com/api';
const GT_TOKEN_URL = 'https://api.geckoterminal.com/api/v2/networks/base/tokens/';
const CACHE_TTL = 30 * 60 * 1000; // 30 min
const reputationCache = new Map();
const MAX_CACHE_SIZE = 1000;
function pruneCache(cache) {
    if (cache.size <= MAX_CACHE_SIZE)
        return;
    const n = Math.floor(MAX_CACHE_SIZE * 0.1);
    let i = 0;
    for (const k of cache.keys()) {
        if (++i > n)
            break;
        cache.delete(k);
    }
}
async function getDeployerTokenContracts(deployerAddress, limit = 10) {
    try {
        const res = await axios_1.default.get(BLOCKSCOUT, {
            params: {
                module: 'account',
                action: 'txlist',
                address: deployerAddress,
                sort: 'desc',
                page: 1,
                offset: 100
            },
            timeout: 7000
        });
        const txs = res.data?.result ?? [];
        return txs
            .filter(tx => (!tx.to || tx.to === '' || tx.to === '0x') && tx.contractAddress)
            .slice(0, limit)
            .map(tx => tx.contractAddress.toLowerCase());
    }
    catch {
        return [];
    }
}
async function checkToken(tokenAddress) {
    try {
        // Use GeckoTerminal instead of DexScreener
        const res = await axios_1.default.get(`${GT_TOKEN_URL}${tokenAddress}/pools?page=1`, {
            timeout: 4000,
            headers: { 'Accept': 'application/json;version=20230302' }
        });
        const pools = res.data?.data ?? [];
        const basePools = pools.filter((p) => {
            const id = p.id || '';
            return id.startsWith('base_');
        });
        if (basePools.length === 0) {
            return { address: tokenAddress, alive: false, liquidityUsd: 0 };
        }
        basePools.sort((a, b) => {
            const aLiq = parseFloat(a.attributes?.reserve_in_usd ?? '0') || 0;
            const bLiq = parseFloat(b.attributes?.reserve_in_usd ?? '0') || 0;
            return bLiq - aLiq;
        });
        const main = basePools[0];
        const totalLiquidity = basePools.reduce((sum, p) => sum + (parseFloat(p.attributes?.reserve_in_usd ?? '0') || 0), 0);
        // Try to get token name/symbol from included data or pool name
        const poolName = main.attributes?.name || '';
        const parts = poolName.split(' / ');
        const symbol = parts[0] || '';
        return {
            address: tokenAddress,
            alive: totalLiquidity >= 500,
            liquidityUsd: Math.round(totalLiquidity),
            tokenSymbol: symbol,
            pairUrl: `https://www.geckoterminal.com/base/pools/${main.attributes?.address || ''}`,
        };
    }
    catch {
        return { address: tokenAddress, alive: null, liquidityUsd: 0 };
    }
}
async function getDeployerReputation(deployerAddress) {
    const key = deployerAddress.toLowerCase();
    const cached = reputationCache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL)
        return cached.result;
    const UNKNOWN = {
        score: null, label: 'unknown', totalTokens: 0,
        aliveTokens: 0, deadTokens: 0, deployer: key,
        skipped: true, checkedAt: Date.now(), tokenChecks: []
    };
    const contracts = await getDeployerTokenContracts(key);
    if (contracts.length === 0) {
        pruneCache(reputationCache);
        reputationCache.set(key, { result: UNKNOWN, ts: Date.now() });
        return UNKNOWN;
    }
    const toCheck = contracts.slice(0, 5);
    const tokenChecks = await Promise.all(toCheck.map(checkToken));
    let aliveTokens = 0;
    let deadTokens = 0;
    for (const tc of tokenChecks) {
        if (tc.alive === true)
            aliveTokens++;
        else if (tc.alive === false)
            deadTokens++;
    }
    const checked = aliveTokens + deadTokens;
    let score = null;
    let label = 'unknown';
    if (checked >= 2) {
        score = Math.max(0, Math.min(100, 50 + (aliveTokens * 15) - (deadTokens * 20)));
        label = score >= 65 ? 'trusted' : score >= 35 ? 'neutral' : 'risky';
    }
    const rep = {
        score,
        label,
        totalTokens: contracts.length,
        aliveTokens,
        deadTokens,
        deployer: key,
        skipped: false,
        checkedAt: Date.now(),
        tokenChecks
    };
    pruneCache(reputationCache);
    reputationCache.set(key, { result: rep, ts: Date.now() });
    return rep;
}
async function getReputationForToken(tokenAddress) {
    const deployer = await (0, deployer_checker_1.getTokenDeployer)(tokenAddress);
    if (!deployer) {
        return {
            score: null, label: 'unknown', totalTokens: 0,
            aliveTokens: 0, deadTokens: 0, deployer: tokenAddress.toLowerCase(),
            skipped: true, checkedAt: Date.now(), tokenChecks: []
        };
    }
    return getDeployerReputation(deployer);
}
//# sourceMappingURL=deployer-reputation.js.map