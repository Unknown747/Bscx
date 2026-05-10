import React, { useEffect, useState, useCallback, useRef } from 'react';
import { authFetch } from '../lib/authFetch';

interface Props { apiUrl: string; }

interface PnLEntry {
    tokenAddress: string;
    tokenSymbol: string;
    entryEth: number;
    currentValueEth: number | null;
    profitPct: number | null;
    multiplier: number | null;
    holdMs: number;
}

interface ClosedTrade {
    id: string;
    tokenAddress: string;
    tokenSymbol: string;
    entryEth: number;
    profitPct: number | null;
    percentSold: number;
    closedAt: number;
    holdMs: number;
    txHash: string;
    reason: 'take-profit' | 'stop-loss' | 'manual' | 'dca';
    tpLevel?: number;
}

interface TradeStats {
    total: number;
    wins: number;
    losses: number;
    winRate: number;
    totalProfitPct: number;
    bestTrade: ClosedTrade | null;
    worstTrade: ClosedTrade | null;
}

interface Position {
    tokenAddress: string;
    tokenSymbol: string;
    amountIn: string;
    entryPrice: number;
    openedAt: number;
    txHash: string;
}

function fmtEth(v: number): string {
    const sign = v >= 0 ? '+' : '';
    if (Math.abs(v) >= 0.001) return `${sign}${v.toFixed(4)}`;
    return `${sign}${v.toFixed(6)}`;
}

function timeAgo(ts: number): string {
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60)    return `${secs}s lalu`;
    if (secs < 3600)  return `${Math.floor(secs / 60)}m lalu`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}j lalu`;
    return new Date(ts).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

function holdTime(ms: number): string {
    if (ms < 60000)   return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${(ms / 3600000).toFixed(1)}j`;
}

const REASON_ICON: Record<string, string> = {
    'take-profit': '🎯',
    'stop-loss':   '🛑',
    'manual':      '👆',
    'dca':         '📉',
};

