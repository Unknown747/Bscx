import React, { useEffect, useState, useCallback } from 'react';
import { authFetch } from '../lib/authFetch';

interface WhaleEntry {
    address:   string;
    name:      string;
    timestamp: number;
    amountEth: number;
}

interface CorrelationSignal {
    tokenAddress:  string;
    tokenSymbol:   string;
    whaleCount:    number;
    whales:        WhaleEntry[];
    firstBuyAt:    number;
    lastBuyAt:     number;
    confidence:    number;
    windowMinutes: number;
}

interface Props { apiUrl: string; }

function timeAgo(ts: number): string {
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60)    return `${secs}d lalu`;
    if (secs < 3600)  return `${Math.floor(secs / 60)}m lalu`;
    return `${Math.floor(secs / 3600)}j lalu`;
}

function shortAddr(addr: string): string {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function ConfidenceBar({ value }: { value: number }) {
    const color = value >= 70 ? 'bg-emerald-500' : value >= 40 ? 'bg-yellow-500' : 'bg-orange-500';
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${value}%` }} />
            </div>
            <span className="text-xs font-bold w-9 text-right" style={{ color: value >= 70 ? '#34d399' : value >= 40 ? '#facc15' : '#fb923c' }}>
                {value}%
            </span>
        </div>
    );
}

const WhaleCorrelation: React.FC<Props> = ({ apiUrl }) => {
    const [signals,    setSignals]    = useState<CorrelationSignal[]>([]);
    const [loading,    setLoading]    = useState(true);
    const [error,      setError]      = useState('');
    const [expanded,   setExpanded]   = useState<string | null>(null);
    const [lastUpdate, setLastUpdate] = useState('');

    const load = useCallback(async () => {
        try {
            const res  = await authFetch(`${apiUrl}/api/whale/correlation`);
            const data = await res.json();
            setSignals(data.correlations ?? []);
            setError('');
            setLastUpdate(new Date().toLocaleTimeString('id-ID'));
        } catch {
            setError('Gagal memuat data korelasi');
        } finally {
            setLoading(false);
        }
    }, [apiUrl]);

    useEffect(() => {
        load();
        const iv = setInterval(load, 10_000);
        return () => clearInterval(iv);
    }, [load]);

    return (
        <div className="space-y-3 pb-6">
            {/* Header */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-lg">🔗</span>
                        <div>
                            <h2 className="text-sm font-semibold text-white">Whale Correlation Map</h2>
                            <p className="text-xs text-gray-500">Sinyal kuat: 2+ whale beli token yang sama dalam 10 menit</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {lastUpdate && <span className="text-xs text-gray-600">{lastUpdate}</span>}
                        <div className={`w-2 h-2 rounded-full ${signals.length > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-gray-700'}`} />
                    </div>
                </div>

                {/* Legend */}
                <div className="mt-3 flex gap-4 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Confidence ≥70%</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> 40–69%</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block" /> &lt;40%</span>
                </div>
            </div>

            {error && (
                <div className="bg-red-900/30 border border-red-800 rounded-xl p-3 text-xs text-red-400">{error}</div>
            )}

            {loading && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
                    <div className="inline-block w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
                    <p className="text-sm text-gray-500">Memuat korelasi…</p>
                </div>
            )}

            {!loading && signals.length === 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
                    <p className="text-3xl mb-3">🔗</p>
                    <p className="text-sm text-gray-400">Belum ada sinyal korelasi aktif</p>
                    <p className="text-xs text-gray-600 mt-1">Sinyal muncul ketika 2+ whale membeli token yang sama dalam 10 menit terakhir</p>
                </div>
            )}

            {!loading && signals.map(sig => {
                const isExpanded = expanded === sig.tokenAddress;
                const borderColor = sig.confidence >= 70 ? 'border-emerald-700/60' : sig.confidence >= 40 ? 'border-yellow-700/50' : 'border-orange-700/50';
                const bgColor     = sig.confidence >= 70 ? 'bg-emerald-950/40' : sig.confidence >= 40 ? 'bg-yellow-950/30' : 'bg-orange-950/30';

                return (
                    <div key={sig.tokenAddress} className={`border rounded-xl overflow-hidden ${borderColor} ${bgColor}`}>
                        {/* Main row */}
                        <button
                            className="w-full text-left px-4 py-3"
                            onClick={() => setExpanded(isExpanded ? null : sig.tokenAddress)}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-base">🐋</span>
                                    <span className="font-bold text-white text-sm">{sig.tokenSymbol}</span>
                                    <span className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-full">
                                        {sig.whaleCount} whale
                                    </span>
                                    <span className="text-xs text-gray-500">
                                        dalam {sig.windowMinutes.toFixed(1)} mnt
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-500">{timeAgo(sig.lastBuyAt)}</span>
                                    <span className="text-gray-600 text-xs">{isExpanded ? '▲' : '▼'}</span>
                                </div>
                            </div>
                            <ConfidenceBar value={sig.confidence} />
                            <div className="mt-1.5 flex items-center gap-2">
                                <code className="text-xs text-gray-600 font-mono">{shortAddr(sig.tokenAddress)}</code>
                                <a
                                    href={`https://dexscreener.com/base/${sig.tokenAddress}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    className="text-xs text-blue-500 hover:text-blue-400"
                                >
                                    DexScreener ↗
                                </a>
                            </div>
                        </button>

                        {/* Expanded whale list */}
                        {isExpanded && (
                            <div className="border-t border-gray-800/60 px-4 py-3 space-y-2">
                                <p className="text-xs text-gray-500 mb-2">Detail pembelian whale:</p>
                                {sig.whales.sort((a, b) => a.timestamp - b.timestamp).map((w, i) => (
                                    <div key={w.address} className="flex items-center justify-between bg-gray-900/60 rounded-lg px-3 py-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm">{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</span>
                                            <div>
                                                <p className="text-xs font-semibold text-white">{w.name}</p>
                                                <a
                                                    href={`https://basescan.org/address/${w.address}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-xs text-gray-500 hover:text-blue-400 font-mono"
                                                >
                                                    {shortAddr(w.address)}
                                                </a>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            {w.amountEth > 0 && (
                                                <p className="text-xs font-bold text-emerald-400">{w.amountEth.toFixed(4)} ETH</p>
                                            )}
                                            <p className="text-xs text-gray-600">{timeAgo(w.timestamp)}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}

            {!loading && signals.length > 0 && (
                <p className="text-center text-xs text-gray-700">
                    {signals.length} sinyal aktif · window 10 menit · refresh otomatis 10d
                </p>
            )}
        </div>
    );
};

export default WhaleCorrelation;
