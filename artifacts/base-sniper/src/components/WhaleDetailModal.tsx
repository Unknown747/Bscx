import React, { useEffect, useState, useMemo } from 'react';
import { authFetch } from '../lib/authFetch';
import TokenSafetyBadge from './TokenSafetyBadge';

interface QualityScore {
    totalScore:      number;
    sharpeRatio:     number;
    avgEntryTiming:  number;
    realizedPnL7d:   number;
    buyToSellRatio:  number;
    mevDetected:     boolean;
    uniquePoolCount: number;
    tradeCount:      number;
    avgVolumeUsd:    number;
}

interface WaitlistEvent {
    id?:         number;
    eventType:   string;
    token?:      string;
    profitPct?:  number;
    volumeEth?:  number;
    recordedAt:  number;
}

interface WaitlistSummary {
    totalEvents:  number;
    wins:         number;
    losses:       number;
    avgProfitPct: number;
}

interface WhaleDetailData {
    address:  string;
    analysis: QualityScore;
    events:   WaitlistEvent[];
    summary:  WaitlistSummary;
}

interface Props {
    apiUrl:   string;
    address:  string;
    name?:    string;
    onClose:  () => void;
    onApprove?: (address: string) => void;
    onReject?:  (address: string) => void;
    showActions?: boolean;
}

function ScoreBadge({ score }: { score: number }) {
    const color = score >= 70 ? 'text-green-400 border-green-700 bg-green-900/30' :
                  score >= 45 ? 'text-yellow-400 border-yellow-700 bg-yellow-900/20' :
                                'text-red-400 border-red-700 bg-red-900/20';
    return (
        <span className={`text-2xl font-bold px-3 py-1 rounded-xl border ${color}`}>{score}/100</span>
    );
}

function MetricRow({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean | null }) {
    const valueColor = good == null ? 'text-white' : good ? 'text-green-400' : 'text-red-400';
    return (
        <div className="flex items-center justify-between py-2 border-b border-gray-800/50">
            <span className="text-xs text-gray-500">{label}</span>
            <div className="text-right">
                <span className={`text-sm font-semibold ${valueColor}`}>{value}</span>
                {sub && <p className="text-xs text-gray-600">{sub}</p>}
            </div>
        </div>
    );
}

