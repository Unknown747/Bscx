import React, { useEffect, useState, useCallback, useRef } from 'react';
import { authFetch } from '../lib/authFetch';
import MiniChart from './MiniChart';

interface Position {
    tokenAddress: string;
    tokenSymbol: string;
    amountIn: string;
    amountOut: string;
    entryPrice: number;
    openedAt: number;
    txHash: string;
    takeProfit1Hit: boolean;
    takeProfit2Hit: boolean;
}

interface PnLEntry {
    tokenAddress: string;
    tokenSymbol: string;
    entryEth: number;
    currentValueEth: number | null;
    profitPct: number | null;
    multiplier: number | null;
    holdMs: number;
}

interface PositionsData {
    positions: Position[];
    wallet: string | null;
    timestamp: number;
}

interface TpSlConfig {
    tp1Multiplier: number;
    tp2Multiplier: number;
    stopLoss: number;
}

interface SellState {
    tokenAddress: string;
    step: 'confirm' | 'selling' | 'done' | 'error';
    percent: number;
    txHash?: string;
    error?: string;
}

interface PositionCardProps {
    apiUrl: string;
}

function holdTime(ms: number): string {
    const secs = Math.floor(ms / 1000);
    if (secs < 60)   return `${secs}d`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m`;
    return `${Math.floor(secs / 3600)}j ${Math.floor((secs % 3600) / 60)}m`;
}

function shortAddr(addr: string): string {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function pnlColor(pct: number | null): string {
    if (pct === null) return 'text-gray-400';
    if (pct >= 20)  return 'text-green-400';
    if (pct >= 0)   return 'text-green-300';
    if (pct >= -10) return 'text-yellow-400';
    return 'text-red-400';
}

function pnlBg(pct: number | null): string {
    if (pct === null) return 'bg-gray-900 border-gray-800';
    if (pct >= 20)  return 'bg-green-900/40 border-green-700';
    if (pct >= 0)   return 'bg-green-900/20 border-green-800';
    if (pct >= -10) return 'bg-yellow-900/30 border-yellow-800';
    return 'bg-red-900/30 border-red-800';
}

function progressPct(current: number, start: number, target: number): number {
    if (current >= target) return 100;
    if (current <= start)  return 0;
    return Math.round(((current - start) / (target - start)) * 100);
}

const SELL_PRESETS = [25, 50, 75, 100];

const PositionCard: React.FC<PositionCardProps> = ({ apiUrl }) => {
    const [data, setData]               = useState<PositionsData | null>(null);
    const [pnlMap, setPnlMap]           = useState<Map<string, PnLEntry>>(new Map());
    const [tpsl, setTpsl]               = useState<TpSlConfig>({ tp1Multiplier: 1.5, tp2Multiplier: 2.5, stopLoss: 30 });
    const [error, setError]             = useState('');
    const [pnlLoading, setPnlLoading]   = useState(false);
    const [flashSet, setFlashSet]       = useState<Set<string>>(new Set());
    const [sellState, setSellState]     = useState<SellState | null>(null);
    const [expandedCharts, setExpandedCharts] = useState<Set<string>>(new Set());
    const [ethPriceUsd, setEthPriceUsd] = useState<number>(3000);
    const prevPnlRef                    = useRef<Map<string, number | null>>(new Map());
    const [tick, setTick]               = useState(0);

    const fetchPositions = useCallback(async () => {
        try {
            const [posRes, cfgRes] = await Promise.all([
                authFetch(`${apiUrl}/api/positions`),
                authFetch(`${apiUrl}/api/config`)
            ]);
            const posJson = await posRes.json();
            const cfgJson = await cfgRes.json();
            setData(posJson);
            setTpsl({
                tp1Multiplier: cfgJson.tp1Multiplier ?? 1.5,
                tp2Multiplier: cfgJson.tp2Multiplier ?? 2.5,
                stopLoss:      cfgJson.stopLoss      ?? 30
            });
            setError('');
        } catch {
            setError('Gagal memuat posisi');
        }
    }, [apiUrl]);

    const fetchEthPrice = useCallback(async () => {
        try {
            const res  = await authFetch(`${apiUrl}/api/eth-price`);
            const json = await res.json();
            if (json.usd && json.usd > 0) setEthPriceUsd(json.usd);
        } catch { /* use fallback */ }
    }, [apiUrl]);

    const toggleChart = useCallback((addr: string) => {
        setExpandedCharts(prev => {
            const next = new Set(prev);
            next.has(addr) ? next.delete(addr) : next.add(addr);
            return next;
        });
    }, []);

    const fetchPnL = useCallback(async () => {
        setPnlLoading(true);
        try {
            const res  = await authFetch(`${apiUrl}/api/pnl`);
            const json = await res.json();
            const newMap = new Map<string, PnLEntry>();
            const flashing = new Set<string>();
            for (const entry of (json.pnl || [])) {
                const key = entry.tokenAddress.toLowerCase();
                newMap.set(key, entry);
                const prev = prevPnlRef.current.get(key);
                if (prev !== undefined && prev !== entry.profitPct) flashing.add(key);
                prevPnlRef.current.set(key, entry.profitPct);
            }
            setPnlMap(newMap);
            if (flashing.size > 0) {
                setFlashSet(flashing);
                setTimeout(() => setFlashSet(new Set()), 700);
            }
        } catch { /* silent */ }
        setPnlLoading(false);
    }, [apiUrl]);

    const executeSell = useCallback(async (tokenAddress: string, percent: number) => {
        setSellState({ tokenAddress, step: 'selling', percent });
        try {
            const res  = await authFetch(`${apiUrl}/api/sell`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tokenAddress, percent })
            });
            const json = await res.json();
            if (json.success) {
                setSellState({ tokenAddress, step: 'done', percent, txHash: json.txHash });
                setTimeout(() => { setSellState(null); fetchPositions(); fetchPnL(); }, 3500);
            } else {
                setSellState({ tokenAddress, step: 'error', percent, error: json.error || 'Sell gagal' });
            }
        } catch (e: any) {
            setSellState({ tokenAddress, step: 'error', percent, error: e.message || 'Network error' });
        }
    }, [apiUrl, fetchPositions, fetchPnL]);

    useEffect(() => {
        fetchPositions();
        const pi = setInterval(fetchPositions, 5000);
        return () => clearInterval(pi);
    }, [fetchPositions]);

    useEffect(() => {
        fetchPnL();
        const pi = setInterval(fetchPnL, 5000);
        return () => clearInterval(pi);
    }, [fetchPnL]);

    useEffect(() => {
        fetchEthPrice();
        const pi = setInterval(fetchEthPrice, 60_000);
        return () => clearInterval(pi);
    }, [fetchEthPrice]);

    useEffect(() => {
        const t = setInterval(() => setTick(n => n + 1), 1000);
        return () => clearInterval(t);
    }, []);

    void tick;

    const positions = data?.positions ?? [];

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-300">
                    Posisi Terbuka
                    {positions.length > 0 && (
                        <span className="ml-2 bg-green-500/20 text-green-400 text-xs px-2 py-0.5 rounded-full">
                            {positions.length}
                        </span>
                    )}
                </h2>
                <div className="flex items-center gap-2">
                    {data?.wallet && (
                        <span className="text-xs text-gray-600">{shortAddr(data.wallet)}</span>
                    )}
                    {positions.length > 0 && (
                        <div className="flex items-center gap-1 text-xs text-gray-600">
                            <span className={`w-1.5 h-1.5 rounded-full ${pnlLoading ? 'bg-yellow-500 animate-pulse' : 'bg-green-500 animate-pulse'}`} />
                            <span>{pnlLoading ? 'Updating...' : 'Live'}</span>
                        </div>
                    )}
                </div>
            </div>

            {error && (
                <div className="bg-red-900/30 border border-red-800 rounded-xl p-3 text-xs text-red-400">{error}</div>
            )}

            {!error && positions.length === 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
                    <p className="text-2xl mb-2">📭</p>
                    <p className="text-sm text-gray-500">Belum ada posisi terbuka</p>
                    <p className="text-xs text-gray-700 mt-1">Bot sedang memantau peluang...</p>
                </div>
            )}

            {positions.map((pos) => {
                const key        = pos.tokenAddress.toLowerCase();
                const pnl        = pnlMap.get(key);
                const isFlashing = flashSet.has(key);
                const sell       = sellState?.tokenAddress.toLowerCase() === key ? sellState : null;

                const mult       = pnl?.multiplier ?? null;
                const profitPct  = pnl?.profitPct  ?? null;
                const currentEth = pnl?.currentValueEth ?? null;
                const holdMs     = pnl?.holdMs ?? (Date.now() - pos.openedAt);

                const tp1Prog = mult !== null ? progressPct(mult, 1, tpsl.tp1Multiplier) : 0;
                const tp2Prog = mult !== null && pos.takeProfit1Hit
                    ? progressPct(mult, tpsl.tp1Multiplier, tpsl.tp2Multiplier)
                    : 0;
                const chartOpen       = expandedCharts.has(key);
                const entryPriceUsd   = pos.entryPrice * ethPriceUsd;

                return (
                    <div
                        key={pos.tokenAddress}
                        className={`border rounded-xl p-4 space-y-3 transition-all duration-300
                            ${isFlashing ? 'ring-1 ring-green-500/50 scale-[1.01]' : ''}
                            ${pnlBg(profitPct)}`}
                    >
                        {/* Token row */}
                        <div className="flex items-start justify-between">
                            <div>
                                <span className="text-white font-bold">{pos.tokenSymbol}</span>
                                <span className="ml-2 text-xs text-gray-500">{shortAddr(pos.tokenAddress)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => toggleChart(key)}
                                    className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border transition-all
                                        ${chartOpen
                                            ? 'border-blue-600 text-blue-400 bg-blue-900/30'
                                            : 'border-gray-700 text-gray-500 hover:border-blue-700 hover:text-blue-400'
                                        }`}
                                    title={chartOpen ? 'Tutup chart' : 'Lihat chart harga'}
                                >
                                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                                        <polyline points="1,9 4,5 7,7 11,2" strokeLinejoin="round" strokeLinecap="round"/>
                                    </svg>
                                    Chart
                                </button>
                                <span className="text-xs text-gray-500">⏱ {holdTime(holdMs)}</span>
                            </div>
                        </div>

                        {/* PnL hero row */}
                        <div className="grid grid-cols-3 gap-2">
                            <div className="col-span-2 bg-black/20 rounded-xl p-3 flex flex-col justify-center">
                                {profitPct !== null ? (
                                    <>
                                        <p className={`text-2xl font-bold leading-none ${pnlColor(profitPct)}`}>
                                            {profitPct >= 0 ? '+' : ''}{profitPct.toFixed(1)}%
                                        </p>
                                        <p className="text-xs text-gray-500 mt-1">
                                            {mult !== null ? `${mult.toFixed(3)}x` : '—'}
                                            {currentEth !== null ? ` · ${currentEth.toFixed(5)} ETH` : ''}
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-lg font-bold text-gray-500">—</p>
                                        <p className="text-xs text-gray-600 mt-1">Memuat harga...</p>
                                    </>
                                )}
                            </div>
                            <div className="bg-black/20 rounded-xl p-3 flex flex-col justify-center">
                                <p className="text-xs text-gray-500 mb-1">Entry</p>
                                <p className="text-sm font-semibold text-white">{pos.entryPrice.toFixed(5)}</p>
                                <p className="text-xs text-gray-600">ETH</p>
                            </div>
                        </div>

                        {/* Progress bars */}
                        {mult !== null && (
                            <div className="space-y-2">
                                <div>
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className={pos.takeProfit1Hit ? 'text-green-400' : 'text-gray-500'}>
                                            {pos.takeProfit1Hit ? '✅' : '🎯'} TP1 {tpsl.tp1Multiplier}x
                                        </span>
                                        <span className="text-gray-600">{tp1Prog}%</span>
                                    </div>
                                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all duration-500 ${pos.takeProfit1Hit ? 'bg-green-500' : 'bg-green-600'}`}
                                            style={{ width: `${tp1Prog}%` }}
                                        />
                                    </div>
                                </div>

                                {pos.takeProfit1Hit && (
                                    <div>
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className={pos.takeProfit2Hit ? 'text-green-400' : 'text-yellow-500'}>
                                                {pos.takeProfit2Hit ? '✅' : '⏳'} TP2 {tpsl.tp2Multiplier}x
                                            </span>
                                            <span className="text-gray-600">{tp2Prog}%</span>
                                        </div>
                                        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full transition-all duration-500 ${pos.takeProfit2Hit ? 'bg-green-500' : 'bg-yellow-500'}`}
                                                style={{ width: `${tp2Prog}%` }}
                                            />
                                        </div>
                                    </div>
                                )}

                                {profitPct !== null && !pos.takeProfit1Hit && (
                                    <div>
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-red-600">🛑 Stop Loss -{tpsl.stopLoss}%</span>
                                            <span className="text-gray-600">
                                                {Math.max(0, tpsl.stopLoss + profitPct).toFixed(1)}% sisa
                                            </span>
                                        </div>
                                        <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-red-700/60 rounded-full transition-all duration-500"
                                                style={{ width: `${Math.min(100, Math.max(0, ((tpsl.stopLoss + profitPct) / tpsl.stopLoss) * 100))}%` }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── PRICE CHART ── */}
                        {chartOpen && (
                            <div className="transition-all duration-300">
                                <MiniChart
                                    apiUrl={apiUrl}
                                    tokenAddress={pos.tokenAddress}
                                    tokenSymbol={pos.tokenSymbol}
                                    entryPrice={entryPriceUsd}
                                    width={280}
                                    height={110}
                                />
                            </div>
                        )}

                        {/* ── SELL PANEL ── */}
                        {!sell && (
                            <button
                                onClick={() => setSellState({ tokenAddress: pos.tokenAddress, step: 'confirm', percent: 100 })}
                                className="w-full py-2 rounded-lg border border-red-800 text-red-400 text-xs font-semibold
                                           hover:bg-red-900/40 active:scale-95 transition-all"
                            >
                                💸 Jual Manual
                            </button>
                        )}

                        {sell?.step === 'confirm' && (
                            <div className="space-y-2">
                                <p className="text-xs text-gray-400 font-medium">Pilih jumlah yang dijual:</p>
                                <div className="grid grid-cols-4 gap-1.5">
                                    {SELL_PRESETS.map(pct => (
                                        <button
                                            key={pct}
                                            onClick={() => setSellState(s => s ? { ...s, percent: pct } : s)}
                                            className={`py-1.5 rounded-lg text-xs font-bold border transition-all
                                                ${sell.percent === pct
                                                    ? 'bg-red-700 border-red-500 text-white'
                                                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-red-700 hover:text-red-400'}`}
                                        >
                                            {pct}%
                                        </button>
                                    ))}
                                </div>
                                <div className="flex gap-2 pt-1">
                                    <button
                                        onClick={() => setSellState(null)}
                                        className="flex-1 py-2 rounded-lg border border-gray-700 text-gray-500 text-xs
                                                   hover:bg-gray-800 transition-all"
                                    >
                                        Batal
                                    </button>
                                    <button
                                        onClick={() => executeSell(pos.tokenAddress, sell.percent)}
                                        className="flex-1 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs
                                                   font-bold transition-all active:scale-95"
                                    >
                                        Konfirmasi Jual {sell.percent}%
                                    </button>
                                </div>
                            </div>
                        )}

                        {sell?.step === 'selling' && (
                            <div className="flex items-center gap-2 py-2 justify-center text-xs text-yellow-400">
                                <span className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                                Mengirim transaksi jual {sell.percent}%...
                            </div>
                        )}

                        {sell?.step === 'done' && (
                            <div className="bg-green-900/30 border border-green-700 rounded-lg px-3 py-2 text-xs text-green-400">
                                ✅ Berhasil dijual {sell.percent}%
                                {sell.txHash && (
                                    <a
                                        href={`https://basescan.org/tx/${sell.txHash}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="ml-2 text-blue-400 hover:text-blue-300"
                                    >
                                        🔗 TX
                                    </a>
                                )}
                            </div>
                        )}

                        {sell?.step === 'error' && (
                            <div className="space-y-1.5">
                                <div className="bg-red-900/30 border border-red-800 rounded-lg px-3 py-2 text-xs text-red-400">
                                    ❌ {sell.error}
                                </div>
                                <button
                                    onClick={() => setSellState(null)}
                                    className="w-full py-1.5 rounded-lg border border-gray-700 text-gray-500 text-xs hover:bg-gray-800 transition-all"
                                >
                                    Tutup
                                </button>
                            </div>
                        )}

                        {/* TX link */}
                        <div className="flex items-center justify-between text-xs text-gray-700">
                            <a
                                href={`https://basescan.org/tx/${pos.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-400 transition-colors"
                            >
                                🔗 {shortAddr(pos.txHash)}
                            </a>
                            <span className="text-gray-700">Auto-monitored</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default PositionCard;