const LiveDashboard: React.FC<Props> = ({ apiUrl }) => {
    const [pnlList,    setPnlList]    = useState<PnLEntry[]>([]);
    const [trades,     setTrades]     = useState<ClosedTrade[]>([]);
    const [stats,      setStats]      = useState<TradeStats | null>(null);
    const [positions,  setPositions]  = useState<Position[]>([]);
    const [ethBal,     setEthBal]     = useState<number | null>(null);
    const [ethUsd,     setEthUsd]     = useState<number>(3000);
    const [tick,       setTick]       = useState(0);
    const [newIds,     setNewIds]     = useState<Set<string>>(new Set());
    const prevIdsRef = useRef<Set<string>>(new Set());

    const [cumPnlEth, setCumPnlEth] = useState<number>(0);
    const [openPnlEth, setOpenPnlEth] = useState<number>(0);

    const loadAll = useCallback(async () => {
        try {
            const [histRes, posRes, portRes, pnlRes, priceRes] = await Promise.all([
                authFetch(`${apiUrl}/api/history`),
                authFetch(`${apiUrl}/api/positions`),
                authFetch(`${apiUrl}/api/portfolio`),
                authFetch(`${apiUrl}/api/pnl`),
                authFetch(`${apiUrl}/api/eth-price`),
            ]);

            const histJson  = await histRes.json();
            const posJson   = await posRes.json();
            const portJson  = await portRes.json();
            const pnlJson   = await pnlRes.json();
            const priceJson = await priceRes.json();

            const closedTrades: ClosedTrade[] = histJson.trades ?? [];
            setTrades(closedTrades.slice().reverse());
            setStats(histJson.stats ?? null);
            setPositions(posJson.positions ?? []);
            if (portJson.ethBalance) setEthBal(parseFloat(portJson.ethBalance));
            if (priceJson.usd > 0)   setEthUsd(priceJson.usd);

            const pnlEntries: PnLEntry[] = pnlJson.pnl ?? [];
            setPnlList(pnlEntries);

            let cum = 0;
            for (const t of closedTrades) {
                if (t.profitPct !== null) {
                    cum += t.entryEth * (t.percentSold / 100) * (t.profitPct / 100);
                }
            }
            setCumPnlEth(cum);

            let open = 0;
            for (const p of pnlEntries) {
                if (p.currentValueEth !== null) {
                    open += p.currentValueEth - p.entryEth;
                }
            }
            setOpenPnlEth(open);

            const currentIds = new Set(closedTrades.map(t => t.id));
            const fresh = new Set<string>();
            for (const id of currentIds) {
                if (!prevIdsRef.current.has(id)) fresh.add(id);
            }
            if (fresh.size > 0) {
                setNewIds(fresh);
                setTimeout(() => setNewIds(new Set()), 3000);
            }
            prevIdsRef.current = currentIds;

        } catch { /* silent */ }
    }, [apiUrl]);

    useEffect(() => {
        loadAll();
        const iv = setInterval(loadAll, 4000);
        return () => clearInterval(iv);
    }, [loadAll]);

    useEffect(() => {
        const t = setInterval(() => setTick(n => n + 1), 1000);
        return () => clearInterval(t);
    }, []);

    void tick;

    const totalPnl   = cumPnlEth + openPnlEth;
    const isProfit   = totalPnl >= 0;
    const totalColor = isProfit ? 'text-green-400' : 'text-red-400';
    const cumColor   = cumPnlEth >= 0 ? 'text-green-400' : 'text-red-400';
    const openColor  = openPnlEth >= 0 ? 'text-green-300' : 'text-red-300';

    return (
        <div className="space-y-4 pb-8">

            {/* ── LIVE INDICATOR ── */}
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-300">Live Dashboard</h2>
                <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs text-green-500 font-medium">Real-time · 4s</span>
                </div>
            </div>

            {/* ── TOTAL P&L HERO ── */}
            <div className={`rounded-2xl p-5 border ${isProfit ? 'bg-green-900/20 border-green-800/50' : 'bg-red-900/20 border-red-800/50'}`}>
                <p className="text-xs text-gray-400 mb-1">Total P&L (Closed + Open)</p>
                <p className={`text-4xl font-bold tracking-tight ${totalColor}`}>
                    {fmtEth(totalPnl)} <span className="text-2xl">ETH</span>
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                    ≈ ${(totalPnl * ethUsd).toFixed(2)} USD
                </p>
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-800">
                    <div>
                        <p className="text-[10px] text-gray-600 uppercase tracking-wide">Closed</p>
                        <p className={`text-sm font-bold ${cumColor}`}>{fmtEth(cumPnlEth)} ETH</p>
                    </div>
                    <div className="w-px h-8 bg-gray-800" />
                    <div>
                        <p className="text-[10px] text-gray-600 uppercase tracking-wide">Open</p>
                        <p className={`text-sm font-bold ${openColor}`}>{fmtEth(openPnlEth)} ETH</p>
                    </div>
                    <div className="w-px h-8 bg-gray-800" />
                    <div>
                        <p className="text-[10px] text-gray-600 uppercase tracking-wide">Saldo</p>
                        <p className="text-sm font-bold text-white">
                            {ethBal !== null ? `${ethBal.toFixed(4)} ETH` : '—'}
                        </p>
                    </div>
                </div>
            </div>

            {/* ── STATS BAR ── */}
            {stats && stats.total > 0 && (
                <div className="grid grid-cols-4 gap-2">
                    {[
                        { label: 'Total', value: String(stats.total), sub: 'trades' },
                        { label: 'Win Rate', value: `${stats.winRate.toFixed(0)}%`, sub: `${stats.wins}W/${stats.losses}L`, color: stats.winRate >= 50 ? 'text-green-400' : 'text-red-400' },
                        { label: 'Best', value: `+${stats.bestTrade?.profitPct?.toFixed(0) ?? 0}%`, sub: stats.bestTrade?.tokenSymbol ?? '—', color: 'text-green-400' },
                        { label: 'Worst', value: `${(stats.worstTrade?.profitPct ?? 0).toFixed(0)}%`, sub: stats.worstTrade?.tokenSymbol ?? '—', color: 'text-red-400' },
                    ].map(({ label, value, sub, color }) => (
                        <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
                            <p className="text-[10px] text-gray-600 mb-1">{label}</p>
                            <p className={`text-sm font-bold ${color ?? 'text-white'}`}>{value}</p>
                            <p className="text-[10px] text-gray-600 mt-0.5 truncate">{sub}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* ── OPEN POSITIONS LIVE ── */}
            {pnlList.length > 0 && (
                <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-400">Posisi Terbuka <span className="text-green-500 animate-pulse">● Live</span></p>
                    {pnlList.map(p => {
                        const pct = p.profitPct;
                        const pos = positions.find(x => x.tokenAddress.toLowerCase() === p.tokenAddress.toLowerCase());
                        const holdMs = p.holdMs || (pos ? Date.now() - pos.openedAt : 0);
                        const color = pct === null ? 'text-gray-400'
                            : pct >= 20 ? 'text-green-400'
                            : pct >= 0  ? 'text-green-300'
                            : pct >= -10 ? 'text-yellow-400'
                            : 'text-red-400';
                        const bg = pct === null ? 'bg-gray-900 border-gray-800'
                            : pct >= 20 ? 'bg-green-900/30 border-green-700/60'
                            : pct >= 0  ? 'bg-green-900/10 border-green-800/40'
                            : pct >= -10 ? 'bg-yellow-900/20 border-yellow-800/40'
                            : 'bg-red-900/20 border-red-800/40';

                        return (
                            <div key={p.tokenAddress} className={`border rounded-xl px-4 py-3 flex items-center justify-between transition-all duration-500 ${bg}`}>
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-xs font-bold text-gray-300">
                                        {p.tokenSymbol.slice(0, 2)}
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-white">{p.tokenSymbol}</p>
                                        <p className="text-xs text-gray-600">⏱ {holdTime(holdMs)}</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className={`text-lg font-bold ${color}`}>
                                        {pct !== null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : '...'}
                                    </p>
                                    {p.multiplier !== null && (
                                        <p className="text-xs text-gray-500">{p.multiplier.toFixed(3)}x</p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── LIVE TRANSACTION FEED ── */}
            <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-400">Feed Transaksi Terbaru</p>

                {trades.length === 0 && (
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
                        <p className="text-2xl mb-2">📡</p>
                        <p className="text-sm text-gray-500">Menunggu transaksi...</p>
                        <p className="text-xs text-gray-700 mt-1">Feed akan update otomatis setelah bot trade</p>
                    </div>
                )}

                {trades.slice(0, 20).map(trade => {
                    const isNew    = newIds.has(trade.id);
                    const isWin    = (trade.profitPct ?? 0) > 0;
                    const pct      = trade.profitPct;
                    const pctColor = pct === null ? 'text-gray-400' : isWin ? 'text-green-400' : 'text-red-400';
                    const profitEth = pct !== null
                        ? trade.entryEth * (trade.percentSold / 100) * (pct / 100)
                        : null;

                    return (
                        <div
                            key={trade.id}
                            className={`border rounded-xl px-4 py-3 transition-all duration-700
                                ${isNew
                                    ? 'border-green-500/80 bg-green-900/20 ring-1 ring-green-500/30 scale-[1.01]'
                                    : isWin
                                        ? 'border-green-900/50 bg-gray-900'
                                        : 'border-red-900/40 bg-gray-900'
                                }`}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2.5">
                                    <span className="text-lg">{REASON_ICON[trade.reason] ?? '📋'}</span>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold text-white">{trade.tokenSymbol}</span>
                                            {isNew && (
                                                <span className="text-[10px] bg-green-600 text-white px-1.5 py-0.5 rounded-full font-semibold animate-pulse">NEW</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-gray-600 mt-0.5">
                                            <span>Jual {trade.percentSold}%</span>
                                            <span>·</span>
                                            <span>{holdTime(trade.holdMs)}</span>
                                            <span>·</span>
                                            <span>{timeAgo(trade.closedAt)}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className={`text-base font-bold ${pctColor}`}>
                                        {pct !== null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : '—'}
                                    </p>
                                    {profitEth !== null && (
                                        <p className={`text-xs ${profitEth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {fmtEth(profitEth)} ETH
                                        </p>
                                    )}
                                </div>
                            </div>

                            {trade.txHash && (
                                <div className="mt-2 pt-2 border-t border-gray-800 flex items-center justify-between">
                                    <p className="text-[10px] text-gray-700 font-mono truncate max-w-[160px]">
                                        {trade.txHash.slice(0, 18)}...
                                    </p>
                                    <a
                                        href={`https://basescan.org/tx/${trade.txHash}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-blue-500 hover:text-blue-400 transition-colors flex items-center gap-1"
                                    >
                                        Basescan ↗
                                    </a>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default LiveDashboard;