const WhaleDetailModal: React.FC<Props> = ({ apiUrl, address, name, onClose, onApprove, onReject, showActions }) => {
    const [data, setData]     = useState<WhaleDetailData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]   = useState('');
    const [actionLoading, setActionLoading] = useState<'approve' | 'reject' | null>(null);

    useEffect(() => {
        setLoading(true);
        authFetch(`${apiUrl}/api/whale/detail/${address}`)
            .then(r => r.json())
            .then(d => {
                if (d.error) throw new Error(d.error);
                setData(d);
            })
            .catch(e => setError(e.message || 'Gagal memuat data'))
            .finally(() => setLoading(false));
    }, [apiUrl, address]);

    const handleApprove = async () => {
        if (!onApprove) return;
        setActionLoading('approve');
        await onApprove(address);
        setActionLoading(null);
        onClose();
    };

    const handleReject = async () => {
        if (!onReject) return;
        setActionLoading('reject');
        await onReject(address);
        setActionLoading(null);
        onClose();
    };

    const a = data?.analysis;
    const s = data?.summary;

    // Extract up to 3 unique recent token addresses from buy events
    const recentTokens = useMemo(() => {
        if (!data?.events) return [];
        const seen = new Set<string>();
        const result: string[] = [];
        for (const e of data.events) {
            if (e.token && e.token.match(/^0x[0-9a-fA-F]{40}$/i) && !seen.has(e.token.toLowerCase())) {
                seen.add(e.token.toLowerCase());
                result.push(e.token);
                if (result.length >= 3) break;
            }
        }
        return result;
    }, [data?.events]);

    const [safetyExpanded, setSafetyExpanded] = useState(false);

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">

                {/* Header */}
                <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-5 py-4 flex items-center justify-between rounded-t-2xl">
                    <div>
                        <h2 className="text-base font-bold text-white">🔬 Analisis Whale</h2>
                        <p className="text-xs text-gray-500 font-mono mt-0.5">{name || `${address.slice(0,10)}...${address.slice(-4)}`}</p>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none">&times;</button>
                </div>

                <div className="p-5 space-y-4">
                    {loading && (
                        <div className="flex flex-col items-center py-10 gap-3">
                            <svg className="animate-spin h-6 w-6 text-blue-400" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                            </svg>
                            <p className="text-xs text-gray-500">Menganalisis whale on-chain...</p>
                        </div>
                    )}

                    {error && !loading && (
                        <div className="bg-red-900/30 border border-red-800 rounded-xl p-4 text-sm text-red-400 text-center">
                            ❌ {error}
                        </div>
                    )}

                    {!loading && !error && a && (
                        <>
                            {/* Score banner */}
                            <div className="flex items-center justify-between bg-gray-800/60 rounded-xl px-4 py-3">
                                <div>
                                    <p className="text-xs text-gray-500 mb-1">Skor Kualitas</p>
                                    <ScoreBadge score={a.totalScore} />
                                </div>
                                <div className="text-right">
                                    <p className="text-xs text-gray-500 mb-1">Trade Terdeteksi</p>
                                    <p className="text-lg font-bold text-white">{a.tradeCount}</p>
                                    {a.mevDetected && (
                                        <span className="text-xs text-orange-400 bg-orange-900/30 border border-orange-800 rounded-full px-2 py-0.5">
                                            ⚠️ MEV/Bot
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Metrics */}
                            <div className="bg-gray-800/30 rounded-xl px-4 py-1">
                                <MetricRow
                                    label="Sharpe Ratio"
                                    value={a.sharpeRatio.toFixed(2)}
                                    sub="risiko terbobot vs return"
                                    good={a.sharpeRatio > 1.0 ? true : a.sharpeRatio > 0.5 ? null : false}
                                />
                                <MetricRow
                                    label="Entry Timing"
                                    value={`${a.avgEntryTiming}/100`}
                                    sub="seberapa awal masuk"
                                    good={a.avgEntryTiming >= 70 ? true : a.avgEntryTiming >= 40 ? null : false}
                                />
                                <MetricRow
                                    label="Realized PnL 7d"
                                    value={`${a.realizedPnL7d >= 0 ? '+' : ''}${a.realizedPnL7d}%`}
                                    good={a.realizedPnL7d > 0 ? true : a.realizedPnL7d === 0 ? null : false}
                                />
                                <MetricRow
                                    label="Buy/Sell Ratio"
                                    value={a.buyToSellRatio.toFixed(2)}
                                    sub="> 1 = net buyer"
                                    good={a.buyToSellRatio >= 1.2 ? true : a.buyToSellRatio >= 0.8 ? null : false}
                                />
                                <MetricRow
                                    label="Unique Pools"
                                    value={`${a.uniquePoolCount}`}
                                    good={a.uniquePoolCount >= 3 ? true : null}
                                />
                                <MetricRow
                                    label="Avg Volume / Trade"
                                    value={`$${a.avgVolumeUsd.toLocaleString('en', { maximumFractionDigits: 0 })}`}
                                />
                            </div>

                            {/* Waitlist summary */}
                            {s && s.totalEvents > 0 && (
                                <div className="bg-blue-900/20 border border-blue-800/40 rounded-xl p-4">
                                    <p className="text-xs font-semibold text-blue-300 mb-2">📋 Riwayat Waitlist</p>
                                    <div className="grid grid-cols-3 gap-2 text-center">
                                        <div>
                                            <p className="text-lg font-bold text-white">{s.totalEvents}</p>
                                            <p className="text-xs text-gray-500">Events</p>
                                        </div>
                                        <div>
                                            <p className="text-lg font-bold text-green-400">{s.wins}W / {s.losses}L</p>
                                            <p className="text-xs text-gray-500">W/L</p>
                                        </div>
                                        <div>
                                            <p className={`text-lg font-bold ${s.avgProfitPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                {s.avgProfitPct >= 0 ? '+' : ''}{s.avgProfitPct}%
                                            </p>
                                            <p className="text-xs text-gray-500">Avg P&L</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Recent waitlist events — with inline safety badges */}
                            {(data?.events?.length ?? 0) > 0 && (
                                <div>
                                    <p className="text-xs text-gray-600 font-medium uppercase tracking-wide mb-2">Event Terbaru</p>
                                    <div className="space-y-1.5">
                                        {data!.events.slice(0, 8).map((e, i) => (
                                            <div key={i} className="bg-gray-800/30 rounded-lg px-3 py-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="text-xs flex-shrink-0">{e.eventType === 'buy' ? '🟢' : e.eventType === 'sell' ? '🔴' : '⚪'}</span>
                                                        <span className="text-xs text-gray-400 font-mono truncate">{e.token ? `${e.token.slice(0,8)}...` : e.eventType}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2 flex-shrink-0">
                                                        {e.profitPct != null && (
                                                            <span className={`text-xs font-semibold ${e.profitPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                                {e.profitPct >= 0 ? '+' : ''}{e.profitPct.toFixed(1)}%
                                                            </span>
                                                        )}
                                                        <span className="text-xs text-gray-700">{new Date(e.recordedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                                                    </div>
                                                </div>
                                                {/* Inline safety badge for buy events with token address */}
                                                {e.token && e.token.match(/^0x[0-9a-fA-F]{40}$/i) && (
                                                    <div className="mt-1.5 ml-5">
                                                        <TokenSafetyBadge
                                                            apiUrl={apiUrl}
                                                            tokenAddress={e.token}
                                                            size="compact"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Token Safety Analysis — full scan for recent tokens */}
                            {recentTokens.length > 0 && (
                                <div>
                                    <button
                                        onClick={() => setSafetyExpanded(p => !p)}
                                        className="w-full flex items-center justify-between text-xs font-semibold text-gray-400 hover:text-white transition-colors py-1"
                                    >
                                        <span>🔒 Analisis Keamanan Token ({recentTokens.length} token terakhir)</span>
                                        <span className="text-gray-600">{safetyExpanded ? '▲' : '▼'}</span>
                                    </button>

                                    {safetyExpanded && (
                                        <div className="space-y-3 mt-2">
                                            {recentTokens.map((tokenAddr, i) => (
                                                <div key={tokenAddr}>
                                                    <p className="text-xs text-gray-600 font-mono mb-1.5">
                                                        Token #{i + 1}: {tokenAddr.slice(0, 14)}…{tokenAddr.slice(-6)}
                                                        <a
                                                            href={`https://basescan.org/token/${tokenAddr}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="ml-2 text-blue-500 hover:text-blue-400"
                                                        >BaseScan ↗</a>
                                                    </p>
                                                    <TokenSafetyBadge
                                                        apiUrl={apiUrl}
                                                        tokenAddress={tokenAddr}
                                                        size="full"
                                                        showFlags
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* External links */}
                            <div className="flex gap-2">
                                <a
                                    href={`https://basescan.org/address/${address}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-1 text-center text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-2 rounded-xl transition-colors"
                                >
                                    🔍 BaseScan
                                </a>
                                <a
                                    href={`https://debank.com/profile/${address}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-1 text-center text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-2 rounded-xl transition-colors"
                                >
                                    🏦 DeBank
                                </a>
                            </div>

                            {/* Action buttons */}
                            {showActions && (onApprove || onReject) && (
                                <div className="flex gap-3 pt-2">
                                    {onReject && (
                                        <button
                                            onClick={handleReject}
                                            disabled={!!actionLoading}
                                            className="flex-1 bg-red-900/40 hover:bg-red-800/50 border border-red-800 text-red-400 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                                        >
                                            {actionLoading === 'reject' ? '...' : '❌ Tolak'}
                                        </button>
                                    )}
                                    {onApprove && (
                                        <button
                                            onClick={handleApprove}
                                            disabled={!!actionLoading}
                                            className="flex-1 bg-green-700 hover:bg-green-600 text-white py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                                        >
                                            {actionLoading === 'approve' ? '...' : '🔬 Setujui untuk Monitor'}
                                        </button>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default WhaleDetailModal;
