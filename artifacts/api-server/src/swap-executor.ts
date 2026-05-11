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
    getOnChainFeeTier,
} from './price-oracle';
import { calculateExit } from './dynamic-exit';
import { dbSaveOpenPosition, dbDeleteOpenPosition, dbLoadOpenPositions } from './db';

dotenv.config();

// ============ CONSTANTS ============
const UNISWAP_V3_ROUTER   = '0x2626664c2603336E57B271c5C0b26F421741e481' as Address; // SwapRouter02 on Base
const AERODROME_CL_ROUTER = '0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5' as Address; // Aerodrome CL (Slipstream) SwapRouter on Base
const WETH_BASE            = '0x4200000000000000000000000000000000000006' as Address;
const MAX_UINT256          = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

// QuoterV2 on Base — used to get expected output before sending buy TX
const UNISWAP_V3_QUOTER_V2 = '0x3d4e44Eb1374240CE5F1B136a8047CeBEaC0b89E' as Address;
const QUOTER_V2_ABI = [
    {
        name: 'quoteExactInputSingle',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{
            name: 'params',
            type: 'tuple',
            components: [
                { name: 'tokenIn',           type: 'address' },
                { name: 'tokenOut',          type: 'address' },
                { name: 'amountIn',          type: 'uint256' },
                { name: 'fee',               type: 'uint24'  },
                { name: 'sqrtPriceLimitX96', type: 'uint160' }
            ]
        }],
        outputs: [
            { name: 'amountOut',               type: 'uint256' },
            { name: 'sqrtPriceX96After',       type: 'uint160' },
            { name: 'initializedTicksCrossed', type: 'uint32'  },
            { name: 'gasEstimate',             type: 'uint256' }
        ]
    }
] as const;

// SwapRouter02 ABI — Uniswap V3 (exactInputSingle uses fee: uint24)
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

// Aerodrome CL (Slipstream) SwapRouter ABI — uses tickSpacing: int24 + deadline instead of fee
const AERODROME_CL_ABI = [
    {
        name: 'exactInputSingle',
        type: 'function',
        inputs: [{
            name: 'params',
            type: 'tuple',
            components: [
                { name: 'tokenIn',           type: 'address' },
                { name: 'tokenOut',          type: 'address' },
                { name: 'tickSpacing',       type: 'int24'   },
                { name: 'recipient',         type: 'address' },
                { name: 'deadline',          type: 'uint256' },
                { name: 'amountIn',          type: 'uint256' },
                { name: 'amountOutMinimum',  type: 'uint256' },
                { name: 'sqrtPriceLimitX96', type: 'uint160' }
            ]
        }],
        outputs: [{ name: 'amountOut', type: 'uint256' }]
    }
] as const;

// Pool ABI — read tickSpacing for Aerodrome CL pools
const POOL_TICK_SPACING_ABI = [
    { name: 'tickSpacing', type: 'function', inputs: [], outputs: [{ type: 'int24' }], stateMutability: 'view' }
] as const;

// Aerodrome V2 (classic AMM) Router — uses swapExactETHForTokens / swapExactTokensForETH
const AERODROME_V2_ROUTER = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43' as Address;
const AERODROME_V2_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40D' as Address;

const AERODROME_V2_ABI = [
    {
        name: 'swapExactETHForTokens',
        type: 'function',
        stateMutability: 'payable',
        inputs: [
            { name: 'amountOutMin', type: 'uint256' },
            { name: 'routes', type: 'tuple[]', components: [
                { name: 'from',    type: 'address' },
                { name: 'to',      type: 'address' },
                { name: 'stable',  type: 'bool'    },
                { name: 'factory', type: 'address' }
            ]},
            { name: 'to',       type: 'address' },
            { name: 'deadline', type: 'uint256' }
        ],
        outputs: [{ name: 'amounts', type: 'uint256[]' }]
    },
    {
        name: 'swapExactTokensForETH',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'amountIn',     type: 'uint256' },
            { name: 'amountOutMin', type: 'uint256' },
            { name: 'routes', type: 'tuple[]', components: [
                { name: 'from',    type: 'address' },
                { name: 'to',      type: 'address' },
                { name: 'stable',  type: 'bool'    },
                { name: 'factory', type: 'address' }
            ]},
            { name: 'to',       type: 'address' },
            { name: 'deadline', type: 'uint256' }
        ],
        outputs: [{ name: 'amounts', type: 'uint256[]' }]
    },
    {
        name: 'getAmountsOut',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            { name: 'amountIn', type: 'uint256' },
            { name: 'routes', type: 'tuple[]', components: [
                { name: 'from',    type: 'address' },
                { name: 'to',      type: 'address' },
                { name: 'stable',  type: 'bool'    },
                { name: 'factory', type: 'address' }
            ]}
        ],
        outputs: [{ name: 'amounts', type: 'uint256[]' }]
    }
] as const;

// Uniswap V2-style ABI (used by BaseSwap V2, Uniswap V2, SwapBased, AlienBase V2, etc.)
const UNISWAP_V2_ABI = [
    {
        name: 'swapExactETHForTokens',
        type: 'function',
        stateMutability: 'payable',
        inputs: [
            { name: 'amountOutMin', type: 'uint256' },
            { name: 'path',         type: 'address[]' },
            { name: 'to',           type: 'address'   },
            { name: 'deadline',     type: 'uint256'   }
        ],
        outputs: [{ name: 'amounts', type: 'uint256[]' }]
    },
    {
        name: 'swapExactTokensForETH',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'amountIn',     type: 'uint256'   },
            { name: 'amountOutMin', type: 'uint256'   },
            { name: 'path',         type: 'address[]' },
            { name: 'to',           type: 'address'   },
            { name: 'deadline',     type: 'uint256'   }
        ],
        outputs: [{ name: 'amounts', type: 'uint256[]' }]
    },
    {
        name: 'getAmountsOut',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            { name: 'amountIn', type: 'uint256'   },
            { name: 'path',     type: 'address[]' }
        ],
        outputs: [{ name: 'amounts', type: 'uint256[]' }]
    }
] as const;

