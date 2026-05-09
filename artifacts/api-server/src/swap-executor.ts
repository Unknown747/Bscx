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
import dotenv from 'dotenv';

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
    { name: 'balanceOf',  type: 'function', inputs: [{ name: 'account', type: 'address' }],                                                                           outputs: [{ name: '', type: 'uint256' }] },
    { name: 'decimals',   type: 'function', inputs: [],                                                                                                                outputs: [{ name: '', type: 'uint8'   }] },
    { name: 'symbol',     type: 'function', inputs: [],                                                                                                                outputs: [{ name: '', type: 'string'  }] },
    { name: 'name',       type: 'function', inputs: [],                                                                                                                outputs: [{ name: '', type: 'string'  }] },
    { name: 'approve',    type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],                                      outputs: [{ name: '', type: 'bool'    }] },
    { name: 'transfer',   type: 'function', inputs: [{ name: 'to',      type: 'address' }, { name: 'amount', type: 'uint256' }],                                      outputs: [{ name: '', type: 'bool'    }] }
] as const;

// ============ TYPES ============
export interface SwapParams {
    tokenAddress: Address;
    amountInEth: number;
    slippagePercent?: number;
    feeTier?: 500 | 3000 | 10000;
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
        DEFAULT_SLIPPAGE:       parseFloat(process.env.MAX_SLIPPAGE_PERCENT   || '15'),
        TAKE_PROFIT_1_X:        parseFloat(process.env.TAKE_PROFIT_1_MULTIPLIER || '1.5'),
        TAKE_PROFIT_1_PCT:      parseFloat(process.env.TAKE_PROFIT_1_PERCENTAGE || '50'),
        TAKE_PROFIT_2_X:        parseFloat(process.env.TAKE_PROFIT_2_MULTIPLIER  || '2.5'),
        TAKE_PROFIT_2_PCT:      parseFloat(process.env.TAKE_PROFIT_2_PERCENTAGE  || '50'),
        STOP_LOSS_PCT:          parseFloat(process.env.STOP_LOSS_PERCENTAGE       || '30'),
        MAX_PRIORITY_FEE_GWEI:  parseFloat(process.env.MAX_PRIORITY_FEE_GWEI      || '0.5'),
        MAX_FEE_GWEI:           parseFloat(process.env.MAX_FEE_PER_GAS_GWEI       || '1.5'),
        GAS_MODE:               process.env.GAS_MODE                               || 'economy',
        MONITOR_INTERVAL_MS:    5000
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
    private async getGasPrice(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
        const gwei = BigInt(1_000_000_000);

        if (this.CONFIG.GAS_MODE === 'economy') {
            return {
                maxFeePerGas:         BigInt(Math.floor(this.CONFIG.MAX_FEE_GWEI * 1e9)),
                maxPriorityFeePerGas: BigInt(Math.floor(this.CONFIG.MAX_PRIORITY_FEE_GWEI * 1e9))
            };
        }

        // 'auto' mode — fetch current network gas and add small tip
        const block = await this.publicClient.getBlock({ blockTag: 'latest' });
        const baseFee = block.baseFeePerGas ?? gwei;
        const priorityFee = gwei / 2n; // 0.5 gwei tip
        return {
            maxFeePerGas:         baseFee * 2n + priorityFee,
            maxPriorityFeePerGas: priorityFee
        };
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
            // Check balance
            const { wei: balance } = await this.getBalance();
            const gasReserve = parseEther('0.002'); // keep 0.002 ETH for gas
            if (balance < amountIn + gasReserve) {
                return { success: false, amountIn, amountOut: 0n, error: `Insufficient balance: ${formatEther(balance)} ETH` };
            }

            // Accept any amount out for new tokens (no price history for slippage calc)
            const amountOutMinimum = 0n;

            const gasPrice = await this.getGasPrice();

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const txHash = await (this.walletClient as any).writeContract({
                address: UNISWAP_V3_ROUTER,
                abi: ROUTER_ABI,
                functionName: 'exactInputSingle',
                args: [{
                    tokenIn:           WETH_BASE,
                    tokenOut:          tokenAddress,
                    fee:               feeTier,
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
                takeProfit2Hit: false
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

            // Approve router to spend tokens
            const gasPrice = await this.getGasPrice();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const approveTx = await (this.walletClient as any).writeContract({
                address: tokenAddress,
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [UNISWAP_V3_ROUTER, MAX_UINT256],
                ...gasPrice
            });
            await this.publicClient.waitForTransactionReceipt({ hash: approveTx, timeout: 20_000 });

            // Execute sell
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const txHash = await (this.walletClient as any).writeContract({
                address: UNISWAP_V3_ROUTER,
                abi: ROUTER_ABI,
                functionName: 'exactInputSingle',
                args: [{
                    tokenIn:           tokenAddress,
                    tokenOut:          WETH_BASE,
                    fee:               3000,
                    recipient:         this.account.address,
                    amountIn,
                    amountOutMinimum:  0n,
                    sqrtPriceLimitX96: 0n
                }],
                ...gasPrice
            });

            console.log(`   📤 TX sent: ${txHash}`);
            const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

            if (receipt.status !== 'success') {
                return { success: false, amountIn, amountOut: 0n, txHash, error: 'Sell transaction reverted' };
            }

            const tokenSymbol = this.openPositions.get(tokenAddress)?.tokenSymbol || '???';
            console.log(`   ✅ SELL SUCCESS: ${formatEther(amountIn)} ${tokenSymbol} (${percentToSell}%)`);

            this.emit('sell-success', { tokenAddress, tokenSymbol, amountIn, percentSold: percentToSell, txHash });

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

        const holdMins = ((Date.now() - position.openedAt) / 60000).toFixed(1);

        console.log(`📊 ${position.tokenSymbol}: ${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(1)}% | ${multiplier.toFixed(2)}x | ${holdMins}m`);

        // ─── STOP LOSS ───
        if (profitPct <= -this.CONFIG.STOP_LOSS_PCT) {
            console.log(`🛑 STOP LOSS triggered at ${profitPct.toFixed(1)}% — selling 100%`);
            this.emit('stop-loss', { tokenAddress, tokenSymbol: position.tokenSymbol, profitPct });
            await this.sell(tokenAddress, 100);
            return;
        }

        // ─── TAKE PROFIT 1 ───
        if (!position.takeProfit1Hit && multiplier >= this.CONFIG.TAKE_PROFIT_1_X) {
            console.log(`🎯 TAKE PROFIT 1 at ${multiplier.toFixed(2)}x — selling ${this.CONFIG.TAKE_PROFIT_1_PCT}%`);
            this.emit('take-profit', { tokenAddress, tokenSymbol: position.tokenSymbol, level: 1, multiplier });
            await this.sell(tokenAddress, this.CONFIG.TAKE_PROFIT_1_PCT);
            position.takeProfit1Hit = true;
            return;
        }

        // ─── TAKE PROFIT 2 ───
        if (position.takeProfit1Hit && !position.takeProfit2Hit && multiplier >= this.CONFIG.TAKE_PROFIT_2_X) {
            console.log(`🎯 TAKE PROFIT 2 at ${multiplier.toFixed(2)}x — selling remaining ${this.CONFIG.TAKE_PROFIT_2_PCT}%`);
            this.emit('take-profit', { tokenAddress, tokenSymbol: position.tokenSymbol, level: 2, multiplier });
            await this.sell(tokenAddress, 100);
            position.takeProfit2Hit = true;
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
    private async estimateTokenValueEth(tokenAddress: Address, tokenAmount: bigint): Promise<number | null> {
        try {
            const { default: axios } = await import('axios');
            const res = await axios.get(
                `https://api.dexscreener.com/latest/dex/search?q=${tokenAddress}`,
                { timeout: 4000 }
            );

            const pair = res.data?.pairs?.[0];
            if (!pair) return null;

            const priceUsd    = parseFloat(pair.priceUsd || '0');
            const ethPriceUsd = await this.getEthPriceUsd();
            if (!priceUsd || !ethPriceUsd) return null;

            const decimals = await this.publicClient.readContract({
                address: tokenAddress,
                abi: ERC20_ABI,
                functionName: 'decimals'
            }) as number;

            const tokenAmountNum = Number(tokenAmount) / Math.pow(10, decimals);
            return (tokenAmountNum * priceUsd) / ethPriceUsd;
        } catch {
            return null;
        }
    }

    private async getEthPriceUsd(): Promise<number> {
        try {
            const { default: axios } = await import('axios');
            const res = await axios.get(
                'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
                { timeout: 3000 }
            );
            return res.data?.ethereum?.usd || 3000;
        } catch {
            return 3000;
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
        const { default: axios } = await import('axios');
        const ethPriceUsd = await this.getEthPriceUsd();
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
                    const res = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${addr}`, { timeout: 4000 });
                    const pair = res.data?.pairs?.[0];
                    if (pair) { priceUsd = parseFloat(pair.priceUsd || '0') || null; change24h = pair.priceChange?.h24 ?? null; }
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
            if (balance < value + parseEther('0.001')) {
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
        console.log('⚙️  SwapExecutor config updated');
    }

    // ============ PUBLIC GETTERS ============
    getOpenPositions(): OpenPosition[] {
        return Array.from(this.openPositions.values());
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
