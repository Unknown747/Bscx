import React, { useEffect, useState, useCallback } from 'react';

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

interface HistoryData {
    trades: ClosedTrade[];
    stats: TradeStats;
}

function timeAgo(ts: number): string {
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60)    return `${secs}d lalu`;
    if (secs < 3600)  return `${Math.floor(secs / 60)}m lalu`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}j lalu`;
    return new Date(ts).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

function holdTime(ms: number): string {
    if (ms < 60000)   return `${Math.round(ms / 1000)}d`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${(ms / 3600000).toFixed(1)}j`;
}

const REASON_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
    'take-profit': { icon: '🎯', color: 'text-green-400',  label: 'TP' },
    'stop-loss':   { icon: '🛑', color: 'text-red-400',    label: 'SL' },
    'manual':      { icon: '👆', color: 'text-yellow-400', label: 'Manual' },
    'dca':         { icon: '📉', color: 'text-blue-400',   label: 'DCA' },
};

interface Props { apiUrl: string; }

const TradeHistory: React.FC<Props> = ({ apiUrl }) => {
    const [data, setData]   = useState<HistoryData | null>(null);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            const res  = await fetch(`${apiUrl}/api/history`);
            const json = await res.json();
            setData(json);
            setError('');
        } catch {
            setError('Gagal memuat histori');
        }
    }, [apiUrl]);

    useEffect(() => {
        load();
        const iv = setInterval(load, 10000);
        return () => clearInterval(iv);
    }, [load]);

    const stats  = data?.stats;
    const trades = data?.trades ?? [];

    return (
        <div className="space-y-4 pb-6">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-300">Histori Trade</h2>
                <span className="text-xs text-gray-600">{trades.length} closed</span>
            </div>

            {error && (
                <div className="bg-red-900/30 border border-red-800 rounded-xl p-3 text-xs text-red-400">{error}</div>
            )}

            {stats && stats.total > 0 && (
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                        <p className="text-xs text-gray-500 mb-1">Win Rate</p>
                        <p className={`text-xl font-bold ${stats.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                            {stats.winRate.toFixed(0)}%
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">{stats.wins}W / {stats.losses}L</p>
                    </div>
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                        <p className="text-xs text-gray-500 mb-1">Total Trade</p>
                        <p className="text-xl font-bold text-white">{stats.total}</p>
                        <p className="text-xs text-gray-600 mt-0.5">closed positions</p>
                    </div>
                    {stats.bestTrade && (
                        <div className="bg-green-900/20 border border-green-800/40 rounded-xl p-4">
                            <p className="text-xs text-gray-500 mb-1">Best Trade</p>
                            <p className="text-xl font-bold text-green-400">
                                +{stats.bestTrade.profitPct?.toFixed(1)}%
                            </p>
                            <p className="text-xs text-green-600 mt-0.5">{stats.bestTrade.tokenSymbol}</p>
                        </div>
                    )}
                    {stats.worstTrade && (
                        <div className="bg-red-900/20 border border-red-800/40 rounded-xl p-4">
                            <p className="text-xs text-gray-500 mb-1">Worst Trade</p>
                            <p className="text-xl font-bold text-red-400">
                                {(stats.worstTrade.profitPct ?? 0) > 0 ? '+' : ''}{stats.worstTrade.profitPct?.toFixed(1)}%
                            </p>
                            <p className="text-xs text-red-600 mt-0.5">{stats.worstTrade.tokenSymbol}</p>
                        </div>
                    )}
                </div>
            )}

            {trades.length === 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
                    <p className="text-3xl mb-3">📊</p>
                    <p className="text-sm text-gray-500">Belum ada trade yang selesai</p>
                    <p className="text-xs text-gray-700 mt-1">Histori muncul setelah TP, SL, atau manual sell</p>
                </div>
            )}

            <div className="space-y-2">
                {trades.map(trade => {
                    const cfg      = REASON_CONFIG[trade.reason] ?? REASON_CONFIG['manual'];
                    const isProfit = (trade.profitPct ?? 0) > 0;
                    const profitColor = trade.profitPct === null
                        ? 'text-gray-500'
                        : isProfit ? 'text-green-400' : 'text-red-400';

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
                                    {trade.profitPct === null
                                        ? '—'
                                        : `${isProfit ? '+' : ''}${trade.profitPct.toFixed(1)}%`
                                    }
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 text-xs text-gray-600">
                                    <span>Jual {trade.percentSold}%</span>
                                    <span>Hold {holdTime(trade.holdMs)}</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-gray-600">{timeAgo(trade.closedAt)}</span>
                                    {trade.txHash && (
                                        <a
                                            href={`https://basescan.org/tx/${trade.txHash}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-500 hover:text-blue-400 transition-colors"
                                        >
                                            ↗ TX
                                        </a>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default TradeHistory;
