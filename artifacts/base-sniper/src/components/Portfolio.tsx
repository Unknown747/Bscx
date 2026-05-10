import React, { useEffect, useState, useCallback, useRef } from 'react';
import { authFetch } from '../lib/authFetch';

interface TokenEntry {
    address: string;
    symbol: string;
    balance: string;
    decimals: number;
    priceUsd: number | null;
    valueEth: number | null;
    valueUsd: number | null;
    change24h: number | null;
}

interface PortfolioData {
    ethBalance: string;
    ethValueUsd: number;
    tokens: TokenEntry[];
    totalValueEth: number;
    totalValueUsd: number;
    timestamp: number;
}

interface SendState {
    type: 'eth' | 'token';
    token?: TokenEntry;
    to: string;
    amount: string;
    step: 'form' | 'sending' | 'done' | 'error';
    txHash?: string;
    error?: string;
}

interface SwapState {
    token: TokenEntry;
    percent: number;
    step: 'confirm' | 'swapping' | 'done' | 'error';
    txHash?: string;
    error?: string;
}

interface PortfolioProps {
    apiUrl: string;
}

function shortAddr(addr: string): string {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function fmtUsd(v: number | null): string {
    if (v === null) return '—';
    if (v >= 1000) return `$${v.toFixed(0)}`;
    if (v >= 1) return `$${v.toFixed(2)}`;
    return `$${v.toFixed(4)}`;
}

function fmtEth(v: number | null | string): string {
    if (v === null) return '—';
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (n === 0) return '0 ETH';
    if (n >= 1) return `${n.toFixed(4)} ETH`;
    return `${n.toFixed(6)} ETH`;
}

function change24hColor(v: number | null): string {
    if (v === null) return 'text-gray-500';
    if (v > 0) return 'text-green-400';
    if (v < 0) return 'text-red-400';
    return 'text-gray-400';
}

const SWAP_PRESETS = [25, 50, 75, 100];

const Portfolio: React.FC<PortfolioProps> = ({ apiUrl }) => {
    const [data, setData]         = useState<PortfolioData | null>(null);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState('');
    const [lastUpdate, setLastUpdate] = useState('');
    const [sendState, setSendState]   = useState<SendState | null>(null);
    const [swapState, setSwapState]   = useState<SwapState | null>(null);
    const countdownRef            = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [nextRefresh, setNextRefresh] = useState(8);
    const POLL_INTERVAL = 8000;

    const fetchPortfolio = useCallback(async () => {
        try {
            const res  = await authFetch(`${apiUrl}/api/portfolio`);
            const json = await res.json();
            setData(json);
            setLastUpdate(new Date().toLocaleTimeString('id-ID'));
            setError('');
            setNextRefresh(POLL_INTERVAL / 1000);
        } catch {
            setError('Gagal memuat portfolio');
        }
        setLoading(false);
    }, [apiUrl]);

    useEffect(() => {
        fetchPortfolio();
        const interval = setInterval(fetchPortfolio, POLL_INTERVAL);
        return () => clearInterval(interval);
    }, [fetchPortfolio]);

    // Countdown timer
    useEffect(() => {
        countdownRef.current = setInterval(() => setNextRefresh(n => Math.max(0, n - 1)), 1000);
        return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
    }, []);

    // ── Send ETH or Token ──
    const submitSend = useCallback(async () => {
        if (!sendState) return;
        const amount = parseFloat(sendState.amount);
        if (!sendState.to.match(/^0x[0-9a-fA-F]{40}$/) || isNaN(amount) || amount <= 0) {
            setSendState(s => s ? { ...s, step: 'error', error: 'Alamat atau jumlah tidak valid' } : s);
            return;
        }
        setSendState(s => s ? { ...s, step: 'sending' } : s);
        try {
            const body: any = { type: sendState.type, to: sendState.to, amount };
            if (sendState.type === 'token' && sendState.token) {
                body.tokenAddress = sendState.token.address;
                body.decimals     = sendState.token.decimals;
            }
            const res  = await authFetch(`${apiUrl}/api/send`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
            });
            const json = await res.json();
            if (json.success) {
                setSendState(s => s ? { ...s, step: 'done', txHash: json.txHash } : s);
                setTimeout(() => { setSendState(null); fetchPortfolio(); }, 4000);
            } else {
                setSendState(s => s ? { ...s, step: 'error', error: json.error || 'Send gagal' } : s);
            }
        } catch (e: any) {
            setSendState(s => s ? { ...s, step: 'error', error: e.message || 'Network error' } : s);
        }
    }, [sendState, apiUrl, fetchPortfolio]);

    // ── Swap token → ETH ──
    const submitSwap = useCallback(async () => {
        if (!swapState) return;
        setSwapState(s => s ? { ...s, step: 'swapping' } : s);
        try {
            const res  = await authFetch(`${apiUrl}/api/sell`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tokenAddress: swapState.token.address, percent: swapState.percent })
            });
            const json = await res.json();
            if (json.success) {
                setSwapState(s => s ? { ...s, step: 'done', txHash: json.txHash } : s);
                setTimeout(() => { setSwapState(null); fetchPortfolio(); }, 4000);
            } else {
                setSwapState(s => s ? { ...s, step: 'error', error: json.error || 'Swap gagal' } : s);
            }
        } catch (e: any) {
            setSwapState(s => s ? { ...s, step: 'error', error: e.message || 'Network error' } : s);
        }
    }, [swapState, apiUrl, fetchPortfolio]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
                <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-gray-500">Memuat portfolio...</p>
            </div>
        );
    }

    const ethBal   = data ? parseFloat(data.ethBalance) : 0;
    const totalUsd = data?.totalValueUsd ?? 0;

    return (
        <div className="space-y-4 pb-6">

            {/* ── Refresh bar ── */}
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-300">Portfolio</h2>
                <div className="flex items-center gap-2">
                    <button onClick={fetchPortfolio}
                        className="text-xs text-green-500 hover:text-green-400 transition-colors px-2 py-0.5 rounded border border-green-900 hover:border-green-700">
                        ↻ Refresh
                    </button>
                    <span className="text-xs text-gray-600">auto {nextRefresh}d</span>
                </div>
            </div>

            {error && (
                <div className="bg-red-900/30 border border-red-800 rounded-xl p-3 text-xs text-red-400">{error}</div>
            )}

            {/* ── Total Value Card ── */}
            {data && (
                <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-2xl p-5">
                    <p className="text-xs text-gray-500 mb-1">Total Portfolio</p>
                    <p className="text-3xl font-bold text-white">{fmtUsd(totalUsd)}</p>
                    <p className="text-sm text-gray-400 mt-0.5">{fmtEth(data.totalValueEth)}</p>
                    {lastUpdate && <p className="text-xs text-gray-700 mt-2">Update: {lastUpdate}</p>}
                </div>
            )}

            {/* ── ETH Balance Card ── */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-blue-900/40 border border-blue-800 flex items-center justify-center text-lg">
                            Ξ
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-white">Ethereum</p>
                            <p className="text-xs text-gray-500">ETH · Base Network</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-sm font-bold text-white">{fmtEth(data?.ethBalance ?? '0')}</p>
                        <p className="text-xs text-gray-400">{fmtUsd(data?.ethValueUsd ?? 0)}</p>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                    <button
                        onClick={() => setSendState({ type: 'eth', to: '', amount: '', step: 'form' })}
                        className="py-2 rounded-lg border border-blue-800 text-blue-400 text-xs font-semibold
                                   hover:bg-blue-900/30 active:scale-95 transition-all"
                    >
                        ↑ Kirim ETH
                    </button>
                    <button
                        disabled
                        className="py-2 rounded-lg border border-gray-700 text-gray-600 text-xs font-semibold cursor-not-allowed"
                    >
                        ↓ Terima
                    </button>
                </div>
            </div>

            {/* ── Token List ── */}
            {data && data.tokens.length > 0 && (
                <div className="space-y-2">
                    <p className="text-xs text-gray-500 font-medium px-1">Token ({data.tokens.length})</p>
                    {data.tokens.map((token) => {
                        const isSwapping = swapState?.token.address === token.address;
                        return (
                            <div key={token.address} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                                {/* Token info row */}
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-full bg-purple-900/40 border border-purple-800 flex items-center justify-center text-xs font-bold text-purple-300">
                                            {token.symbol.slice(0, 2)}
                                        </div>
                                        <div>
                                            <p className="text-sm font-semibold text-white">{token.symbol}</p>
                                            <p className="text-xs text-gray-600">{shortAddr(token.address)}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-bold text-white">{fmtUsd(token.valueUsd)}</p>
                                        <div className="flex items-center justify-end gap-1.5">
                                            <p className="text-xs text-gray-400">{token.balance}</p>
                                            {token.change24h !== null && (
                                                <span className={`text-xs ${change24hColor(token.change24h)}`}>
                                                    {token.change24h >= 0 ? '+' : ''}{token.change24h.toFixed(1)}%
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Actions */}
                                {!isSwapping && (
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            onClick={() => setSwapState({ token, percent: 100, step: 'confirm' })}
                                            className="py-2 rounded-lg border border-orange-800 text-orange-400 text-xs font-semibold
                                                       hover:bg-orange-900/30 active:scale-95 transition-all"
                                        >
                                            ⇄ Swap → ETH
                                        </button>
                                        <button
                                            onClick={() => setSendState({ type: 'token', token, to: '', amount: '', step: 'form' })}
                                            className="py-2 rounded-lg border border-blue-800 text-blue-400 text-xs font-semibold
                                                       hover:bg-blue-900/30 active:scale-95 transition-all"
                                        >
                                            ↑ Kirim
                                        </button>
                                    </div>
                                )}

                                {/* Swap panel */}
                                {isSwapping && swapState?.step === 'confirm' && (
                                    <div className="space-y-2">
                                        <p className="text-xs text-gray-400 font-medium">Swap berapa % ke ETH?</p>
                                        <div className="grid grid-cols-4 gap-1.5">
                                            {SWAP_PRESETS.map(pct => (
                                                <button key={pct}
                                                    onClick={() => setSwapState(s => s ? { ...s, percent: pct } : s)}
                                                    className={`py-1.5 rounded-lg text-xs font-bold border transition-all
                                                        ${swapState.percent === pct
                                                            ? 'bg-orange-700 border-orange-500 text-white'
                                                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-orange-700 hover:text-orange-400'}`}>
                                                    {pct}%
                                                </button>
                                            ))}
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => setSwapState(null)}
                                                className="flex-1 py-2 rounded-lg border border-gray-700 text-gray-500 text-xs hover:bg-gray-800 transition-all">
                                                Batal
                                            </button>
                                            <button onClick={submitSwap}
                                                className="flex-1 py-2 rounded-lg bg-orange-700 hover:bg-orange-600 text-white text-xs font-bold transition-all active:scale-95">
                                                Konfirmasi {swapState.percent}%
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {isSwapping && swapState?.step === 'swapping' && (
                                    <div className="flex items-center justify-center gap-2 py-2 text-xs text-orange-400">
                                        <span className="w-3 h-3 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
                                        Swapping {swapState.percent}%...
                                    </div>
                                )}
                                {isSwapping && swapState?.step === 'done' && (
                                    <div className="bg-green-900/30 border border-green-700 rounded-lg px-3 py-2 text-xs text-green-400">
                                        ✅ Swap berhasil
                                        {swapState.txHash && (
                                            <a href={`https://basescan.org/tx/${swapState.txHash}`} target="_blank" rel="noopener noreferrer"
                                                className="ml-2 text-blue-400 hover:text-blue-300">🔗 TX</a>
                                        )}
                                    </div>
                                )}
                                {isSwapping && swapState?.step === 'error' && (
                                    <div className="space-y-1.5">
                                        <div className="bg-red-900/30 border border-red-800 rounded-lg px-3 py-2 text-xs text-red-400">
                                            ❌ {swapState.error}
                                        </div>
                                        <button onClick={() => setSwapState(null)}
                                            className="w-full py-1.5 rounded-lg border border-gray-700 text-gray-500 text-xs hover:bg-gray-800 transition-all">
                                            Tutup
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {data && data.tokens.length === 0 && ethBal === 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
                    <p className="text-2xl mb-2">👜</p>
                    <p className="text-sm text-gray-500">Portfolio kosong</p>
                    <p className="text-xs text-gray-700 mt-1">Token akan muncul setelah bot melakukan trade</p>
                </div>
            )}

            {data && data.tokens.length === 0 && ethBal > 0 && (
                <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 text-center">
                    <p className="text-xs text-gray-600">Belum ada token yang ditrack — token akan muncul otomatis setelah bot buy</p>
                </div>
            )}

            {/* ── Send Modal ── */}
            {sendState && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end justify-center z-50 p-4">
                    <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-white">
                                {sendState.type === 'eth' ? '↑ Kirim ETH' : `↑ Kirim ${sendState.token?.symbol}`}
                            </h3>
                            {sendState.step === 'form' && (
                                <button onClick={() => setSendState(null)} className="text-gray-500 hover:text-gray-300 text-lg leading-none">✕</button>
                            )}
                        </div>

                        {sendState.step === 'form' && (
                            <>
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-xs text-gray-500 block mb-1">Alamat Tujuan</label>
                                        <input
                                            type="text"
                                            placeholder="0x..."
                                            value={sendState.to}
                                            onChange={e => setSendState(s => s ? { ...s, to: e.target.value } : s)}
                                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white
                                                       placeholder-gray-600 focus:outline-none focus:border-blue-600 transition-colors"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-500 block mb-1">
                                            Jumlah {sendState.type === 'eth' ? 'ETH' : sendState.token?.symbol}
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="number"
                                                step="any"
                                                min="0"
                                                placeholder="0.0"
                                                value={sendState.amount}
                                                onChange={e => setSendState(s => s ? { ...s, amount: e.target.value } : s)}
                                                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white
                                                           placeholder-gray-600 focus:outline-none focus:border-blue-600 transition-colors"
                                            />
                                            <button
                                                onClick={() => {
                                                    const max = sendState.type === 'eth'
                                                        ? Math.max(0, parseFloat(data?.ethBalance ?? '0') - 0.001).toFixed(6)
                                                        : sendState.token?.balance ?? '0';
                                                    setSendState(s => s ? { ...s, amount: max } : s);
                                                }}
                                                className="px-3 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs text-gray-300 font-medium transition-colors"
                                            >
                                                MAX
                                            </button>
                                        </div>
                                        {sendState.type === 'eth' && (
                                            <p className="text-xs text-gray-600 mt-1">Saldo: {fmtEth(data?.ethBalance ?? '0')} (0.001 ETH reserved for gas)</p>
                                        )}
                                        {sendState.type === 'token' && (
                                            <p className="text-xs text-gray-600 mt-1">Saldo: {sendState.token?.balance} {sendState.token?.symbol}</p>
                                        )}
                                    </div>
                                </div>
                                <div className="flex gap-2 pt-1">
                                    <button onClick={() => setSendState(null)}
                                        className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-500 text-sm hover:bg-gray-800 transition-all">
                                        Batal
                                    </button>
                                    <button onClick={submitSend}
                                        className="flex-1 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-600 text-white text-sm font-bold transition-all active:scale-95">
                                        Konfirmasi Kirim
                                    </button>
                                </div>
                            </>
                        )}

                        {sendState.step === 'sending' && (
                            <div className="flex flex-col items-center gap-3 py-6">
                                <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                                <p className="text-sm text-blue-400">Mengirim transaksi...</p>
                                <p className="text-xs text-gray-600">Mohon tunggu konfirmasi blockchain</p>
                            </div>
                        )}

                        {sendState.step === 'done' && (
                            <div className="space-y-3">
                                <div className="bg-green-900/30 border border-green-700 rounded-xl p-4 text-center">
                                    <p className="text-2xl mb-1">✅</p>
                                    <p className="text-sm font-semibold text-green-400">Berhasil dikirim!</p>
                                    {sendState.txHash && (
                                        <a href={`https://basescan.org/tx/${sendState.txHash}`} target="_blank" rel="noopener noreferrer"
                                            className="text-xs text-blue-400 hover:text-blue-300 mt-1 block">
                                            🔗 Lihat di BaseScan
                                        </a>
                                    )}
                                </div>
                            </div>
                        )}

                        {sendState.step === 'error' && (
                            <div className="space-y-3">
                                <div className="bg-red-900/30 border border-red-800 rounded-xl p-4">
                                    <p className="text-sm text-red-400">❌ {sendState.error}</p>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => setSendState(s => s ? { ...s, step: 'form' } : s)}
                                        className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-400 text-sm hover:bg-gray-800 transition-all">
                                        Coba Lagi
                                    </button>
                                    <button onClick={() => setSendState(null)}
                                        className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-500 text-sm hover:bg-gray-800 transition-all">
                                        Tutup
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Portfolio;
