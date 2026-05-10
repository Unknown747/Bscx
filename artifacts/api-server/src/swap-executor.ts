import {
    createWalletClient,
    createPublicClient,
    http,
    parseEther,
    parseUnits,
    formatEther,
    formatUnits,
    encodeFunctionData,
    type WalletClient,
    type PublicClient,
    type Address,
    type Hex
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { EventEmitter } from 'events';
import axios from 'axios';
import dotenv from 'dotenv';
import {
    getEthPriceUsd,
    getBestDexPair,
    getDexUniV3Pairs,
    getTokenPriceEth,
} from './price-oracle';
import { calculateExit } from './dynamic-exit';

dotenv.config();

// ============ CONSTANTS ============
const UNISWAP_V3_ROUTER   = '0x2626664c2603336E57B271c5C0b26F421741e481' as Address; // SwapRouter02 on Base
const WETH_BASE            = '0x4200000000000000000000000000000000000006' as Address;
const MAX_UINT256          = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

// SwapRouter02 ABI (exactInputSingle only)
const ROUTER_ABI = [
    {
        name: 'exactInputSingle',
        type: 'function',
        inputs: [{
            name: 'params',
            type: 'tuple',
            components: [
                { name: 'tokenIn',           type: 'address' },
                { name: 'tokenOut',          type: 'address' },
                { name: 'fee',               type: 'uint24'  },
                { name: 'recipient',         type: 'address' },
                { name: 'amountIn',          type: 'uint256' },
                { name: 'amountOutMinimum',  type: 'uint256' },
                { name: 'sqrtPriceLimitX96', type: 'uint160' }
            ]
        }],
        outputs: [{ name: 'amountOut', type: 'uint256' }]
    }
] as const;

// ERC20 ABI (minimal)
const ERC20_ABI = [
    { name: 'balanceOf',  type: 'function', inputs: [{ name: 'account', type: 'address' }],                                                                                                              outputs: [{ name: '', type: 'uint256' }] },
    { name: 'decimals',   type: 'function', inputs: [],                                                                                                                                                   outputs: [{ name: '', type: 'uint8'   }] },
    { name: 'symbol',     type: 'function', inputs: [],                                                                                                                                                   outputs: [{ name: '', type: 'string'  }] },
    { name: 'name',       type: 'function', inputs: [],                                                                                                                                                   outputs: [{ name: '', type: 'string'  }] },
    { name: 'approve',    type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount',   type: 'uint256' }],                                                                       outputs: [{ name: '', type: 'bool'    }] },
    { name: 'allowance',  type: 'function', inputs: [{ name: 'owner',   type: 'address' }, { name: 'spender', type: 'address' }],                                                                       outputs: [{ name: '', type: 'uint256' }] },
    { name: 'transfer',   type: 'function', inputs: [{ name: 'to',      type: 'address' }, { name: 'amount',   type: 'uint256' }],                                                                       outputs: [{ name: '', type: 'bool'    }] }
] as const;

// ============ TYPES ============
export interface SwapParams {
    tokenAddress: Address;
    amountInEth: number;
    slippagePercent?: number;
    feeTier?: 500 | 3000 | 10000;
    sourceWallet?: string;
}

export interface SwapResult {
    success: boolean;
    txHash?: Hex;
    amountIn: bigint;
    amountOut: bigint;
    gasUsed?: bigint;
    error?: string;
}

interface OpenPosition {
    tokenAddress: Address;
    tokenSymbol: string;
    amountIn: bigint;
    amountOut: bigint;
    entryPrice: number;
    openedAt: number;
    txHash: Hex;
    takeProfit1Hit: boolean;
    takeProfit2Hit: boolean;
    takeProfit3Hit: boolean;
    peakValueEth: number;
    dcaDone: boolean;
    sourceWallet?: string;
    initialLiquidityUsd: number;
    tp1SoldPct: number;
    tp2SoldPct: number;
    dynamicSell50Done?: boolean;
    dynamicSell25Done?: boolean;
}

// ============ SWAP EXECUTOR ============
export class SwapExecutor extends EventEmitter {
    private walletClient: WalletClient;
    private publicClient: PublicClient;
    private account: ReturnType<typeof privateKeyToAccount>;
    private openPositions: Map<Address, OpenPosition> = new Map();
    private knownTokens: Set<Address> = new Set();
    private positionMonitorInterval: NodeJS.Timeout | null = null;
    private isReady = false;

    private readonly CONFIG = {
        // ── Slippage ──────────────────────────────────────────────────────────
        DEFAULT_SLIPPAGE:           parseFloat(process.env.MAX_SLIPPAGE_PERCENT      || '8'),   // 8%
        // ── Profit Ladder TP (3 Level) ────────────────────────────────────────
        // TP1: +50% (1.5x) → sell 30%
        TAKE_PROFIT_1_X:            parseFloat(process.env.TAKE_PROFIT_1_MULTIPLIER  || '1.5'),
        TAKE_PROFIT_1_PCT:          parseFloat(process.env.TAKE_PROFIT_1_PERCENTAGE  || '30'),
        // TP2: +150% (2.5x) → sell 30% of original position
        TAKE_PROFIT_2_X:            parseFloat(process.env.TAKE_PROFIT_2_MULTIPLIER  || '2.5'),
        TAKE_PROFIT_2_PCT:          parseFloat(process.env.TAKE_PROFIT_2_PERCENTAGE  || '30'),
        // TP3: trailing stop on remaining ~40% — activate after +50% profit
        TRAILING_TP3_ACTIVATE_PCT:  50,   // activate trailing TP3 after +50% profit
        TRAILING_TP3_FROM_PEAK_PCT: 15,   // sell remaining if drops 15% from peak
        // ── Stop Loss ────────────────────────────────────────────────────────
        STOP_LOSS_PCT:              parseFloat(process.env.STOP_LOSS_PERCENTAGE       || '20'),
        // ── Gas — calibrated for Base L2 (NOT Ethereum mainnet) ──────────────
        // Base typical base fee: 0.001–0.005 gwei. Priority fee: 0.001 gwei is enough.
        MAX_PRIORITY_FEE_GWEI:      parseFloat(process.env.MAX_PRIORITY_FEE_GWEI     || '0.005'), // was 0.5 — 100x too high
        MAX_FEE_GWEI:               parseFloat(process.env.MAX_FEE_PER_GAS_GWEI      || '0.05'),  // was 1.5 — 30x too high
        GAS_MODE:                   process.env.GAS_MODE                             || 'auto',   // auto reads actual Base fee
        // ── Position Monitor ─────────────────────────────────────────────────
        MONITOR_INTERVAL_MS:        5000,
        // ── Trailing Stop Loss (for positions before TP3 activates) ─────────
        TRAILING_SL_ACTIVATE_MULT:  1.50,  // start trailing after 50% profit
        TRAILING_SL_FROM_PEAK_PCT:  12,    // sell if drops 12% from peak
        // ── Minimum Liquidity Guard ──────────────────────────────────────────
        LIQUIDITY_DROP_EXIT_PCT:    50,    // exit if pool liquidity drops 50% from entry
        // ── Price Impact ─────────────────────────────────────────────────────
        MAX_PRICE_IMPACT_PCT:       5,
        // ── DCA ─ disabled for small capital (gas cost > benefit) ────────────
        DCA_TRIGGER_MULT:           0.98,
        DCA_ENABLED:                process.env.DCA_ENABLED === 'true', // default OFF (was default ON)
        // ── Position Management ───────────────────────────────────────────────
        MAX_OPEN_POSITIONS:         parseInt(process.env.MAX_OPEN_POSITIONS   || '3'),   // max simultaneous trades
        MAX_HOLD_MINUTES:           parseInt(process.env.MAX_HOLD_MINUTES     || '30'),  // exit stale positions
        EMERGENCY_EXIT_PCT:         parseFloat(process.env.EMERGENCY_EXIT_PCT || '-50'), // rug detection: exit if drops this fast
        EMERGENCY_EXIT_MINUTES:     2,  // window for emergency exit check (first N minutes of trade)
    };

    constructor() {
        super();

        const rawKey = process.env.PRIVATE_KEY || '';
        if (!rawKey || rawKey === '0x0000000000000000000000000000000000000000000000000000000000000000') {
            throw new Error('PRIVATE_KEY not configured or is placeholder');
        }

        const privateKey: Hex = rawKey.startsWith('0x') ? rawKey as Hex : `0x${rawKey}`;
        this.account = privateKeyToAccount(privateKey);

        const rpcUrl = process.env.BASE_HTTP_URL || 'https://mainnet-preconf.base.org';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) }) as any;
        this.walletClient = createWalletClient({ account: this.account, chain: base, transport: http(rpcUrl) });

        this.isReady = true;

        console.log('💼 SwapExecutor initialized');
        console.log(`   Wallet: ${this.account.address}`);
        console.log(`   RPC:    ${rpcUrl}`);
        console.log(`   Mode:   ${this.CONFIG.GAS_MODE.toUpperCase()}`);
    }

    // ============ GAS PRICE ============
    // Base L2 reality: base fee is 0.001–0.01 gwei, NOT 1–2 gwei like Ethereum mainnet.
    // A full swap on Base costs ~150k gas × 0.005 gwei = ~$0.002. Calibrate accordingly.
    private async getGasPrice(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
        if (this.CONFIG.GAS_MODE === 'economy') {
            // Use configured caps — already set to Base-appropriate values
            return {
                maxFeePerGas:         BigInt(Math.floor(this.CONFIG.MAX_FEE_GWEI * 1e9)),
                maxPriorityFeePerGas: BigInt(Math.floor(this.CONFIG.MAX_PRIORITY_FEE_GWEI * 1e9))
            };
        }

        // 'auto' mode — read actual Base network fee and add minimal tip
        try {
            const block = await this.publicClient.getBlock({ blockTag: 'latest' });
            const baseFee    = block.baseFeePerGas ?? 1_000_000n; // fallback 0.001 gwei
            // On Base a 0.001 gwei tip is more than enough to get included
            const priorityFee = 1_000_000n; // 0.001 gwei
            // Cap total at configured max to prevent runaway fees
            const maxConfigFee = BigInt(Math.floor(this.CONFIG.MAX_FEE_GWEI * 1e9));
            const computed     = baseFee + priorityFee * 2n;
            return {
                maxFeePerGas:         computed < maxConfigFee ? computed : maxConfigFee,
                maxPriorityFeePerGas: priorityFee
            };
        } catch {
            // Fallback to economy caps
            return {
                maxFeePerGas:         BigInt(Math.floor(this.CONFIG.MAX_FEE_GWEI * 1e9)),
                maxPriorityFeePerGas: BigInt(Math.floor(this.CONFIG.MAX_PRIORITY_FEE_GWEI * 1e9))
            };
        }
    }

    // ============ ETH BALANCE CHECK ============
    async getBalance(): Promise<{ eth: string; wei: bigint }> {
        const wei = await this.publicClient.getBalance({ address: this.account.address });
        return { eth: formatEther(wei), wei };
    }

    // ============ BUY TOKEN (ETH → Token) ============
    async buy(params: SwapParams): Promise<SwapResult> {
        if (!this.isReady) return { success: false, amountIn: 0n, amountOut: 0n, error: 'Executor not ready' };

        const { tokenAddress, amountInEth, slippagePercent = this.CONFIG.DEFAULT_SLIPPAGE, feeTier = 3000 } = params;
        const amountIn = parseEther(amountInEth.toString());

        console.log(`\n🛒 BUY: ${amountInEth} ETH → ${tokenAddress.slice(0, 10)}...`);

        try {
            // ── Balance check ──
            // Reserve 0.0001 ETH (~$0.30) for gas — Base L2 is very cheap (was 0.002 ETH = $6)
            const { wei: balance } = await this.getBalance();
            const gasReserve = parseEther('0.0001');
            if (balance < amountIn + gasReserve) {
                return { success: false, amountIn, amountOut: 0n, error: `Insufficient balance: ${formatEther(balance)} ETH` };
            }

            // ── Price impact check ──
            const impact = await this.checkPriceImpact(tokenAddress, amountInEth);
            if (!impact.ok) {
                console.log(`   ⚠️  Price impact too high: ${impact.impact.toFixed(1)}% (max ${this.CONFIG.MAX_PRICE_IMPACT_PCT}%) — skipping`);
                return { success: false, amountIn, amountOut: 0n, error: `Price impact too high: ${impact.impact.toFixed(1)}% (pool liq: $${impact.liquidityUsd.toFixed(0)})` };
            }
            console.log(`   ✅ Price impact: ${impact.impact.toFixed(2)}% — OK`);

            // ── Auto-detect best fee tier ──
            const bestFee = await this.getBestFeeTier(tokenAddress);
            console.log(`   ⛽ Using fee tier: ${bestFee / 10000}%`);

            // ── Slippage protection: compute minimum tokens out from live price ──
            let amountOutMinimum = 0n;
            try {
                const pair = await getBestDexPair(tokenAddress);
                if (pair) {
                    const tokenPriceEth = parseFloat(pair.priceNative || '0');
                    if (tokenPriceEth > 0) {
                        const decimals      = await this.getTokenDecimals(tokenAddress);
                        const expectedTokens = amountInEth / tokenPriceEth;
                        const minTokens     = expectedTokens * (1 - slippagePercent / 100);
                        const minFixed      = minTokens.toFixed(Math.min(decimals, 8));
                        amountOutMinimum    = parseUnits(minFixed, decimals);
                        console.log(`   🛡️ Slippage guard: min ${minTokens.toFixed(4)} tokens (${slippagePercent}% max slippage)`);
                    }
                }
            } catch {
                console.log(`   ⚠️ Tidak bisa hitung amountOutMinimum — buy tanpa proteksi slippage`);
            }

            const gasPrice = await this.getGasPrice();

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const txHash = await (this.walletClient as any).writeContract({
                address: UNISWAP_V3_ROUTER,
                abi: ROUTER_ABI,
                functionName: 'exactInputSingle',
                args: [{
                    tokenIn:           WETH_BASE,
                    tokenOut:          tokenAddress,
                    fee:               bestFee,
                    recipient:         this.account.address,
                    amountIn,
                    amountOutMinimum,
                    sqrtPriceLimitX96: 0n
                }],
                value: amountIn,
                ...gasPrice
            });

            console.log(`   📤 TX sent: ${txHash}`);

            const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

            if (receipt.status !== 'success') {
                return { success: false, amountIn, amountOut: 0n, txHash, error: 'Transaction reverted' };
            }

            // Get token balance after buy
            const tokenBalance = await this.publicClient.readContract({
                address: tokenAddress,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [this.account.address]
            }) as bigint;

            const tokenSymbol = await this.getTokenSymbol(tokenAddress);

            // Record open position
            this.openPositions.set(tokenAddress, {
                tokenAddress,
                tokenSymbol,
                amountIn,
                amountOut: tokenBalance,
                entryPrice: amountInEth,
                openedAt: Date.now(),
                txHash,
                takeProfit1Hit: false,
                takeProfit2Hit: false,
                takeProfit3Hit: false,
                peakValueEth:   amountInEth,
                dcaDone:        false,
                sourceWallet:   params.sourceWallet,
                initialLiquidityUsd: impact.liquidityUsd,
                tp1SoldPct: 0,
                tp2SoldPct: 0,
            });

            this.knownTokens.add(tokenAddress.toLowerCase() as Address);
            console.log(`   ✅ BUY SUCCESS: ${formatEther(tokenBalance)} ${tokenSymbol}`);
            console.log(`   📋 TX: ${txHash}`);
            console.log(`   ⛽ Gas used: ${receipt.gasUsed}`);

            this.emit('buy-success', { tokenAddress, tokenSymbol, amountIn, amountOut: tokenBalance, txHash });
            this.startPositionMonitor();

            return { success: true, txHash, amountIn, amountOut: tokenBalance, gasUsed: receipt.gasUsed };

        } catch (error: any) {
            const msg = error?.shortMessage || error?.message || 'Unknown error';
            console.error(`   ❌ BUY FAILED: ${msg}`);
            this.emit('buy-failed', { tokenAddress, error: msg });
            return { success: false, amountIn, amountOut: 0n, error: msg };
        }
    }

    // ============ SELL TOKEN (Token → ETH) ============
    async sell(tokenAddress: Address, percentToSell: number = 100): Promise<SwapResult> {
        if (!this.isReady) return { success: false, amountIn: 0n, amountOut: 0n, error: 'Executor not ready' };

        console.log(`\n💸 SELL: ${percentToSell}% of ${tokenAddress.slice(0, 10)}...`);

        try {
            const tokenBalance = await this.publicClient.readContract({
                address: tokenAddress,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [this.account.address]
            }) as bigint;

            if (tokenBalance === 0n) {
                return { success: false, amountIn: 0n, amountOut: 0n, error: 'Zero balance' };
            }

            const amountIn = (tokenBalance * BigInt(percentToSell)) / 100n;

            const gasPrice = await this.getGasPrice();

            // ── Skip approve if router already has sufficient allowance (saves 1 TX = ~$0.001) ──
            const allowance = await this.publicClient.readContract({
                address:      tokenAddress,
                abi:          ERC20_ABI,
                functionName: 'allowance',
                args:         [this.account.address, UNISWAP_V3_ROUTER]
            }) as bigint;

            if (allowance < amountIn) {
                console.log(`   📝 Approving router (first time for this token)...`);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const approveTx = await (this.walletClient as any).writeContract({
                    address:      tokenAddress,
                    abi:          ERC20_ABI,
                    functionName: 'approve',
                    args:         [UNISWAP_V3_ROUTER, MAX_UINT256],
                    ...gasPrice
                });
                await this.publicClient.waitForTransactionReceipt({ hash: approveTx, timeout: 20_000 });
            } else {
                console.log(`   ✅ Router already approved — skipping approve TX (saved ~$0.001)`);
            }

            // ── Auto-detect best fee tier for this token ──
            const bestFee = await this.getBestFeeTier(tokenAddress);
            console.log(`   ⛽ Sell using fee tier: ${bestFee / 10000}%`);

            // ── Slippage protection: estimate current ETH value, set minimum output ──
            // Prevents sandwich attacks on exit (previously was 0n — no protection at all)
            let amountOutMinimum = 0n;
            try {
                const estimatedEth = await this.estimateTokenValueEth(tokenAddress, amountIn);
                if (estimatedEth && estimatedEth > 0) {
                    const slippage = this.CONFIG.DEFAULT_SLIPPAGE;
                    amountOutMinimum = BigInt(Math.floor(estimatedEth * (1 - slippage / 100) * 1e18));
                    console.log(`   🛡️ Sell min output: ${formatEther(amountOutMinimum)} ETH (${slippage}% max slippage)`);
                }
            } catch { /* use 0n as safe fallback if price estimate unavailable */ }

            // Execute sell
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const txHash = await (this.walletClient as any).writeContract({
                address: UNISWAP_V3_ROUTER,
                abi: ROUTER_ABI,
                functionName: 'exactInputSingle',
                args: [{
                    tokenIn:           tokenAddress,
                    tokenOut:          WETH_BASE,
                    fee:               bestFee,
                    recipient:         this.account.address,
                    amountIn,
                    amountOutMinimum,
                    sqrtPriceLimitX96: 0n
                }],
                ...gasPrice
            });

            console.log(`   📤 TX sent: ${txHash}`);
            const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

            if (receipt.status !== 'success') {
                return { success: false, amountIn, amountOut: 0n, txHash, error: 'Sell transaction reverted' };
            }

            const _sellPos = this.openPositions.get(tokenAddress);
            const tokenSymbol = _sellPos?.tokenSymbol || '???';
            const _sellSw = _sellPos?.sourceWallet;
            const entryEthFull = _sellPos ? parseFloat(formatEther(_sellPos.amountIn)) : 0;
            const holdMs = _sellPos ? Date.now() - _sellPos.openedAt : 0;
            const entryEth = entryEthFull * (percentToSell / 100);
            let profitPct: number | null = null;
            if (entryEthFull > 0) {
                try {
                    const currentValueEth = await this.estimateTokenValueEth(tokenAddress, amountIn);
                    if (currentValueEth !== null) {
                        profitPct = ((currentValueEth - entryEth) / entryEth) * 100;
                    }
                } catch { /* silent — sell already succeeded */ }
            }
            console.log(`   ✅ SELL SUCCESS: ${formatEther(amountIn)} ${tokenSymbol} (${percentToSell}%)`);

            this.emit('sell-success', { tokenAddress, tokenSymbol, amountIn, percentSold: percentToSell, txHash, sourceWallet: _sellSw, profitPct, holdMs, entryEth });

            // Remove position if fully sold
            if (percentToSell >= 100) {
                this.openPositions.delete(tokenAddress);
            }

            return { success: true, txHash, amountIn, amountOut: 0n, gasUsed: receipt.gasUsed };

        } catch (error: any) {
            const msg = error?.shortMessage || error?.message || 'Unknown error';
            console.error(`   ❌ SELL FAILED: ${msg}`);
            this.emit('sell-failed', { tokenAddress, error: msg });
            return { success: false, amountIn: 0n, amountOut: 0n, error: msg };
        }
    }

    // ============ POSITION MONITOR (Take Profit + Stop Loss) ============
    private startPositionMonitor(): void {
        if (this.positionMonitorInterval) return; // already running

        this.positionMonitorInterval = setInterval(async () => {
            if (this.openPositions.size === 0) return;

            for (const [tokenAddress, position] of this.openPositions) {
                try {
                    await this.checkPosition(tokenAddress, position);
                } catch {
                    // Silent fail per position
                }
            }
        }, this.CONFIG.MONITOR_INTERVAL_MS);

        console.log(`🔍 Position monitor started (${this.CONFIG.MONITOR_INTERVAL_MS}ms interval)`);
    }

    private async checkPosition(tokenAddress: Address, position: OpenPosition): Promise<void> {
        const currentBalance = await this.publicClient.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [this.account.address]
        }) as bigint;

        if (currentBalance === 0n) {
            this.openPositions.delete(tokenAddress);
            return;
        }

        // Estimate current ETH value via DexScreener
        const currentValueEth = await this.estimateTokenValueEth(tokenAddress, currentBalance);
        if (currentValueEth === null) return;

        const entryEth   = parseFloat(formatEther(position.amountIn));
        const profitPct  = ((currentValueEth - entryEth) / entryEth) * 100;
        const multiplier = currentValueEth / entryEth;

        const holdMins    = (Date.now() - position.openedAt) / 60000;
        const holdMinsStr = holdMins.toFixed(1);

        // ─── EMERGENCY EXIT: rug detection ───
        // If position is <2 min old AND already down >50% — very likely a rug/honeypot miss
        if (holdMins <= this.CONFIG.EMERGENCY_EXIT_MINUTES && profitPct <= this.CONFIG.EMERGENCY_EXIT_PCT) {
            console.log(`🚨 EMERGENCY EXIT: ${position.tokenSymbol} dropped ${profitPct.toFixed(1)}% in ${holdMinsStr}min — possible rug!`);
            this.emit('stop-loss', {
                tokenAddress, tokenSymbol: position.tokenSymbol, profitPct,
                reason: `🚨 Emergency: -${Math.abs(profitPct).toFixed(0)}% in ${holdMinsStr}min (rug suspected)`,
                peakMult: 1, sourceWallet: position.sourceWallet
            });
            await this.sell(tokenAddress, 100);
            return;
        }

        // ─── MAX HOLD TIME: exit stale positions ───
        // Free up capital if token hasn't reached TP1 after MAX_HOLD_MINUTES
        if (holdMins >= this.CONFIG.MAX_HOLD_MINUTES && !position.takeProfit1Hit) {
            console.log(`⏰ MAX HOLD TIME (${this.CONFIG.MAX_HOLD_MINUTES}min) reached — exiting ${position.tokenSymbol} at ${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(1)}%`);
            this.emit('stop-loss', {
                tokenAddress, tokenSymbol: position.tokenSymbol, profitPct,
                reason: `⏰ Timeout (${this.CONFIG.MAX_HOLD_MINUTES}min hold, no TP1)`,
                peakMult: 1, sourceWallet: position.sourceWallet
            });
            await this.sell(tokenAddress, 100);
            return;
        }

        // ── Update peak value for trailing SL ──
        if (currentValueEth > (position.peakValueEth || entryEth)) {
            position.peakValueEth = currentValueEth;
        }
        const peakMult     = position.peakValueEth / entryEth;
        const dropFromPeak = position.peakValueEth > 0
            ? ((position.peakValueEth - currentValueEth) / position.peakValueEth) * 100
            : 0;
        const useTrailingSL = peakMult >= this.CONFIG.TRAILING_SL_ACTIVATE_MULT;
        const slTriggered   = useTrailingSL
            ? dropFromPeak  >= this.CONFIG.TRAILING_SL_FROM_PEAK_PCT
            : profitPct     <= -this.CONFIG.STOP_LOSS_PCT;

        console.log(`📊 ${position.tokenSymbol}: ${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(1)}% | ${multiplier.toFixed(2)}x | peak ${peakMult.toFixed(2)}x | ${holdMinsStr}m`);

        // ─── STOP LOSS (Fixed or Trailing) ───
        if (slTriggered) {
            const reason = useTrailingSL
                ? `Trailing SL: -${dropFromPeak.toFixed(1)}% from peak`
                : `Fixed SL: ${profitPct.toFixed(1)}%`;
            console.log(`🛑 STOP LOSS triggered (${reason}) — selling 100%`);
            this.emit('stop-loss', { tokenAddress, tokenSymbol: position.tokenSymbol, profitPct, reason, peakMult, sourceWallet: position.sourceWallet });
            await this.sell(tokenAddress, 100);
            return;
        }

        // ─── MINIMUM LIQUIDITY GUARD ─── exit if liquidity drained ≥50%
        if (position.initialLiquidityUsd > 100) {
            try {
                const liqCheck = await this.checkPriceImpact(tokenAddress, 0.001);
                if (liqCheck.liquidityUsd > 0) {
                    const liqDrop = ((position.initialLiquidityUsd - liqCheck.liquidityUsd) / position.initialLiquidityUsd) * 100;
                    if (liqDrop >= this.CONFIG.LIQUIDITY_DROP_EXIT_PCT) {
                        console.log(`💧 LIQUIDITY GUARD: ${position.tokenSymbol} likuiditas turun ${liqDrop.toFixed(0)}% — keluar!`);
                        this.emit('stop-loss', {
                            tokenAddress, tokenSymbol: position.tokenSymbol, profitPct,
                            reason: `💧 Likuiditas turun ${liqDrop.toFixed(0)}% (rug/dump suspected)`,
                            peakMult, sourceWallet: position.sourceWallet
                        });
                        await this.sell(tokenAddress, 100);
                        return;
                    }
                }
            } catch { /* silent — don't block position monitor */ }
        }

        // ─── PROFIT LADDER TP1: sell 30% at 1.5x (+50%) ───
        if (!position.takeProfit1Hit && multiplier >= this.CONFIG.TAKE_PROFIT_1_X) {
            const sellPct = this.CONFIG.TAKE_PROFIT_1_PCT;
            console.log(`🎯 TP1 at ${multiplier.toFixed(2)}x (+${((multiplier-1)*100).toFixed(0)}%) — jual ${sellPct}%`);
            this.emit('take-profit', { tokenAddress, tokenSymbol: position.tokenSymbol, level: 1, multiplier, profitPct, holdMs: Date.now() - position.openedAt, sourceWallet: position.sourceWallet });
            await this.sell(tokenAddress, sellPct);
            position.takeProfit1Hit = true;
            position.tp1SoldPct = sellPct;
            return;
        }

        // ─── PROFIT LADDER TP2: sell 30% of original at 2.5x (+150%) ───
        if (position.takeProfit1Hit && !position.takeProfit2Hit && multiplier >= this.CONFIG.TAKE_PROFIT_2_X) {
            // We already sold tp1Pct% → remaining = (100 - tp1Pct)%. We want to sell tp2Pct% of original.
            // sellPct of remaining = tp2Pct / (1 - tp1Pct/100) * 100
            const remaining = 100 - (position.tp1SoldPct || this.CONFIG.TAKE_PROFIT_1_PCT);
            const tp2Pct    = this.CONFIG.TAKE_PROFIT_2_PCT;
            const sellPct   = remaining > 0 ? Math.min(100, Math.round((tp2Pct / remaining) * 100)) : 100;
            console.log(`🎯 TP2 at ${multiplier.toFixed(2)}x (+${((multiplier-1)*100).toFixed(0)}%) — jual ${sellPct}% dari sisa`);
            this.emit('take-profit', { tokenAddress, tokenSymbol: position.tokenSymbol, level: 2, multiplier, profitPct, holdMs: Date.now() - position.openedAt, sourceWallet: position.sourceWallet });
            await this.sell(tokenAddress, sellPct);
            position.takeProfit2Hit = true;
            position.tp2SoldPct = tp2Pct;
            return;
        }

        // ─── PROFIT LADDER TP3: trailing stop on remaining ~40% ───
        if (position.takeProfit2Hit && !position.takeProfit3Hit && profitPct >= this.CONFIG.TRAILING_TP3_ACTIVATE_PCT) {
            if (dropFromPeak >= this.CONFIG.TRAILING_TP3_FROM_PEAK_PCT) {
                console.log(`🎯 TP3 Trailing — turun ${dropFromPeak.toFixed(1)}% dari puncak → jual semua sisa`);
                this.emit('take-profit', { tokenAddress, tokenSymbol: position.tokenSymbol, level: 3, multiplier, profitPct, holdMs: Date.now() - position.openedAt, sourceWallet: position.sourceWallet });
                await this.sell(tokenAddress, 100);
                position.takeProfit3Hit = true;
                return;
            }
        }

        // ─── DCA ON DIP ─── (After TP1 hit, price drops back near entry — buy more once)
        if (this.CONFIG.DCA_ENABLED && position.takeProfit1Hit && !position.takeProfit2Hit && !position.dcaDone
            && multiplier <= this.CONFIG.DCA_TRIGGER_MULT) {
            const dcaAmount = parseFloat(formatEther(position.amountIn)) * 0.5;
            console.log(`📉 DCA: ${position.tokenSymbol} at ${multiplier.toFixed(3)}x — signal to buy ${dcaAmount} ETH more`);
            this.emit('dca-signal', { tokenAddress, tokenSymbol: position.tokenSymbol, dcaAmount });
            position.dcaDone = true;
        }

        // ─── DYNAMIC EXIT: momentum-based OHLCV exit (aktif setelah TP1) ───
        // Gunakan sinyal momentum & volume dari GeckoTerminal untuk exit lebih presisi
        if (position.takeProfit1Hit && !position.takeProfit3Hit) {
            try {
                const exitSignal = await calculateExit({
                    tokenAddress,
                    entryPriceEth:       entryEth,
                    currentValueEth,
                    peakValueEth:        position.peakValueEth || entryEth,
                    openedAt:            position.openedAt,
                    maxHoldMinutes:      this.CONFIG.MAX_HOLD_MINUTES,
                    trailingActivatePct: (this.CONFIG.TRAILING_SL_ACTIVATE_MULT - 1) * 100,
                    trailingFromPeakPct: this.CONFIG.TRAILING_SL_FROM_PEAK_PCT,
                    stopLossPct:         this.CONFIG.STOP_LOSS_PCT,
                });

                if (exitSignal === 'SELL_ALL_PANIC') {
                    console.log(`📉 [DynamicExit] PANIC — reversal momentum terdeteksi, jual 100% ${position.tokenSymbol}`);
                    this.emit('stop-loss', {
                        tokenAddress, tokenSymbol: position.tokenSymbol, profitPct,
                        reason: `📉 Reversal momentum (dynamic exit)`,
                        peakMult, sourceWallet: position.sourceWallet,
                        holdMs: Date.now() - position.openedAt,
                    });
                    await this.sell(tokenAddress, 100);
                    return;
                }

                if (exitSignal === 'SELL_50_PERCENT' && !position.dynamicSell50Done) {
                    console.log(`📉 [DynamicExit] Momentum melemah — jual 50% ${position.tokenSymbol}`);
                    this.emit('take-profit', {
                        tokenAddress, tokenSymbol: position.tokenSymbol,
                        level: 2, multiplier, profitPct,
                        holdMs: Date.now() - position.openedAt,
                        sourceWallet: position.sourceWallet,
                    });
                    await this.sell(tokenAddress, 50);
                    position.dynamicSell50Done = true;
                    return;
                }

                if (exitSignal === 'SELL_25_PERCENT' && !position.dynamicSell25Done) {
                    console.log(`📉 [DynamicExit] Scale out — jual 25% ${position.tokenSymbol}`);
                    await this.sell(tokenAddress, 25);
                    position.dynamicSell25Done = true;
                    return;
                }

                if (exitSignal === 'SELL_ALL_TRAILING' || exitSignal === 'SELL_ALL_TIMEOUT') {
                    console.log(`📉 [DynamicExit] ${exitSignal} — jual sisa ${position.tokenSymbol}`);
                    this.emit('take-profit', {
                        tokenAddress, tokenSymbol: position.tokenSymbol,
                        level: 3, multiplier, profitPct,
                        holdMs: Date.now() - position.openedAt,
                        sourceWallet: position.sourceWallet,
                    });
                    await this.sell(tokenAddress, 100);
                    position.takeProfit3Hit = true;
                    return;
                }
            } catch { /* silent — jangan blokir position monitor */ }
        }
    }

    // ============ LIVE PnL ============
    async getLivePnL(): Promise<Array<{
        tokenAddress: string;
        tokenSymbol: string;
        entryEth: number;
        currentValueEth: number | null;
        profitPct: number | null;
        multiplier: number | null;
        holdMs: number;
    }>> {
        const results = [];
        for (const [addr, pos] of this.openPositions) {
            const entryEth = parseFloat(formatEther(pos.amountIn));
            let currentValueEth: number | null = null;
            let profitPct: number | null       = null;
            let multiplier: number | null      = null;

            try {
                const balance = await this.publicClient.readContract({
                    address: addr, abi: ERC20_ABI, functionName: 'balanceOf',
                    args: [this.account.address]
                }) as bigint;

                if (balance > 0n) {
                    currentValueEth = await this.estimateTokenValueEth(addr, balance);
                    if (currentValueEth !== null && entryEth > 0) {
                        profitPct  = ((currentValueEth - entryEth) / entryEth) * 100;
                        multiplier = currentValueEth / entryEth;
                    }
                }
            } catch { /* silent */ }

            results.push({
                tokenAddress: addr,
                tokenSymbol:  pos.tokenSymbol,
                entryEth,
                currentValueEth,
                profitPct,
                multiplier,
                holdMs: Date.now() - pos.openedAt
            });
        }
        return results;
    }

    // ============ PRICE ESTIMATION ============
    // In-process decimals cache to avoid repeated on-chain calls
    private decimalsCache = new Map<string, number>();

    private async getTokenDecimals(tokenAddress: Address): Promise<number> {
        const cached = this.decimalsCache.get(tokenAddress.toLowerCase());
        if (cached !== undefined) return cached;
        try {
            const d = await this.publicClient.readContract({
                address: tokenAddress, abi: ERC20_ABI, functionName: 'decimals'
            }) as number;
            this.decimalsCache.set(tokenAddress.toLowerCase(), d);
            return d;
        } catch {
            return 18;
        }
    }

    private async estimateTokenValueEth(tokenAddress: Address, tokenAmount: bigint): Promise<number | null> {
        try {
            const decimals = await this.getTokenDecimals(tokenAddress);
            const tokenAmountNum = Number(tokenAmount) / Math.pow(10, decimals);

            // getTokenPriceEth: tries DexScreener (cached, parallel ETH price)
            //   then falls back to on-chain slot0 if pair not yet indexed
            const priceEth = await getTokenPriceEth(this.publicClient, tokenAddress, decimals);
            if (priceEth === null) return null;

            return tokenAmountNum * priceEth;
        } catch {
            return null;
        }
    }

    private async getTokenSymbol(tokenAddress: Address): Promise<string> {
        try {
            return await this.publicClient.readContract({
                address: tokenAddress,
                abi: ERC20_ABI,
                functionName: 'symbol'
            }) as string;
        } catch {
            return 'UNKNOWN';
        }
    }

    // ============ BEST FEE TIER DETECTION ============
    private async getBestFeeTier(tokenAddress: Address): Promise<500 | 3000 | 10000> {
        try {
            // getDexUniV3Pairs uses the shared cache — no extra HTTP call if already fetched
            const pairs = await getDexUniV3Pairs(tokenAddress);
            let bestLiq = 0;
            let bestFee: 500 | 3000 | 10000 = 3000;
            const VALID_FEES = new Set([500, 3000, 10000]);
            for (const pair of pairs) {
                const liq = pair.liquidity?.usd || 0;
                if (liq > bestLiq) {
                    bestLiq = liq;
                    // Use the pair's actual fee tier, falling back to 3000 if not a valid UniV3 tier
                    const rawFee = pair.feeTier ?? pair.fee ?? 3000;
                    bestFee = VALID_FEES.has(rawFee) ? rawFee as 500 | 3000 | 10000 : 3000;
                }
            }
            return bestFee;
        } catch {
            return 3000;
        }
    }

    // ============ PRICE IMPACT CHECK ============
    private async checkPriceImpact(tokenAddress: Address, amountEth: number): Promise<{ ok: boolean; impact: number; liquidityUsd: number }> {
        try {
            // Fetch pair & ETH price in parallel; getBestDexPair uses cache
            const [pair, ethPriceUsd] = await Promise.all([
                getBestDexPair(tokenAddress),
                getEthPriceUsd(),
            ]);
            if (!pair) return { ok: true, impact: 0, liquidityUsd: 0 }; // Not yet indexed — allow

            const liqUsd  = pair.liquidity?.usd || 0;
            if (liqUsd === 0) return { ok: false, impact: 100, liquidityUsd: 0 };

            const tradeUsd = amountEth * ethPriceUsd;
            const impact   = (tradeUsd / liqUsd) * 100;
            return { ok: impact < this.CONFIG.MAX_PRICE_IMPACT_PCT, impact, liquidityUsd: liqUsd };
        } catch {
            return { ok: true, impact: 0, liquidityUsd: 0 };
        }
    }

    // ============ KNOWN TOKEN REGISTRY ============
    addKnownToken(addr: string): void {
        this.knownTokens.add(addr.toLowerCase() as Address);
    }

    getKnownTokens(): Address[] {
        return Array.from(this.knownTokens);
    }

    // ============ PORTFOLIO DATA ============
    async getPortfolioData(): Promise<{
        ethBalance: string;
        ethValueUsd: number;
        tokens: Array<{
            address: string; symbol: string; balance: string;
            decimals: number; priceUsd: number | null;
            valueEth: number | null; valueUsd: number | null; change24h: number | null;
        }>;
        totalValueEth: number; totalValueUsd: number;
    }> {
        const ethPriceUsd = await getEthPriceUsd();
        const { eth } = await this.getBalance();
        const ethValueUsd = parseFloat(eth) * ethPriceUsd;
        const tokens: any[] = [];

        await Promise.all(Array.from(this.knownTokens).map(async (addr) => {
            try {
                const [balance, decimals, symbol] = await Promise.all([
                    this.publicClient.readContract({ address: addr, abi: ERC20_ABI, functionName: 'balanceOf', args: [this.account.address] }) as Promise<bigint>,
                    this.publicClient.readContract({ address: addr, abi: ERC20_ABI, functionName: 'decimals' }) as Promise<number>,
                    this.publicClient.readContract({ address: addr, abi: ERC20_ABI, functionName: 'symbol' }) as Promise<string>
                ]);
                if (balance === 0n) return;
                const balanceHuman = Number(formatUnits(balance, decimals));
                let priceUsd: number | null = null;
                let change24h: number | null = null;
                try {
                    const res = await axios.get(
                        `https://api.geckoterminal.com/api/v2/networks/base/tokens/${addr}/pools?page=1`,
                        { timeout: 4000, headers: { 'Accept': 'application/json;version=20230302' } }
                    );
                    const pool = res.data?.data?.[0];
                    if (pool) {
                        priceUsd  = parseFloat(pool.attributes?.base_token_price_usd  || '0') || null;
                        change24h = parseFloat(pool.attributes?.price_change_percentage?.h24 || '0') || null;
                    }
                } catch { /* silent */ }
                const valueUsd = priceUsd !== null ? balanceHuman * priceUsd : null;
                const valueEth = valueUsd !== null ? valueUsd / ethPriceUsd : null;
                tokens.push({ address: addr, symbol, balance: balanceHuman.toFixed(6), decimals, priceUsd, valueEth, valueUsd, change24h });
            } catch { /* silent */ }
        }));

        tokens.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
        const totalValueEth = tokens.reduce((s, t) => s + (t.valueEth ?? 0), 0) + parseFloat(eth);
        const totalValueUsd = tokens.reduce((s, t) => s + (t.valueUsd ?? 0), 0) + ethValueUsd;
        return { ethBalance: eth, ethValueUsd, tokens, totalValueEth, totalValueUsd };
    }

    // ============ SEND ETH ============
    async sendEth(to: Address, amountEth: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
        if (!this.isReady) return { success: false, error: 'Executor belum siap' };
        try {
            const value = parseEther(amountEth.toString());
            const { wei: balance } = await this.getBalance();
            if (balance < value + parseEther('0.0001')) {
                return { success: false, error: `Saldo tidak cukup: ${formatEther(balance)} ETH` };
            }
            const gasPrice = await this.getGasPrice();
            const txHash = await (this.walletClient as any).sendTransaction({ to, value, ...gasPrice });
            await this.publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });
            console.log(`✅ Sent ${amountEth} ETH → ${to}`);
            return { success: true, txHash };
        } catch (e: any) {
            return { success: false, error: e?.shortMessage || e?.message || 'Unknown error' };
        }
    }

    // ============ SEND TOKEN ============
    async sendToken(tokenAddress: Address, to: Address, amountHuman: number, decimals: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
        if (!this.isReady) return { success: false, error: 'Executor belum siap' };
        try {
            const amount = parseUnits(amountHuman.toString(), decimals);
            const balance = await this.publicClient.readContract({
                address: tokenAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [this.account.address]
            }) as bigint;
            if (balance < amount) return { success: false, error: 'Saldo token tidak cukup' };
            const gasPrice = await this.getGasPrice();
            const txHash = await (this.walletClient as any).writeContract({
                address: tokenAddress, abi: ERC20_ABI, functionName: 'transfer', args: [to, amount], ...gasPrice
            });
            await this.publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });
            console.log(`✅ Sent ${amountHuman} token (${tokenAddress}) → ${to}`);
            return { success: true, txHash };
        } catch (e: any) {
            return { success: false, error: e?.shortMessage || e?.message || 'Unknown error' };
        }
    }

    // ============ RUNTIME CONFIG UPDATE ============
    updateConfig(updates: {
        maxSlippage?:    number;
        tp1Multiplier?:  number;
        tp1Percentage?:  number;
        tp2Multiplier?:  number;
        tp2Percentage?:  number;
        stopLoss?:       number;
        maxPriorityFee?: number;
        maxFeePerGas?:   number;
        dcaEnabled?:     boolean;
    }): void {
        const c = this.CONFIG as any;
        if (updates.maxSlippage    != null) c.DEFAULT_SLIPPAGE      = updates.maxSlippage;
        if (updates.tp1Multiplier  != null) c.TAKE_PROFIT_1_X       = updates.tp1Multiplier;
        if (updates.tp1Percentage  != null) c.TAKE_PROFIT_1_PCT     = updates.tp1Percentage;
        if (updates.tp2Multiplier  != null) c.TAKE_PROFIT_2_X       = updates.tp2Multiplier;
        if (updates.tp2Percentage  != null) c.TAKE_PROFIT_2_PCT     = updates.tp2Percentage;
        if (updates.stopLoss       != null) c.STOP_LOSS_PCT          = updates.stopLoss;
        if (updates.maxPriorityFee != null) c.MAX_PRIORITY_FEE_GWEI = updates.maxPriorityFee;
        if (updates.maxFeePerGas   != null) c.MAX_FEE_GWEI           = updates.maxFeePerGas;
        if (updates.dcaEnabled     != null) c.DCA_ENABLED            = updates.dcaEnabled;
        console.log('⚙️  SwapExecutor config updated');
    }

    // ============ PUBLIC GETTERS ============
    getOpenPositions(): OpenPosition[] {
        return Array.from(this.openPositions.values());
    }

    hasPosition(tokenAddress: string): boolean {
        return this.openPositions.has(tokenAddress.toLowerCase() as Address) ||
               this.openPositions.has(tokenAddress as Address);
    }

    async sellAllPositions(): Promise<void> {
        const addresses = Array.from(this.openPositions.keys());
        for (const addr of addresses) {
            try {
                console.log(`🛑 Emergency sell: ${this.openPositions.get(addr)?.tokenSymbol ?? addr}`);
                await this.sell(addr, 100);
            } catch { /* continue selling others */ }
        }
    }

    getWalletAddress(): Address {
        return this.account.address;
    }

    stop(): void {
        if (this.positionMonitorInterval) {
            clearInterval(this.positionMonitorInterval);
            this.positionMonitorInterval = null;
        }
        console.log('🛑 SwapExecutor stopped');
    }
}

export default SwapExecutor;
