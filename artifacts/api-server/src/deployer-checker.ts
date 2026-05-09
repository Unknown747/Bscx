/**
 * deployer-checker.ts
 *
 * Serial rugger detection: checks how many contracts a token's deployer
 * has created within a rolling time window.
 *
 * Uses Blockscout's free API (no key required) with local caching
 * to avoid blocking trades on rate limits.
 */

import axios from 'axios';

const BLOCKSCOUT = 'https://base.blockscout.com/api';
const CACHE_TTL  = 5 * 60 * 1000; // 5 minutes

export interface DeployerCheckResult {
    deployer:       string | null;
    deployCount:    number;
    isSerialRugger: boolean;
    windowHours:    number;
    skipped:        boolean; // true when API was unreachable
}

// ── Caches ────────────────────────────────────────────────────────────────────
// token address → deployer address
const deployerCache = new Map<string, { deployer: string; ts: number }>();
// deployer:windowHours → deploy count
const countCache    = new Map<string, { count: number; ts: number }>();

// ── Public: get who deployed a given token contract (exported for reuse) ──────
export async function getTokenDeployer(tokenAddress: string): Promise<string | null> {
    const key    = tokenAddress.toLowerCase();
    const cached = deployerCache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.deployer;

    try {
        const res = await axios.get(`${BLOCKSCOUT}/v2/addresses/${tokenAddress}`, {
            timeout: 5000
        });
        const deployer: string | undefined = res.data?.creator_address_hash;
        if (deployer) {
            const d = deployer.toLowerCase();
            deployerCache.set(key, { deployer: d, ts: Date.now() });
            return d;
        }
    } catch {
        // Blockscout unreachable — fail-open
    }
    return null;
}

// ── Internal: count recent contract deployments from an address ───────────────
async function countRecentDeploys(deployer: string, windowHours: number): Promise<number | null> {
    const key    = `${deployer.toLowerCase()}:${windowHours}`;
    const cached = countCache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.count;

    const cutoff = Math.floor((Date.now() - windowHours * 3_600_000) / 1000);

    try {
        const res = await axios.get(BLOCKSCOUT, {
            params: {
                module:  'account',
                action:  'txlist',
                address: deployer,
                sort:    'desc',
                page:    1,
                offset:  100
            },
            timeout: 7000
        });

        const txs: any[] = res.data?.result ?? [];
        const count = txs.filter(tx =>
            // contract creation = empty or null "to" field
            (!tx.to || tx.to === '' || tx.to === '0x') &&
            parseInt(tx.timeStamp ?? '0', 10) >= cutoff
        ).length;

        countCache.set(key, { count, ts: Date.now() });
        return count;
    } catch {
        return null; // API error → fail-open
    }
}

// ── Public: full serial rugger check ─────────────────────────────────────────
export async function checkSerialDeployer(
    tokenAddress:   string,
    maxDeploys:     number,
    windowHours:    number
): Promise<DeployerCheckResult> {
    const deployer = await getTokenDeployer(tokenAddress);

    if (!deployer) {
        // Can't determine deployer → skip check, don't block trade
        return { deployer: null, deployCount: 0, isSerialRugger: false, windowHours, skipped: true };
    }

    const count = await countRecentDeploys(deployer, windowHours);

    if (count === null) {
        // API unreachable → fail-open
        return { deployer, deployCount: 0, isSerialRugger: false, windowHours, skipped: true };
    }

    return {
        deployer,
        deployCount:    count,
        isSerialRugger: count > maxDeploys,
        windowHours,
        skipped:        false
    };
}
