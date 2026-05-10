import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../lib/authFetch';
import WhaleDetailModal from './WhaleDetailModal';

interface Wallet {
    address: string;
    name: string;
    isActive: boolean;
    totalPnL: number;
    winRate: number;
    copiedTrades: number;
    wins: number;
    losses: number;
    autoPaused: boolean;
}

interface WhaleLeaderboardProps {
    apiUrl: string;
}

type SortKey = 'winRate' | 'pnl';

function rankMedal(i: number): string {
    if (i === 0) return '🥇';
    if (i === 1) return '🥈';
    if (i === 2) return '🥉';
    return `#${i + 1}`;
}

function winRateBadge(wr: number, trades: number): string {
    if (trades === 0) return 'text-gray-500 bg-gray-800 border-gray-700';
    if (wr >= 60)    return 'text-green-400 bg-green-900/30 border-green-800';
    if (wr >= 40)    return 'text-yellow-400 bg-yellow-900/20 border-yellow-800';
    return 'text-red-400 bg-red-900/20 border-red-800';
}

function pnlColor(pnl: number, trades: number): string {
    if (trades === 0) return 'text-gray-500';
    return pnl >= 0 ? 'text-green-400' : 'text-red-400';
}

function statusDot(w: Wallet): { color: string; label: string } {
    if (w.autoPaused) return { color: 'bg-orange-500', label: 'Auto-paused' };
    if (w.isActive)   return { color: 'bg-green-500 animate-pulse', label: 'Aktif' };
    return { color: 'bg-gray-600', label: 'Jeda' };
}

