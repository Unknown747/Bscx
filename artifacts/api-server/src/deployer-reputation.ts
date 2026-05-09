/**
 * deployer-reputation.ts
 *
 * Scores a deployer wallet's reputation based on the survival rate of their
 * previously deployed tokens. Tokens are checked against DexScreener — still
 * trading with meaningful liquidity = alive, zero liquidity = likely rug.
 *
 * Score 0-100:
 *   ≥ 65  → trusted
 *   35-64 → neutral
 *   < 35  → risky
 *   null  → unknown (fewer than 2 tokens checked, fail-open)
 *
 * All results are cached for 30 minutes to minimise API calls.
 */

import axios from 'axios';
import { getTokenDeployer } from './deployer-checker';

const BLOCKSCOUT      = 'https://base.blockscout.com/api';
const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens/';
const CACHE_TTL       = 30 * 60 * 1000; // 30 min

export interface ReputationResult {
    score:       number | null;          // 0-100, or null = not enough data
    label:       'trusted' | 'neutral' | 'risky' | 'unknown';
    totalTokens: number;                 // total contracts deployed by this wallet
    aliveTokens: number;                 // tokens with active liquidity > $500
    deadTokens:  number;                 // tokens with zero/dust liquidity
    deployer:    string;                 // the deployer address scored
    skipped:     boolean;                // true when API was unreachable
    checkedAt:   number;
}

// ── Cache: deployer address → result ─────────────────────────────────────────
const reputationCache = new Map<string, { result: ReputationResult; ts: number }>();

// ── Internal: list token contracts deployed by an address ────────────────────
async function getDeployerTokenContracts(deployerAddress: string, limit = 10): Promise<string[]> {
    try {
        const res = await axios.get(BLOCKSCOUT, {
            params: {
                module:  'account',
                action:  'txlist',
                address: deployerAddress,
                sort:    'desc',
                page:    1,
                offset:  100
            },
            timeout: 7000
        });

        const txs: any[] = res.data?.result ?? [];
        return txs
            .filter(tx => (!tx.to || tx.to === '' || tx.to === '0x') && tx.contractAddress)
            .slice(0, limit)
            .map(tx => (tx.contractAddress as string).toLowerCase());
    } catch {
        return [];
    }
}

// ── Internal: check if a token still has active liquidity on Base ─────────────
async function isTokenAlive(tokenAddress: string): Promise<boolean | null> {
    try {
        const res = await axios.get(`${DEXSCREENER_URL}${tokenAddress}`, {
            timeout: 4000
        });

        const pairs: any[] = res.data?.pairs ?? [];
        const basePairs = pairs.filter((p: any) => p.chainId === 'base');

        if (basePairs.length === 0) return false;  // no pairs = likely rug

        const totalLiquidity = basePairs.reduce((sum: number, p: any) => {
            return sum + (parseFloat(p.liquidity?.usd ?? '0') || 0);
        }, 0);

        return totalLiquidity >= 500; // $500 threshold — dead rugs have $0
    } catch {
        return null; // API error — skip this token
    }
}

// ── Public: compute or return cached reputation for a deployer address ────────
export async function getDeployerReputation(deployerAddress: string): Promise<ReputationResult> {
    const key    = deployerAddress.toLowerCase();
    const cached = reputationCache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.result;

    const UNKNOWN: ReputationResult = {
        score: null, label: 'unknown', totalTokens: 0,
        aliveTokens: 0, deadTokens: 0, deployer: key,
        skipped: true, checkedAt: Date.now()
    };

    const contracts = await getDeployerTokenContracts(key);

    if (contracts.length === 0) {
        reputationCache.set(key, { result: UNKNOWN, ts: Date.now() });
        return UNKNOWN;
    }

    // Check up to 5 most recent token contracts in parallel
    const toCheck  = contracts.slice(0, 5);
    const checks   = await Promise.all(toCheck.map(isTokenAlive));

    let aliveTokens = 0;
    let deadTokens  = 0;
    for (const result of checks) {
        if (result === true)  aliveTokens++;
        else if (result === false) deadTokens++;
        // null = API error → skip
    }

    const checked = aliveTokens + deadTokens;

    let score: number | null = null;
    let label: ReputationResult['label'] = 'unknown';

    if (checked >= 2) {
        // Base 50 + 15 per alive token − 20 per dead token, clamped 0-100
        score = Math.max(0, Math.min(100, 50 + (aliveTokens * 15) - (deadTokens * 20)));
        label = score >= 65 ? 'trusted' : score >= 35 ? 'neutral' : 'risky';
    }

    const rep: ReputationResult = {
        score,
        label,
        totalTokens: contracts.length,
        aliveTokens,
        deadTokens,
        deployer:   key,
        skipped:    false,
        checkedAt:  Date.now()
    };

    reputationCache.set(key, { result: rep, ts: Date.now() });
    return rep;
}

// ── Convenience: resolve token address → deployer → reputation ────────────────
export async function getReputationForToken(tokenAddress: string): Promise<ReputationResult> {
    const deployer = await getTokenDeployer(tokenAddress);
    if (!deployer) {
        return {
            score: null, label: 'unknown', totalTokens: 0,
            aliveTokens: 0, deadTokens: 0, deployer: tokenAddress.toLowerCase(),
            skipped: true, checkedAt: Date.now()
        };
    }
    return getDeployerReputation(deployer);
}
