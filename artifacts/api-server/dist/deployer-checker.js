"use strict";
/**
 * deployer-checker.ts
 *
 * Serial rugger detection: checks how many contracts a token's deployer
 * has created within a rolling time window.
 *
 * Uses Blockscout's free API (no key required) with local caching
 * to avoid blocking trades on rate limits.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTokenDeployer = getTokenDeployer;
exports.checkSerialDeployer = checkSerialDeployer;
const axios_1 = __importDefault(require("axios"));
const BLOCKSCOUT = 'https://base.blockscout.com/api';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
// ── Caches ────────────────────────────────────────────────────────────────────
// token address → deployer address
const deployerCache = new Map();
// deployer:windowHours → deploy count
const countCache = new Map();
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
// ── Public: get who deployed a given token contract (exported for reuse) ──────
async function getTokenDeployer(tokenAddress) {
    const key = tokenAddress.toLowerCase();
    const cached = deployerCache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL)
        return cached.deployer;
    try {
        const res = await axios_1.default.get(`${BLOCKSCOUT}/v2/addresses/${tokenAddress}`, {
            timeout: 5000
        });
        const deployer = res.data?.creator_address_hash;
        if (deployer) {
            const d = deployer.toLowerCase();
            pruneCache(deployerCache);
            deployerCache.set(key, { deployer: d, ts: Date.now() });
            return d;
        }
    }
    catch {
        // Blockscout unreachable — fail-open
    }
    return null;
}
// ── Internal: count recent contract deployments from an address ───────────────
async function countRecentDeploys(deployer, windowHours) {
    const key = `${deployer.toLowerCase()}:${windowHours}`;
    const cached = countCache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL)
        return cached.count;
    const cutoff = Math.floor((Date.now() - windowHours * 3600000) / 1000);
    try {
        const res = await axios_1.default.get(BLOCKSCOUT, {
            params: {
                module: 'account',
                action: 'txlist',
                address: deployer,
                sort: 'desc',
                page: 1,
                offset: 100
            },
            timeout: 7000
        });
        const txs = res.data?.result ?? [];
        const count = txs.filter(tx => 
        // contract creation = empty or null "to" field
        (!tx.to || tx.to === '' || tx.to === '0x') &&
            parseInt(tx.timeStamp ?? '0', 10) >= cutoff).length;
        pruneCache(countCache);
        countCache.set(key, { count, ts: Date.now() });
        return count;
    }
    catch {
        return null; // API error → fail-open
    }
}
// ── Public: full serial rugger check ─────────────────────────────────────────
async function checkSerialDeployer(tokenAddress, maxDeploys, windowHours) {
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
        deployCount: count,
        isSerialRugger: count > maxDeploys,
        windowHours,
        skipped: false
    };
}
//# sourceMappingURL=deployer-checker.js.map