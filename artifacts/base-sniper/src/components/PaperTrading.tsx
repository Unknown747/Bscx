import React, { useEffect, useState, useCallback } from 'react';
import { authFetch } from '../lib/authFetch';

interface PaperStats {
    enabled:          boolean;
    virtualBalance:   number;
    startingBalance:  number;
    totalProfitEth:   number;
    totalProfitPct:   number;
    openPositions:    number;
    closedTrades:     number;
    wins:             number;
    losses:           number;
    winRate:          number;
    bestTradePct:     number;
    worstTradePct:    number;
    avgHoldMs:        number;
}

interface PaperPosition {
    tokenAddress:  string;
    tokenSymbol:   string;
    entryPriceUsd: number;
    virtualEthIn:  number;
    remainingPct:  number;
    openedAt:      number;
    peakPriceUsd:  number;
    tp1Hit:        boolean;
    source:        string;
    dexUrl:        string;
}

interface PaperTrade {
    id:            string;
    tokenAddress:  string;
    tokenSymbol:   string;
    entryPriceUsd: number;
    exitPriceUsd:  number;
    virtualEthIn:  number;
    virtualEthOut: number;
    profitPct:     number;
    profitEth:     number;
    holdMs:        number;
    closedAt:      number;
    reason:        string;
    tpLevel?:      number;
    source:        string;
    dexUrl:        string;
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

function fmtPrice(n: number): string {
    if (n === 0) return '$0';
    if (n < 0.000001) return `$${n.toExponential(2)}`;
    if (n < 0.001)    return `$${n.toFixed(6)}`;
    if (n < 1)        return `$${n.toFixed(4)}`;
    return `$${n.toFixed(2)}`;
}

const REASON_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
    'take-profit': { icon: '🎯', color: 'text-green-400',  label: 'TP'     },
    'stop-loss':   { icon: '🛑', color: 'text-red-400',    label: 'SL'     },
    'manual':      { icon: '👆', color: 'text-yellow-400', label: 'Manual' },
};

interface Props { apiUrl: string; }