// Uniswap V2-style routers on Base (all share same ABI interface)
const V2_ROUTERS: Array<{ label: string; address: Address }> = [
    { label: 'BaseSwap V2',  address: '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86' as Address },
    { label: 'Uniswap V2',   address: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' as Address },
    { label: 'AlienBase V2', address: '0x8c1A3cF8f83074169FE5D7aD50B978e1cD6b37c7' as Address },
    { label: 'SwapBased V2', address: '0xaaa3b1F1bd7BCc97fD1917c18ADE665C5D31361a' as Address },
];

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
    private backupClients: PublicClient[] = [];
    private account: ReturnType<typeof privateKeyToAccount>;
    private openPositions: Map<Address, OpenPosition> = new Map();
    private knownTokens: Set<Address> = new Set();
    private positionMonitorInterval: NodeJS.Timeout | null = null;
    private isReady = false;

    private buyLock = false;   // mutex: prevent concurrent buy TXs (nonce collision)
    private buyQueue: Array<() => void> = [];

    private async acquireBuyLock(): Promise<void> {
        if (!this.buyLock) { this.buyLock = true; return; }
        await new Promise<void>(resolve => this.buyQueue.push(resolve));
        this.buyLock = true;
    }
    private releaseBuyLock(): void {
        const next = this.buyQueue.shift();
        if (next) { next(); }
        else { this.buyLock = false; }
    }

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

        const rpcUrl = process.env.BASE_HTTP_URL || 'https://mainnet.base.org';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) }) as any;
        this.walletClient = createWalletClient({ account: this.account, chain: base, transport: http(rpcUrl) });

        // Backup RPC clients for receipt fallback (rotate when primary fails)
        const backupRpcs = [
            'https://base.llamarpc.com',
            'https://base-rpc.publicnode.com',
            'https://1rpc.io/base',
            'https://base.meowrpc.com',
        ].filter(u => u !== rpcUrl);
        this.backupClients = backupRpcs.map(u => createPublicClient({ chain: base, transport: http(u) }) as any);

        this.isReady = true;

        console.log('💼 SwapExecutor initialized');
        console.log(`   Wallet: ${this.account.address}`);
        console.log(`   RPC:    ${rpcUrl}`);
        console.log(`   Mode:   ${this.CONFIG.GAS_MODE.toUpperCase()}`);
    }

    // Load persisted open positions from DB after initDb() completes
    loadPositionsFromDb(): void {
        try {
            const rows = dbLoadOpenPositions();
            if (rows.length === 0) return;
            for (const r of rows) {
                const addr = r.tokenAddress as Address;
                this.openPositions.set(addr, {
                    tokenAddress:       addr,
                    tokenSymbol:        r.tokenSymbol,
                    amountIn:           BigInt(r.amountInWei),
                    amountOut:          BigInt(r.amountOutWei),
                    entryPrice:         r.entryPriceEth,
                    openedAt:           r.openedAt,
                    txHash:             r.txHash as any,
                    takeProfit1Hit:     r.tp1Hit,
                    takeProfit2Hit:     r.tp2Hit,
                    takeProfit3Hit:     r.tp3Hit,
                    peakValueEth:       r.peakValueEth,
                    dcaDone:            r.dcaDone,
                    sourceWallet:       r.sourceWallet,
                    initialLiquidityUsd: r.initLiqUsd,
                    tp1SoldPct:         r.tp1SoldPct,
                    tp2SoldPct:         r.tp2SoldPct,
                });
                this.knownTokens.add(addr.toLowerCase() as Address);
            }
            console.log(`♻️  Restored ${rows.length} open position(s) from DB`);
            this.startPositionMonitor();
        } catch (e: any) {
            console.warn(`⚠️  Could not restore positions from DB: ${e?.message}`);
        }
    }

    // ============ QUOTE HELPERS ============

    /**
     * Get expected token output for a Uniswap V3 buy using QuoterV2 (eth_call, no TX).
     * Returns null on failure — caller must fall back to amountOutMinimum=0.
     */
    private async getV3QuotedAmountOut(
        tokenIn: Address, tokenOut: Address, amountIn: bigint, fee: 500 | 3000 | 10000
    ): Promise<bigint | null> {
        try {
            const result = await this.publicClient.simulateContract({
                address:      UNISWAP_V3_QUOTER_V2,
                abi:          QUOTER_V2_ABI,
                functionName: 'quoteExactInputSingle',
                args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
            });
            const out = (result.result as any)[0] ?? result.result;
            const outBig = typeof out === 'bigint' ? out : BigInt(out);
            return outBig > 0n ? outBig : null;
        } catch {
            return null;
        }
    }

    /**
     * Get expected token output for a V2-style or Aerodrome V2 buy using getAmountsOut.
     * Returns null on failure.
     */
    private async getV2QuotedAmountOut(
        tokenAddress: Address,
        amountIn: bigint,
        route: { dex: string; v2Router?: Address; stable?: boolean }
    ): Promise<bigint | null> {
        try {
            if (route.dex === 'aerodrome-v2') {
                const r = [{ from: WETH_BASE, to: tokenAddress, stable: route.stable ?? false, factory: AERODROME_V2_FACTORY }];
                const amounts = await this.publicClient.readContract({
                    address: AERODROME_V2_ROUTER, abi: AERODROME_V2_ABI, functionName: 'getAmountsOut',
                    args: [amountIn, r]
                }) as bigint[];
                const out = amounts?.[1] ?? 0n;
                return out > 0n ? out : null;
            }
            if (route.dex === 'uniswap-v2' && route.v2Router) {
                const path: readonly [Address, Address] = [WETH_BASE, tokenAddress];
                const amounts = await this.publicClient.readContract({
                    address: route.v2Router, abi: UNISWAP_V2_ABI, functionName: 'getAmountsOut',
                    args: [amountIn, path]
                }) as bigint[];
                const out = amounts?.[1] ?? 0n;
                return out > 0n ? out : null;
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Apply slippage to a quoted amount to get amountOutMinimum.
     * slippagePct = e.g. 8 means 8%.
     */
    private applySlippage(quotedOut: bigint, slippagePct: number): bigint {
        const bps = BigInt(Math.round(slippagePct * 100));
        return (quotedOut * (10000n - bps)) / 10000n;
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

    // ── Robust receipt waiting with multi-RPC rotation fallback ──
    private async waitForReceiptRobust(txHash: Hex, timeout = 90_000): Promise<{ status: 'success' | 'reverted'; gasUsed: bigint }> {
        const deadline = Date.now() + timeout;
        const allClients = [this.publicClient, ...this.backupClients];
        let lastErr: any = null;
        let attempt = 0;
        while (Date.now() < deadline) {
            const client = allClients[attempt % allClients.length];
            try {
                const remaining = deadline - Date.now();
                const r = await client.waitForTransactionReceipt({ hash: txHash, timeout: Math.min(20_000, remaining) });
                return r;
            } catch (err: any) {
                lastErr = err;
                for (const c of allClients) {
                    try {
                        const r = await c.getTransactionReceipt({ hash: txHash });
                        if (r) return r;
                    } catch { /* not mined yet on this RPC */ }
                }
                await new Promise(r => setTimeout(r, 2000));
                attempt++;
            }
        }
        for (const c of allClients) {
            try {
                const r = await c.getTransactionReceipt({ hash: txHash });
                if (r) return r;
            } catch { /* ignore */ }
        }
        throw lastErr ?? new Error('Receipt timeout');
    }

    // ============ BUY TOKEN (ETH → Token) ============
    async buy(params: SwapParams): Promise<SwapResult> {
        if (!this.isReady) return { success: false, amountIn: 0n, amountOut: 0n, error: 'Executor not ready' };

        const { tokenAddress, amountInEth, slippagePercent = this.CONFIG.DEFAULT_SLIPPAGE, feeTier = 3000 } = params;
        const amountIn = parseEther(amountInEth.toString());

        console.log(`\n🛒 BUY: ${amountInEth} ETH → ${tokenAddress.slice(0, 10)}...`);

        // ── Sequential buy mutex — prevent nonce collision ──
        await this.acquireBuyLock();

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

            // ── Dynamic slippage: scale tolerance with trade size vs pool liquidity ──
            // Small pool or large trade → wider tolerance (up to 15%)
            // Large pool or tiny trade → tighter tolerance (as low as 1%)
            let effectiveSlippage = slippagePercent;
            if (impact.liquidityUsd > 0) {
                const liveEthPrice  = await getEthPriceUsd().catch(() => 3000);
                const tradeUsd      = amountInEth * liveEthPrice;
                const tradeSharePct = (tradeUsd / impact.liquidityUsd) * 100;
                effectiveSlippage   = Math.max(1, Math.min(15, 2 + tradeSharePct * 2));
                console.log(`   🎯 Dynamic slippage: ${effectiveSlippage.toFixed(1)}% (trade $${tradeUsd.toFixed(0)} = ${tradeSharePct.toFixed(2)}% of pool $${impact.liquidityUsd.toFixed(0)})`);
            }

            // ── DEX-aware routing: detect best DEX and simulate before sending ──
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);

            const swapRoute = await this.detectSwapRoute(tokenAddress, amountIn, 0n, 'buy');
            if (!swapRoute.ok) {
                return { success: false, amountIn, amountOut: 0n, error: swapRoute.error ?? 'No valid swap route found' };
            }

            console.log(`   ⛽ DEX: ${swapRoute.dex} | Route: ${swapRoute.label}`);

            // ── Get on-chain quote → compute real amountOutMinimum with slippage ──
            // For V3: use QuoterV2 (eth_call). For V2/Aerodrome: use getAmountsOut.
            // Falls back to 0 only when quote is unavailable (new token not yet indexed).
            let quotedOut: bigint | null = null;
            if (swapRoute.dex === 'uniswap-v3' && swapRoute.fee) {
                quotedOut = await this.getV3QuotedAmountOut(WETH_BASE, tokenAddress, amountIn, swapRoute.fee);
            } else if (swapRoute.dex === 'aerodrome-v2' || swapRoute.dex === 'uniswap-v2') {
                quotedOut = await this.getV2QuotedAmountOut(tokenAddress, amountIn, swapRoute);
            }

            let amountOutMinimum = 0n;
            if (quotedOut !== null && quotedOut > 0n) {
                amountOutMinimum = this.applySlippage(quotedOut, effectiveSlippage);
                console.log(`   🛡️ Slippage guard: min out = ${amountOutMinimum} (quoted=${quotedOut}, slippage=${effectiveSlippage.toFixed(1)}%)`);
            } else {
                console.log(`   ⚠️  Quote unavailable — amountOutMinimum=0 (simulation-only protection, slippage=${effectiveSlippage.toFixed(1)}%)`);
            }

            const gasPrice = await this.getGasPrice();
            let txHash: Hex;

            if (swapRoute.dex === 'aerodrome-cl') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                txHash = await (this.walletClient as any).writeContract({
                    address: AERODROME_CL_ROUTER,
                    abi: AERODROME_CL_ABI,
                    functionName: 'exactInputSingle',
                    args: [{
                        tokenIn: WETH_BASE, tokenOut: tokenAddress,
                        tickSpacing: swapRoute.tickSpacing!,
                        recipient: this.account.address,
                        deadline, amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n
                    }],
                    value: amountIn,
                    ...gasPrice
                });
            } else if (swapRoute.dex === 'aerodrome-v2') {
                const route = [{ from: WETH_BASE, to: tokenAddress, stable: swapRoute.stable ?? false, factory: AERODROME_V2_FACTORY }];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                txHash = await (this.walletClient as any).writeContract({
                    address: AERODROME_V2_ROUTER,
                    abi: AERODROME_V2_ABI,
                    functionName: 'swapExactETHForTokens',
                    args: [amountOutMinimum, route, this.account.address, deadline],
                    value: amountIn,
                    ...gasPrice
                });
            } else if (swapRoute.dex === 'uniswap-v2') {
                const path: readonly [Address, Address] = [WETH_BASE, tokenAddress];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                txHash = await (this.walletClient as any).writeContract({
                    address: swapRoute.v2Router!,
                    abi: UNISWAP_V2_ABI,
                    functionName: 'swapExactETHForTokens',
                    args: [amountOutMinimum, path, this.account.address, deadline],
                    value: amountIn,
                    ...gasPrice
                });
            } else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                txHash = await (this.walletClient as any).writeContract({
                    address: UNISWAP_V3_ROUTER,
                    abi: ROUTER_ABI,
                    functionName: 'exactInputSingle',
                    args: [{
                        tokenIn: WETH_BASE, tokenOut: tokenAddress,
                        fee: swapRoute.fee!,
                        recipient: this.account.address,
                        amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n
                    }],
                    value: amountIn,
                    ...gasPrice
                });
            }

            console.log(`   📤 TX sent: ${txHash}`);

            const receipt = await this.waitForReceiptRobust(txHash);

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
            const posData = {
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
            };
            this.openPositions.set(tokenAddress, posData);
            // Persist to DB so position survives restarts
            dbSaveOpenPosition({
                tokenAddress, tokenSymbol,
                amountInWei:   amountIn.toString(),
                amountOutWei:  tokenBalance.toString(),
                entryPriceEth: amountInEth,
                openedAt:      posData.openedAt,
                txHash, peakValueEth: amountInEth,
                tp1Hit: false, tp2Hit: false, tp3Hit: false,
                tp1SoldPct: 0, tp2SoldPct: 0, dcaDone: false,
                sourceWallet: params.sourceWallet,
                initLiqUsd: impact.liquidityUsd,
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
        } finally {
            this.releaseBuyLock();
        }
    }

    // ============ SELL TOKEN (Token → ETH) ============
    async sell(tokenAddress: Address, percentToSell: number = 100, options?: { source?: string; tpLevel?: number }): Promise<SwapResult> {
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

            // ── DEX-aware routing: approve correct router, then send ──
            const amountOutMinimum = 0n; // must succeed — accept any ETH output
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);

            // Detect which DEX/router to use for this token
            const sellRoute = await this.detectSwapRoute(tokenAddress, amountIn, amountOutMinimum, 'sell');

            // Approve the correct router (Uniswap V3, Aerodrome CL, Aerodrome V2, or V2-style)
            const routerToApprove = sellRoute.dex === 'aerodrome-cl' ? AERODROME_CL_ROUTER
                                  : sellRoute.dex === 'aerodrome-v2' ? AERODROME_V2_ROUTER
                                  : sellRoute.dex === 'uniswap-v2'   ? sellRoute.v2Router!
                                  : UNISWAP_V3_ROUTER;
            const allowance = await this.publicClient.readContract({
                address:      tokenAddress,
                abi:          ERC20_ABI,
                functionName: 'allowance',
                args:         [this.account.address, routerToApprove]
            }) as bigint;

            if (allowance < amountIn) {
                console.log(`   📝 Approving ${sellRoute.dex} router...`);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const approveTx = await (this.walletClient as any).writeContract({
                    address:      tokenAddress,
                    abi:          ERC20_ABI,
                    functionName: 'approve',
                    args:         [routerToApprove, MAX_UINT256],
                    ...gasPrice
                });
                await this.waitForReceiptRobust(approveTx, 45_000);
            } else {
                console.log(`   ✅ Router already approved — skipping approve TX (saved ~$0.001)`);
            }

            console.log(`   ⛽ Sell DEX: ${sellRoute.dex} | ${sellRoute.label}`);

            let txHash: Hex;
            if (sellRoute.dex === 'aerodrome-cl') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                txHash = await (this.walletClient as any).writeContract({
                    address: AERODROME_CL_ROUTER,
                    abi: AERODROME_CL_ABI,
                    functionName: 'exactInputSingle',
                    args: [{
                        tokenIn: tokenAddress, tokenOut: WETH_BASE,
                        tickSpacing: sellRoute.tickSpacing!,
                        recipient: this.account.address,
                        deadline, amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n
                    }],
                    ...gasPrice
                });
            } else if (sellRoute.dex === 'aerodrome-v2') {
                const route = [{ from: tokenAddress, to: WETH_BASE, stable: sellRoute.stable ?? false, factory: AERODROME_V2_FACTORY }];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                txHash = await (this.walletClient as any).writeContract({
                    address: AERODROME_V2_ROUTER,
                    abi: AERODROME_V2_ABI,
                    functionName: 'swapExactTokensForETH',
                    args: [amountIn, amountOutMinimum, route, this.account.address, deadline],
                    ...gasPrice
                });
            } else if (sellRoute.dex === 'uniswap-v2') {
                const path: readonly [Address, Address] = [tokenAddress, WETH_BASE];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                txHash = await (this.walletClient as any).writeContract({
                    address: sellRoute.v2Router!,
                    abi: UNISWAP_V2_ABI,
                    functionName: 'swapExactTokensForETH',
                    args: [amountIn, amountOutMinimum, path, this.account.address, deadline],
                    ...gasPrice
                });
            } else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                txHash = await (this.walletClient as any).writeContract({
                    address: UNISWAP_V3_ROUTER,
                    abi: ROUTER_ABI,
                    functionName: 'exactInputSingle',
                    args: [{
                        tokenIn: tokenAddress, tokenOut: WETH_BASE,
                        fee: sellRoute.fee!,
                        recipient: this.account.address,
                        amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n
                    }],
                    ...gasPrice
                });
            }

            console.log(`   📤 TX sent: ${txHash}`);
            const receipt = await this.waitForReceiptRobust(txHash);

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

            this.emit('sell-success', { tokenAddress, tokenSymbol, amountIn, percentSold: percentToSell, txHash, sourceWallet: _sellSw, profitPct, holdMs, entryEth, source: options?.source, tpLevel: options?.tpLevel });

            // Remove position if fully sold
            if (percentToSell >= 100) {
                this.openPositions.delete(tokenAddress);
                dbDeleteOpenPosition(tokenAddress);
                // Also remove from knownTokens so it's not scanned on future portfolio polls
                this.knownTokens.delete(tokenAddress.toLowerCase() as Address);
                this.knownTokens.delete(tokenAddress as Address);
            } else {
                // Scale down position proportionally so P&L stays accurate after partial sells.
                // Example: sold 30% → remaining cost basis = 70% of original amountIn.
                // Without this, profitPct after TP1 looks like -30% even when still profitable.
                const pos = this.openPositions.get(tokenAddress);
                if (pos) {
                    const remainingPct = BigInt(100 - percentToSell);
                    pos.amountIn  = pos.amountIn  * remainingPct / 100n;
                    pos.amountOut = pos.amountOut * remainingPct / 100n;
                    dbSaveOpenPosition({
                        tokenAddress, tokenSymbol: pos.tokenSymbol,
                        amountInWei: pos.amountIn.toString(),
                        amountOutWei: pos.amountOut.toString(),
                        entryPriceEth: pos.entryPrice,
                        openedAt: pos.openedAt, txHash: pos.txHash,
                        peakValueEth: pos.peakValueEth,
                        tp1Hit: pos.takeProfit1Hit, tp2Hit: pos.takeProfit2Hit, tp3Hit: pos.takeProfit3Hit,
                        tp1SoldPct: pos.tp1SoldPct ?? 0, tp2SoldPct: pos.tp2SoldPct ?? 0,
                        dcaDone: pos.dcaDone, sourceWallet: pos.sourceWallet,
                        initLiqUsd: pos.initialLiquidityUsd ?? 0,
                    });
                }
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
            dbDeleteOpenPosition(tokenAddress);
            return;
        }

        // Estimate current ETH value
        const currentValueEth = await this.estimateTokenValueEth(tokenAddress, currentBalance);

        // If price oracle completely fails, still enforce the timeout exit
        // so positions don't hold forever when GeckoTerminal has no data yet
        if (currentValueEth === null) {
            const holdMinsNoPrice = (Date.now() - position.openedAt) / 60000;
            console.log(`   ⚠️ ${position.tokenSymbol}: price oracle unavailable (${holdMinsNoPrice.toFixed(1)}min held, limit=${this.CONFIG.MAX_HOLD_MINUTES}min)`);
            if (holdMinsNoPrice >= this.CONFIG.MAX_HOLD_MINUTES) {
                console.log(`⏰ TIMEOUT EXIT (no price): selling ${position.tokenSymbol} after ${holdMinsNoPrice.toFixed(0)}min`);
                this.emit('stop-loss', {
                    tokenAddress, tokenSymbol: position.tokenSymbol, profitPct: null,
                    reason: `⏰ Timeout (${this.CONFIG.MAX_HOLD_MINUTES}min — price oracle unavailable)`,
                    peakMult: 1, sourceWallet: position.sourceWallet,
                    holdMs: Date.now() - position.openedAt,
                });
                await this.sell(tokenAddress, 100, { source: 'stop-loss' });
            }
            return;
        }

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
            await this.sell(tokenAddress, 100, { source: 'stop-loss' });
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
            await this.sell(tokenAddress, 100, { source: 'stop-loss' });
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

        // ─── BREAKEVEN GUARD: after TP1, never let position go net negative ───
        // Once we've locked in partial profit at TP1, protect capital by selling
        // everything the moment price falls back to entry (profitPct ≤ 0).
        if (position.takeProfit1Hit && profitPct <= 0) {
            const reason = `🛡️ Breakeven guard: ${profitPct.toFixed(1)}% setelah TP1 — jual sisa posisi`;
            console.log(`🛡️ BREAKEVEN GUARD: ${position.tokenSymbol} balik ke ${profitPct.toFixed(1)}% setelah TP1 — protecting profits`);
            this.emit('stop-loss', { tokenAddress, tokenSymbol: position.tokenSymbol, profitPct, reason, peakMult, sourceWallet: position.sourceWallet });
            await this.sell(tokenAddress, 100, { source: 'stop-loss' });
            return;
        }

        // ─── STOP LOSS (Fixed or Trailing) ───
        if (slTriggered) {
            const reason = useTrailingSL
                ? `Trailing SL: -${dropFromPeak.toFixed(1)}% from peak`
                : `Fixed SL: ${profitPct.toFixed(1)}%`;
            console.log(`🛑 STOP LOSS triggered (${reason}) — selling 100%`);
            this.emit('stop-loss', { tokenAddress, tokenSymbol: position.tokenSymbol, profitPct, reason, peakMult, sourceWallet: position.sourceWallet });
            await this.sell(tokenAddress, 100, { source: 'stop-loss' });
            return;
        }

        // ─── MINIMUM LIQUIDITY GUARD ─── exit if liquidity drained ≥50%
        if (position.initialLiquidityUsd > 100) {
            try {
                const liqCheck = await this.checkPriceImpact(tokenAddress, 0.001);
                if (liqCheck.liquidityUsd > 0) {
                    const liqDrop = ((position.initialLiquidityUsd - liqCheck.liquidityUsd) / position.initialLiquidityUsd) * 100;
                    if (liqDrop >= this.CONFIG.LIQUIDITY_DROP_EXIT_PCT) {
                        console.log(`💧 LIQUIDITY GUARD: ${position.tokenSymbol} liquidity dropped ${liqDrop.toFixed(0)}% — exiting!`);
                        this.emit('stop-loss', {
                            tokenAddress, tokenSymbol: position.tokenSymbol, profitPct,
                            reason: `💧 Liquidity dropped ${liqDrop.toFixed(0)}% (rug/dump suspected)`,
                            peakMult, sourceWallet: position.sourceWallet
                        });
                        await this.sell(tokenAddress, 100, { source: 'stop-loss' });
                        return;
                    }
                }
            } catch { /* silent — don't block position monitor */ }
        }

        // ─── PROFIT LADDER TP1: sell 30% at 1.5x (+50%) ───
        if (!position.takeProfit1Hit && multiplier >= this.CONFIG.TAKE_PROFIT_1_X) {
            const sellPct = this.CONFIG.TAKE_PROFIT_1_PCT;
            console.log(`🎯 TP1 at ${multiplier.toFixed(2)}x (+${((multiplier-1)*100).toFixed(0)}%) — sell ${sellPct}%`);
            this.emit('take-profit', { tokenAddress, tokenSymbol: position.tokenSymbol, level: 1, multiplier, profitPct, holdMs: Date.now() - position.openedAt, sourceWallet: position.sourceWallet });
            await this.sell(tokenAddress, sellPct, { source: 'take-profit', tpLevel: 1 });
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
            console.log(`🎯 TP2 at ${multiplier.toFixed(2)}x (+${((multiplier-1)*100).toFixed(0)}%) — sell ${sellPct}% of remaining`);
            this.emit('take-profit', { tokenAddress, tokenSymbol: position.tokenSymbol, level: 2, multiplier, profitPct, holdMs: Date.now() - position.openedAt, sourceWallet: position.sourceWallet });
            await this.sell(tokenAddress, sellPct, { source: 'take-profit', tpLevel: 2 });
            position.takeProfit2Hit = true;
            position.tp2SoldPct = tp2Pct;
            return;
        }

        // ─── PROFIT LADDER TP3: trailing stop on remaining ~40% ───
        if (position.takeProfit2Hit && !position.takeProfit3Hit && profitPct >= this.CONFIG.TRAILING_TP3_ACTIVATE_PCT) {
            if (dropFromPeak >= this.CONFIG.TRAILING_TP3_FROM_PEAK_PCT) {
                console.log(`🎯 TP3 Trailing — dropped ${dropFromPeak.toFixed(1)}% from peak — sell all remaining`);
                this.emit('take-profit', { tokenAddress, tokenSymbol: position.tokenSymbol, level: 3, multiplier, profitPct, holdMs: Date.now() - position.openedAt, sourceWallet: position.sourceWallet });
                await this.sell(tokenAddress, 100, { source: 'take-profit', tpLevel: 3 });
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

        // ─── DYNAMIC EXIT: momentum-based OHLCV exit (active after TP1) ───
        // Uses momentum & volume signals from GeckoTerminal for more precise exits.
        // Guard: skip if the TP ladder is about to handle this price level to avoid double-sells.
        //   - TP2 fires at TAKE_PROFIT_2_X (default 2.5x / +150%) — skip dynamic scaling above that
        //   - TP3 trailing already handled above — skip dynamic if TP2 already hit
        const tp2AboutToFire = position.takeProfit1Hit && !position.takeProfit2Hit && multiplier >= this.CONFIG.TAKE_PROFIT_2_X;
        if (position.takeProfit1Hit && !position.takeProfit3Hit && !tp2AboutToFire) {
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
                    console.log(`📉 [DynamicExit] PANIC — reversal momentum detected, selling 100% of ${position.tokenSymbol}`);
                    this.emit('stop-loss', {
                        tokenAddress, tokenSymbol: position.tokenSymbol, profitPct,
                        reason: `📉 Reversal momentum (dynamic exit)`,
                        peakMult, sourceWallet: position.sourceWallet,
                        holdMs: Date.now() - position.openedAt,
                    });
                    await this.sell(tokenAddress, 100, { source: 'stop-loss' });
                    return;
                }

                // Skip scaling signals if TP2 has already sold its portion (avoid double-sell)
                if (exitSignal === 'SELL_50_PERCENT' && !position.dynamicSell50Done && !position.takeProfit2Hit) {
                    console.log(`📉 [DynamicExit] Momentum weakening — selling 50% of ${position.tokenSymbol}`);
                    this.emit('take-profit', {
                        tokenAddress, tokenSymbol: position.tokenSymbol,
                        level: 2, multiplier, profitPct,
                        holdMs: Date.now() - position.openedAt,
                        sourceWallet: position.sourceWallet,
                    });
                    await this.sell(tokenAddress, 50, { source: 'take-profit', tpLevel: 2 });
                    position.dynamicSell50Done = true;
                    return;
                }

                if (exitSignal === 'SELL_25_PERCENT' && !position.dynamicSell25Done && !position.takeProfit2Hit) {
                    console.log(`📉 [DynamicExit] Scale out — selling 25% of ${position.tokenSymbol}`);
                    await this.sell(tokenAddress, 25, { source: 'take-profit', tpLevel: 2 });
                    position.dynamicSell25Done = true;
                    return;
                }

                if (exitSignal === 'SELL_ALL_TRAILING' || exitSignal === 'SELL_ALL_TIMEOUT') {
                    console.log(`📉 [DynamicExit] ${exitSignal} — selling all remaining ${position.tokenSymbol}`);
                    this.emit('take-profit', {
                        tokenAddress, tokenSymbol: position.tokenSymbol,
                        level: 3, multiplier, profitPct,
                        holdMs: Date.now() - position.openedAt,
                        sourceWallet: position.sourceWallet,
                    });
                    await this.sell(tokenAddress, 100, { source: 'take-profit', tpLevel: 3 });
                    position.takeProfit3Hit = true;
                    return;
                }
            } catch { /* silent — don't block position monitor */ }
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

    // ============ DEX-AWARE SWAP ROUTE DETECTION ============
    /**
     * Detect the best DEX and swap parameters for a token.
     * Tries GeckoTerminal first (for known DEX), then on-chain factory, then simulation.
     * Supports: Uniswap V3 and Aerodrome CL (Slipstream).
     */
    private async detectSwapRoute(
        tokenAddress: Address,
        amountIn: bigint,
        amountOutMinimum: bigint,
        direction: 'buy' | 'sell',
    ): Promise<{ ok: boolean; dex: 'uniswap-v3' | 'aerodrome-cl' | 'aerodrome-v2' | 'uniswap-v2'; fee?: 500 | 3000 | 10000; tickSpacing?: number; stable?: boolean; v2Router?: Address; label: string; error?: string }> {
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);

        // ── Step 1: Check GeckoTerminal pair data for known DEX ──
        try {
            const pairs = await getDexUniV3Pairs(tokenAddress); // returns ALL pairs now
            // Sort by liquidity descending
            const sorted = pairs.slice().sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

            for (const pair of sorted) {
                const dexId = pair.dexId ?? '';

                // Skip DEXes we cannot trade on (Uniswap V4 uses PoolManager — not supported)
                if (dexId.includes('uniswap-v4') || dexId.includes('pancakeswap-v3') || dexId.includes('sushiswap-v3')) {
                    console.log(`   ℹ️  DEX "${dexId}" not yet supported — skipping this pool`);
                    continue;
                }

                if (dexId === 'uniswap-v3' && pair.feeTier) {
                    // Known Uniswap V3 pool with fee tier — simulate to confirm
                    try {
                        const tokenIn = direction === 'buy' ? WETH_BASE : tokenAddress;
                        const tokenOut = direction === 'buy' ? tokenAddress : WETH_BASE;
                        await this.publicClient.simulateContract({
                            address: UNISWAP_V3_ROUTER, abi: ROUTER_ABI, functionName: 'exactInputSingle',
                            args: [{ tokenIn, tokenOut, fee: pair.feeTier, recipient: this.account.address, amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n }],
                            ...(direction === 'buy' ? { value: amountIn } : {}),
                            account: this.account.address,
                        });
                        return { ok: true, dex: 'uniswap-v3', fee: pair.feeTier, label: `Uniswap V3 fee=${pair.feeTier / 100}bps` };
                    } catch { /* try next */ }
                }

                if (dexId === 'aerodrome-slipstream') {
                    // Known Aerodrome CL pool — get tick spacing
                    let ts = pair.tickSpacing;
                    if (!ts && pair.pairAddress) {
                        try {
                            ts = await this.publicClient.readContract({
                                address: pair.pairAddress as Address, abi: POOL_TICK_SPACING_ABI, functionName: 'tickSpacing'
                            }) as number;
                        } catch { ts = 200; } // common default
                    }
                    ts = ts ?? 200;
                    // Simulate Aerodrome CL swap
                    try {
                        const tokenIn = direction === 'buy' ? WETH_BASE : tokenAddress;
                        const tokenOut = direction === 'buy' ? tokenAddress : WETH_BASE;
                        await this.publicClient.simulateContract({
                            address: AERODROME_CL_ROUTER, abi: AERODROME_CL_ABI, functionName: 'exactInputSingle',
                            args: [{ tokenIn, tokenOut, tickSpacing: ts, recipient: this.account.address, deadline, amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n }],
                            ...(direction === 'buy' ? { value: amountIn } : {}),
                            account: this.account.address,
                        });
                        return { ok: true, dex: 'aerodrome-cl', tickSpacing: ts, label: `Aerodrome CL tickSpacing=${ts}` };
                    } catch { /* try next */ }
                }

                // Aerodrome V2 (classic AMM) — try volatile then stable
                if (dexId === 'aerodrome-v2' || dexId === 'aerodrome' || dexId === 'aerodrome-finance') {
                    for (const stable of [false, true]) {
                        const route = [{ from: direction === 'buy' ? WETH_BASE : tokenAddress, to: direction === 'buy' ? tokenAddress : WETH_BASE, stable, factory: AERODROME_V2_FACTORY }];
                        try {
                            const amounts = await this.publicClient.readContract({
                                address: AERODROME_V2_ROUTER, abi: AERODROME_V2_ABI, functionName: 'getAmountsOut',
                                args: [amountIn, route]
                            }) as bigint[];
                            if (amounts && amounts.length >= 2 && amounts[1] > 0n) {
                                return { ok: true, dex: 'aerodrome-v2', stable, label: `Aerodrome V2 ${stable ? 'stable' : 'volatile'} (GeckoTerminal)` };
                            }
                        } catch { /* try next */ }
                    }
                }

                // V2-style DEX from GeckoTerminal (BaseSwap, AlienBase, etc.) — brute-force all V2 routers
                const isV2Style = dexId.includes('v2') || dexId.includes('baseswap') || dexId.includes('alienbase') || dexId.includes('swapbased') || dexId.includes('uniswap-v2') || dexId.includes('pancakeswap-v2');
                if (isV2Style) {
                    const path: readonly [Address, Address] = direction === 'buy' ? [WETH_BASE, tokenAddress] : [tokenAddress, WETH_BASE];
                    for (const router of V2_ROUTERS) {
                        try {
                            const amounts = await this.publicClient.readContract({
                                address: router.address, abi: UNISWAP_V2_ABI, functionName: 'getAmountsOut',
                                args: [amountIn, path]
                            }) as bigint[];
                            if (amounts && amounts.length >= 2 && amounts[1] > 0n) {
                                return { ok: true, dex: 'uniswap-v2', v2Router: router.address, label: `${router.label} (GeckoTerminal dexId=${dexId})` };
                            }
                        } catch { /* try next */ }
                    }
                }

                // Unknown DEX — log it for future support
                if (dexId !== 'uniswap-v3' && dexId !== 'aerodrome-slipstream' && dexId !== 'aerodrome-v2' && dexId !== 'aerodrome' && !dexId.includes('v2')) {
                    console.log(`   ⚠️  Unknown DEX from GeckoTerminal: "${dexId}" — will try on-chain brute-force`);
                }
            }
        } catch { /* GeckoTerminal failed — fall through to on-chain detection */ }

        // ── Step 2: On-chain Uniswap V3 factory scan ──
        const v3Fee = await getOnChainFeeTier(this.publicClient, tokenAddress);
        if (v3Fee !== null) {
            const tokenIn = direction === 'buy' ? WETH_BASE : tokenAddress;
            const tokenOut = direction === 'buy' ? tokenAddress : WETH_BASE;
            try {
                await this.publicClient.simulateContract({
                    address: UNISWAP_V3_ROUTER, abi: ROUTER_ABI, functionName: 'exactInputSingle',
                    args: [{ tokenIn, tokenOut, fee: v3Fee, recipient: this.account.address, amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n }],
                    ...(direction === 'buy' ? { value: amountIn } : {}),
                    account: this.account.address,
                });
                return { ok: true, dex: 'uniswap-v3', fee: v3Fee, label: `Uniswap V3 fee=${v3Fee / 100}bps (on-chain)` };
            } catch { /* fall through */ }
        }

        // ── Step 3: Brute-force Aerodrome CL tick spacings ──
        const aeroTicks = [200, 100, 50, 1];
        for (const ts of aeroTicks) {
            try {
                const tokenIn = direction === 'buy' ? WETH_BASE : tokenAddress;
                const tokenOut = direction === 'buy' ? tokenAddress : WETH_BASE;
                await this.publicClient.simulateContract({
                    address: AERODROME_CL_ROUTER, abi: AERODROME_CL_ABI, functionName: 'exactInputSingle',
                    args: [{ tokenIn, tokenOut, tickSpacing: ts, recipient: this.account.address, deadline, amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n }],
                    ...(direction === 'buy' ? { value: amountIn } : {}),
                    account: this.account.address,
                });
                return { ok: true, dex: 'aerodrome-cl', tickSpacing: ts, label: `Aerodrome CL tickSpacing=${ts} (brute-force)` };
            } catch { /* try next */ }
        }

        // ── Step 4: Brute-force remaining Uniswap V3 fee tiers ──
        for (const fee of [500, 3000, 10000] as const) {
            if (fee === v3Fee) continue; // already tried
            try {
                const tokenIn = direction === 'buy' ? WETH_BASE : tokenAddress;
                const tokenOut = direction === 'buy' ? tokenAddress : WETH_BASE;
                await this.publicClient.simulateContract({
                    address: UNISWAP_V3_ROUTER, abi: ROUTER_ABI, functionName: 'exactInputSingle',
                    args: [{ tokenIn, tokenOut, fee, recipient: this.account.address, amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n }],
                    ...(direction === 'buy' ? { value: amountIn } : {}),
                    account: this.account.address,
                });
                return { ok: true, dex: 'uniswap-v3', fee, label: `Uniswap V3 fee=${fee / 100}bps (brute-force)` };
            } catch { /* try next */ }
        }

        // ── Step 5: Brute-force Aerodrome V2 (volatile then stable) ──
        for (const stable of [false, true]) {
            const route = [{ from: direction === 'buy' ? WETH_BASE : tokenAddress, to: direction === 'buy' ? tokenAddress : WETH_BASE, stable, factory: AERODROME_V2_FACTORY }];
            try {
                const amounts = await this.publicClient.readContract({
                    address: AERODROME_V2_ROUTER, abi: AERODROME_V2_ABI, functionName: 'getAmountsOut',
                    args: [amountIn, route]
                }) as bigint[];
                if (amounts && amounts.length >= 2 && amounts[1] > 0n) {
                    return { ok: true, dex: 'aerodrome-v2', stable, label: `Aerodrome V2 ${stable ? 'stable' : 'volatile'} (brute-force)` };
                }
            } catch { /* try next */ }
        }

        // ── Step 6: Brute-force Uniswap V2-style routers (BaseSwap, Uniswap V2, etc.) ──
        const v2Path: readonly [Address, Address] = direction === 'buy' ? [WETH_BASE, tokenAddress] : [tokenAddress, WETH_BASE];
        for (const router of V2_ROUTERS) {
            try {
                const amounts = await this.publicClient.readContract({
                    address: router.address, abi: UNISWAP_V2_ABI, functionName: 'getAmountsOut',
                    args: [amountIn, v2Path]
                }) as bigint[];
                if (amounts && amounts.length >= 2 && amounts[1] > 0n) {
                    return { ok: true, dex: 'uniswap-v2', v2Router: router.address, label: `${router.label} (brute-force)` };
                }
            } catch { /* try next */ }
        }

        // For sells: if ALL simulations fail (e.g. honeypot/tax), try Aerodrome V2 volatile anyway
        if (direction === 'sell') {
            const fallbackFee = v3Fee ?? 10000;
            console.warn(`   ⚠️  All sell simulations failed — sending anyway at fee=${fallbackFee / 100}bps (possible honeypot tax)`);
            return { ok: true, dex: 'uniswap-v3', fee: fallbackFee, label: `Uniswap V3 fee=${fallbackFee / 100}bps (emergency fallback)` };
        }

        return { ok: false, dex: 'uniswap-v3', error: 'No valid swap route — token not tradeable on any known DEX', label: 'none' };
    }

    // ============ BEST FEE TIER DETECTION ============
    private async getBestFeeTier(tokenAddress: Address): Promise<500 | 3000 | 10000> {
        try {
            const pairs = await getDexUniV3Pairs(tokenAddress);
            const VALID_FEES = new Set([500, 3000, 10000]);
            let bestLiq = 0;
            let bestFee: 500 | 3000 | 10000 | undefined;

            for (const pair of pairs) {
                const liq    = pair.liquidity?.usd || 0;
                const rawFee = pair.feeTier ?? NaN;
                const validFee = VALID_FEES.has(rawFee) ? rawFee as 500 | 3000 | 10000 : undefined;
                if (validFee !== undefined && liq > bestLiq) {
                    bestLiq = liq;
                    bestFee = validFee;
                }
            }

            if (bestFee !== undefined) return bestFee;

            // GeckoTerminal has no clear fee tier data → query factory on-chain
            // Most new Base tokens launch at 1% (10000); check 10000, 3000, 500 in order
            console.log(`   🔍 Fee tier unknown from GeckoTerminal — querying Uniswap factory on-chain...`);
            const onChainFee = await getOnChainFeeTier(this.publicClient, tokenAddress);
            if (onChainFee !== null) {
                console.log(`   ⛓️  On-chain fee tier detected: ${onChainFee / 100}%`);
                return onChainFee;
            }

            // Nothing found — default to 10000 (1%) since most new Base meme tokens use it
            console.log(`   ⚠️  No pool found on-chain — defaulting to 1% fee tier (10000)`);
            return 10000;
        } catch {
            return 10000;
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

        // Always scan WETH + open positions + knownTokens regardless of session state
        const WETH_ADDR = '0x4200000000000000000000000000000000000006' as Address;
        const scanSet   = new Set<Address>([
            WETH_ADDR,
            ...Array.from(this.knownTokens),
            ...Array.from(this.openPositions.keys()),
        ]);

        await Promise.all(Array.from(scanSet).map(async (addr) => {
            try {
                const [balance, decimals, symbol] = await Promise.all([
                    this.publicClient.readContract({ address: addr, abi: ERC20_ABI, functionName: 'balanceOf', args: [this.account.address] }) as Promise<bigint>,
                    this.publicClient.readContract({ address: addr, abi: ERC20_ABI, functionName: 'decimals' }) as Promise<number>,
                    this.publicClient.readContract({ address: addr, abi: ERC20_ABI, functionName: 'symbol' }) as Promise<string>
                ]);
                if (balance === 0n && addr !== WETH_ADDR) return;
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
                        const baseTokenId  = (pool.relationships?.base_token?.data?.id  || '').toLowerCase();
                        const quoteTokenId = (pool.relationships?.quote_token?.data?.id || '').toLowerCase();
                        const addrId = `base_${addr.toLowerCase()}`;
                        const isBase  = baseTokenId  === addrId;
                        const isQuote = quoteTokenId === addrId;
                        if (isBase) {
                            priceUsd  = parseFloat(pool.attributes?.base_token_price_usd  || '0') || null;
                            const raw = parseFloat(pool.attributes?.price_change_percentage?.h24 || '0');
                            change24h = raw !== 0 ? raw : null;
                        } else if (isQuote) {
                            priceUsd  = parseFloat(pool.attributes?.quote_token_price_usd || '0') || null;
                            const raw = parseFloat(pool.attributes?.price_change_percentage?.h24 || '0');
                            change24h = raw !== 0 ? -raw : null;
                        } else {
                            priceUsd  = parseFloat(pool.attributes?.base_token_price_usd  || '0') || null;
                            const raw = parseFloat(pool.attributes?.price_change_percentage?.h24 || '0');
                            change24h = raw !== 0 ? raw : null;
                        }
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
        if (!this.isReady) return { success: false, error: 'Executor not ready' };
        try {
            const value = parseEther(amountEth.toString());
            const { wei: balance } = await this.getBalance();
            if (balance < value + parseEther('0.0001')) {
                return { success: false, error: `Insufficient balance: ${formatEther(balance)} ETH` };
            }
            const gasPrice = await this.getGasPrice();
            const txHash = await (this.walletClient as any).sendTransaction({ to, value, ...gasPrice });
            await this.waitForReceiptRobust(txHash);
            console.log(`✅ Sent ${amountEth} ETH → ${to}`);
            return { success: true, txHash };
        } catch (e: any) {
            return { success: false, error: e?.shortMessage || e?.message || 'Unknown error' };
        }
    }

    // ============ SEND TOKEN ============
    async sendToken(tokenAddress: Address, to: Address, amountHuman: number, decimals: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
        if (!this.isReady) return { success: false, error: 'Executor not ready' };
        try {
            const amount = parseUnits(amountHuman.toString(), decimals);
            const balance = await this.publicClient.readContract({
                address: tokenAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [this.account.address]
            }) as bigint;
            if (balance < amount) return { success: false, error: 'Insufficient token balance' };
            const gasPrice = await this.getGasPrice();
            const txHash = await (this.walletClient as any).writeContract({
                address: tokenAddress, abi: ERC20_ABI, functionName: 'transfer', args: [to, amount], ...gasPrice
            });
            await this.waitForReceiptRobust(txHash);
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
        gasMode?:        string;
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
        if (updates.gasMode        != null) c.GAS_MODE               = updates.gasMode;
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