const WhaleLeaderboard: React.FC<WhaleLeaderboardProps> = ({ apiUrl }) => {
    const [wallets, setWallets]       = useState<Wallet[]>([]);
    const [sortBy, setSortBy]         = useState<SortKey>('winRate');
    const [loading, setLoading]       = useState(true);
    const [lastUpdate, setLastUpdate] = useState('');
    const [detailAddr, setDetailAddr] = useState<{ address: string; name: string } | null>(null);

    const fetchWallets = useCallback(async () => {
        try {
            const res  = await authFetch(`${apiUrl}/api/wallets`);
            const data = await res.json();
            setWallets(data.wallets || []);
            setLastUpdate(new Date().toLocaleTimeString('id-ID'));
        } catch { }
        setLoading(false);
    }, [apiUrl]);

    useEffect(() => {
        fetchWallets();
        const id = setInterval(fetchWallets, 5000);
        return () => clearInterval(id);
    }, [fetchWallets]);

    const sorted = [...wallets].sort((a, b) => {
        if (sortBy === 'winRate') {
            if (a.copiedTrades === 0 && b.copiedTrades === 0) return 0;
            if (a.copiedTrades === 0) return 1;
            if (b.copiedTrades === 0) return -1;
            if (b.winRate !== a.winRate) return b.winRate - a.winRate;
            return b.totalPnL - a.totalPnL;
        } else {
            if (a.copiedTrades === 0 && b.copiedTrades === 0) return 0;
            if (a.copiedTrades === 0) return 1;
            if (b.copiedTrades === 0) return -1;
            if (b.totalPnL !== a.totalPnL) return b.totalPnL - a.totalPnL;
            return b.winRate - a.winRate;
        }
    });

    const totalTrades = wallets.reduce((s, w) => s + w.copiedTrades, 0);
    const bestWR      = wallets.reduce((best, w) => w.copiedTrades > 0 && w.winRate > best ? w.winRate : best, 0);
    const totalPnL    = wallets.reduce((s, w) => s + w.totalPnL, 0);

    return (
        <>
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                <div className="flex items-center gap-2">
                    <span className="text-base">🏆</span>
                    <h2 className="text-sm font-semibold text-white">Whale Leaderboard</h2>
                    {loading && (
                        <svg className="animate-spin h-3 w-3 text-gray-500" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                    )}
                </div>
                <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
                    {(['winRate', 'pnl'] as SortKey[]).map(key => (
                        <button
                            key={key}
                            onClick={() => setSortBy(key)}
                            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${
                                sortBy === key ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'
                            }`}
                        >
                            {key === 'winRate' ? 'WR' : 'P&L'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Summary strip */}
            {totalTrades > 0 && (
                <div className="grid grid-cols-3 divide-x divide-gray-800 border-b border-gray-800">
                    <div className="px-3 py-2 text-center">
                        <p className="text-xs text-gray-600">Total Trades</p>
                        <p className="text-sm font-bold text-white">{totalTrades}</p>
                    </div>
                    <div className="px-3 py-2 text-center">
                        <p className="text-xs text-gray-600">Best WR</p>
                        <p className="text-sm font-bold text-green-400">{bestWR.toFixed(0)}%</p>
                    </div>
                    <div className="px-3 py-2 text-center">
                        <p className="text-xs text-gray-600">Combined P&L</p>
                        <p className={`text-sm font-bold ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(1)}%
                        </p>
                    </div>
                </div>
            )}

            {/* Rows */}
            <div className="divide-y divide-gray-800/60">
                {loading ? (
                    <div className="py-8 text-center text-gray-600 text-xs">Memuat...</div>
                ) : sorted.length === 0 ? (
                    <div className="py-8 text-center text-gray-600 text-xs px-4">
                        Belum ada whale wallet.<br />Tambahkan via tombol Whale di atas.
                    </div>
                ) : sorted.map((w, i) => {
                    const dot = statusDot(w);
                    const hasTrades = w.copiedTrades > 0;
                    return (
                        <div
                            key={w.address}
                            onClick={() => setDetailAddr({ address: w.address, name: w.name })}
                            className={`flex items-center gap-3 px-4 py-3.5 transition-colors cursor-pointer active:bg-gray-800/60 ${
                                i === 0 && hasTrades ? 'bg-yellow-900/5 hover:bg-yellow-900/10' : 'hover:bg-gray-800/40'
                            }`}
                        >
                            {/* Rank */}
                            <div className="w-7 text-center flex-shrink-0">
                                {hasTrades
                                    ? <span className="text-sm">{rankMedal(i)}</span>
                                    : <span className="text-xs text-gray-600">#{i + 1}</span>
                                }
                            </div>

                            {/* Status dot */}
                            <div className="flex-shrink-0">
                                <div className={`w-2 h-2 rounded-full ${dot.color}`} title={dot.label} />
                            </div>

                            {/* Name + address */}
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-white truncate leading-tight">{w.name}</p>
                                <p className="text-xs text-gray-600 font-mono">
                                    {w.address.slice(0, 6)}…{w.address.slice(-4)}
                                </p>
                            </div>

                            {/* Stats */}
                            {hasTrades ? (
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${winRateBadge(w.winRate, w.copiedTrades)}`}>
                                        {w.winRate.toFixed(0)}%
                                    </span>
                                    <span className="text-xs text-gray-500">
                                        {w.wins}W/{w.losses}L
                                    </span>
                                    <span className={`text-xs font-bold ${pnlColor(w.totalPnL, w.copiedTrades)}`}>
                                        {w.totalPnL >= 0 ? '+' : ''}{w.totalPnL.toFixed(1)}%
                                    </span>
                                </div>
                            ) : (
                                <span className="text-xs text-gray-600 italic flex-shrink-0">Belum ada trade</span>
                            )}

                            <span className="text-gray-700 text-xs flex-shrink-0">›</span>
                        </div>
                    );
                })}
            </div>

            {/* Footer */}
            {lastUpdate && (
                <div className="px-4 py-2 border-t border-gray-800/60 flex items-center justify-between">
                    <span className="text-xs text-gray-700">Ketuk untuk detail</span>
                    <span className="text-xs text-gray-700">{lastUpdate}</span>
                </div>
            )}
        </div>

        {detailAddr && (
            <WhaleDetailModal
                apiUrl={apiUrl}
                address={detailAddr.address}
                name={detailAddr.name}
                onClose={() => setDetailAddr(null)}
            />
        )}
        </>
    );
};

export default WhaleLeaderboard;