const PaperTrading: React.FC<Props> = ({ apiUrl }) => {
    const [stats,      setStats]      = useState<PaperStats | null>(null);
    const [positions,  setPositions]  = useState<PaperPosition[]>([]);
    const [trades,     setTrades]     = useState<PaperTrade[]>([]);
    const [toggling,   setToggling]   = useState(false);
    const [resetting,  setResetting]  = useState(false);
    const [error,      setError]      = useState('');
    const [closingId,  setClosingId]  = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const [statsRes, posRes, tradesRes] = await Promise.all([
                authFetch(`${apiUrl}/api/paper/stats`),
                authFetch(`${apiUrl}/api/paper/positions`),
                authFetch(`${apiUrl}/api/paper/trades`),
            ]);
            if (statsRes.ok)  setStats(await statsRes.json());
            if (posRes.ok)    setPositions(await posRes.json());
            if (tradesRes.ok) setTrades(await tradesRes.json());
            setError('');
        } catch {
            setError('Gagal memuat data paper trading');
        }
    }, [apiUrl]);

    useEffect(() => {
        load();
        const iv = setInterval(load, 15000);
        return () => clearInterval(iv);
    }, [load]);

    const handleToggle = async () => {
        setToggling(true);
        try {
            const enabled = !(stats?.enabled ?? false);
            const res = await authFetch(`${apiUrl}/api/paper/toggle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled }),
            });
            if (res.ok) await load();
        } catch {
            setError('Gagal mengubah status paper trading');
        } finally {
            setToggling(false);
        }
    };

    const handleReset = async () => {
        if (!window.confirm('Reset paper trading? Semua posisi virtual dan histori akan dihapus.')) return;
        setResetting(true);
        try {
            const res = await authFetch(`${apiUrl}/api/paper/reset`, { method: 'DELETE' });
            if (res.ok) { await load(); }
        } catch {
            setError('Gagal reset paper trading');
        } finally {
            setResetting(false);
        }
    };

    const handleClose = async (tokenAddress: string) => {
        setClosingId(tokenAddress);
        try {
            await authFetch(`${apiUrl}/api/paper/close`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tokenAddress }),
            });
            await load();
        } catch {
            setError('Gagal menutup posisi paper');
        } finally {
            setClosingId(null);
        }
    };

    const balanceDelta = stats ? stats.virtualBalance - stats.startingBalance : 0;
    const balanceColor = balanceDelta >= 0 ? 'text-green-400' : 'text-red-400';

    return (
        <div className="space-y-4 pb-6">

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-sm font-semibold text-gray-300">Paper Trading</h2>
                    <p className="text-xs text-gray-600 mt-0.5">Simulasi tanpa modal nyata</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleReset}
                        disabled={resetting}
                        className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 border border-gray-700 text-gray-400 px-3 py-1.5 rounded-lg transition-colors"
                    >
                        {resetting ? '⏳' : '🔄'} Reset
                    </button>
                    <button
                        onClick={handleToggle}
                        disabled={toggling}
                        className={`flex items-center gap-1.5 text-xs font-semibold px-4 py-1.5 rounded-lg border transition-all ${
                            stats?.enabled
                                ? 'bg-green-900/50 border-green-700 text-green-300 hover:bg-green-900'
                                : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                        }`}
                    >
                        <span className={`w-2 h-2 rounded-full ${stats?.enabled ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
                        {toggling ? 'Mengubah...' : stats?.enabled ? 'Aktif' : 'Nonaktif'}
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-900/30 border border-red-800 rounded-xl p-3 text-xs text-red-400">{error}</div>
            )}

            {/* Info banner when disabled */}
            {stats && !stats.enabled && (
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 text-center">
                    <p className="text-2xl mb-2">📄</p>
                    <p className="text-sm text-gray-400 font-medium">Paper Trading Nonaktif</p>
                    <p className="text-xs text-gray-600 mt-1">Aktifkan untuk mulai merekam sinyal beli/jual virtual berdasarkan harga GeckoTerminal real.</p>
                </div>
            )}

            {/* Stats Grid */}
            {stats && (
                <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-4">
                        <p className="text-xs text-gray-500 mb-1">Saldo Virtual</p>
                        <div className="flex items-baseline gap-2">
                            <p className="text-2xl font-bold text-white">
                                {stats.virtualBalance.toFixed(4)} ETH
                            </p>
                            <span className={`text-sm font-semibold ${balanceColor}`}>
                                {balanceDelta >= 0 ? '+' : ''}{balanceDelta.toFixed(4)} ETH
                            </span>
                        </div>
                        <p className="text-xs text-gray-600 mt-0.5">
                            Mulai dari {stats.startingBalance} ETH
                        </p>
                    </div>

                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                        <p className="text-xs text-gray-500 mb-1">Win Rate</p>
                        <p className={`text-xl font-bold ${stats.winRate >= 50 ? 'text-green-400' : stats.closedTrades === 0 ? 'text-gray-500' : 'text-red-400'}`}>
                            {stats.closedTrades === 0 ? '—' : `${stats.winRate.toFixed(0)}%`}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">{stats.wins}W / {stats.losses}L</p>
                    </div>

                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                        <p className="text-xs text-gray-500 mb-1">Total Trades</p>
                        <p className="text-xl font-bold text-white">{stats.closedTrades}</p>
                        <p className="text-xs text-gray-600 mt-0.5">{stats.openPositions} open</p>
                    </div>

                    {stats.closedTrades > 0 && (
                        <>
                            <div className="bg-green-900/20 border border-green-800/40 rounded-xl p-4">
                                <p className="text-xs text-gray-500 mb-1">Best Trade</p>
                                <p className="text-xl font-bold text-green-400">
                                    {stats.bestTradePct >= 0 ? '+' : ''}{stats.bestTradePct.toFixed(1)}%
                                </p>
                            </div>
                            <div className="bg-red-900/20 border border-red-800/40 rounded-xl p-4">
                                <p className="text-xs text-gray-500 mb-1">Worst Trade</p>
                                <p className="text-xl font-bold text-red-400">
                                    {stats.worstTradePct.toFixed(1)}%
                                </p>
                            </div>
                        </>
                    )}

                    {stats.avgHoldMs > 0 && (
                        <div className="col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-4">
                            <p className="text-xs text-gray-500 mb-1">Rata-rata Hold</p>
                            <p className="text-base font-bold text-white">{holdTime(stats.avgHoldMs)}</p>
                        </div>
                    )}
                </div>
            )}

            {/* Open Positions */}
            {positions.length > 0 && (
                <div>
                    <h3 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">
                        Posisi Terbuka ({positions.length})
                    </h3>
                    <div className="space-y-2">
                        {positions.map(pos => (
                            <div key={pos.tokenAddress} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                                <div className="flex items-center justify-between mb-1.5">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold text-white">{pos.tokenSymbol}</span>
                                        {pos.tp1Hit && <span className="text-xs text-yellow-400 font-medium">TP1 ✓</span>}
                                        <span className="text-xs text-gray-600 capitalize">{pos.source}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {pos.dexUrl && (
                                            <a
                                                href={pos.dexUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-blue-500 hover:text-blue-400"
                                            >
                                                ↗ Chart
                                            </a>
                                        )}
                                        <button
                                            onClick={() => handleClose(pos.tokenAddress)}
                                            disabled={closingId === pos.tokenAddress}
                                            className="text-xs bg-red-900/40 hover:bg-red-900/70 border border-red-800/50 text-red-400 px-2 py-1 rounded-lg transition-colors disabled:opacity-40"
                                        >
                                            {closingId === pos.tokenAddress ? '⏳' : 'Tutup'}
                                        </button>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between text-xs text-gray-500">
                                    <span>Entry {fmtPrice(pos.entryPriceUsd)}</span>
                                    <span>Peak {fmtPrice(pos.peakPriceUsd)}</span>
                                    <span>{pos.virtualEthIn.toFixed(4)} ETH</span>
                                    <span>{timeAgo(pos.openedAt)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Closed Trades */}
            {stats?.enabled && trades.length === 0 && positions.length === 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
                    <p className="text-3xl mb-3">🧪</p>
                    <p className="text-sm text-gray-500">Belum ada trade paper</p>
                    <p className="text-xs text-gray-700 mt-1">Bot akan secara otomatis membuka posisi virtual saat ada sinyal STRONG BUY dari screener atau GeckoTerminal.</p>
                </div>
            )}

            {trades.length > 0 && (
                <div>
                    <h3 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">
                        Histori Paper ({trades.length})
                    </h3>
                    <div className="space-y-2">
                        {trades.map(trade => {
                            const cfg      = REASON_CONFIG[trade.reason] ?? REASON_CONFIG['manual'];
                            const isProfit = trade.profitPct > 0;
                            const profitColor = isProfit ? 'text-green-400' : 'text-red-400';
                            return (
                                <div key={trade.id} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <div className="flex items-center gap-2">
                                            <span className="text-base">{cfg.icon}</span>
                                            <span className="text-sm font-semibold text-white">{trade.tokenSymbol}</span>
                                            <span className={`text-xs font-medium ${cfg.color}`}>
                                                {cfg.label}{trade.tpLevel ?? ''}
                                            </span>
                                        </div>
                                        <span className={`text-sm font-bold ${profitColor}`}>
                                            {isProfit ? '+' : ''}{trade.profitPct.toFixed(1)}%
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between text-xs text-gray-600">
                                        <span>Hold {holdTime(trade.holdMs)}</span>
                                        <span>{isProfit ? '+' : ''}{trade.profitEth.toFixed(5)} ETH</span>
                                        <span className="capitalize text-gray-700">{trade.source}</span>
                                        <span>{timeAgo(trade.closedAt)}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default PaperTrading;
