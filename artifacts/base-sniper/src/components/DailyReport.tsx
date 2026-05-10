import React, { useEffect, useState, useCallback } from 'react';
import { authFetch } from '../lib/authFetch';

interface DayData {
    date: string;
    dateMs: number;
    trades: number;
    wins: number;
    losses: number;
    totalPnlPct: number;
    winRate: number;
}

interface TodaySummary {
    date: string;
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnlPct: number;
    bestPct: number | null;
    worstPct: number | null;
    ethBalance: string | null;
    ethUsd: number | null;
}

interface AllTime {
    total: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnlPct: number;
    bestTrade: any | null;
    worstTrade: any | null;
}

interface RecentTrade {
    id: string;
    tokenSymbol: string;
    tokenAddress: string;
    profitPct: number | null;
    percentSold: number;
    closedAt: number;
    holdMs: number;
    reason: string;
    tpLevel?: number;
}

interface ReportData {
    today: TodaySummary;
    daily: DayData[];
    allTime: AllTime;
    recentTrades: RecentTrade[];
    timestamp: number;
}

function holdTime(ms: number): string {
    if (ms < 60000)   return `${Math.round(ms / 1000)}d`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${(ms / 3600000).toFixed(1)}j`;
}

function timeAgo(ts: number): string {
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60)    return `${secs}d lalu`;
    if (secs < 3600)  return `${Math.floor(secs / 60)}m lalu`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}j lalu`;
    return new Date(ts).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

const REASON_ICON: Record<string, string> = {
    'take-profit': '🎯',
    'stop-loss':   '🛑',
    'manual':      '👆',
    'dca':         '📉',
};

// ── Win Rate Ring (SVG) ──────────────────────────────────────────────────────
const WinRateRing: React.FC<{ rate: number; size?: number }> = ({ rate, size = 64 }) => {
    const r    = (size - 8) / 2;
    const circ = 2 * Math.PI * r;
    const filled = (rate / 100) * circ;
    const color  = rate >= 60 ? '#22c55e' : rate >= 40 ? '#eab308' : '#ef4444';
    return (
        <svg width={size} height={size} className="rotate-[-90deg]">
            <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1f2937" strokeWidth={7} />
            <circle
                cx={size/2} cy={size/2} r={r}
                fill="none" stroke={color} strokeWidth={7}
                strokeDasharray={`${filled} ${circ}`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.6s ease' }}
            />
        </svg>
    );
};

// ── Bar Chart (SVG) ──────────────────────────────────────────────────────────
const BarChart: React.FC<{ daily: DayData[] }> = ({ daily }) => {
    const chartH = 80;
    const barW   = 14;
    const gap    = 4;
    const totalW = daily.length * (barW + gap);

    const maxAbs = Math.max(...daily.map(d => Math.abs(d.totalPnlPct)), 1);

    return (
        <div className="overflow-x-auto pb-1">
            <svg width={totalW} height={chartH + 24} style={{ minWidth: totalW }}>
                {/* Zero line */}
                <line x1={0} x2={totalW} y1={chartH / 2} y2={chartH / 2} stroke="#374151" strokeWidth={1} />
                {daily.map((d, i) => {
                    const x       = i * (barW + gap);
                    const pct     = d.totalPnlPct;
                    const barH    = (Math.abs(pct) / maxAbs) * (chartH / 2 - 4);
                    const isPos   = pct >= 0;
                    const y       = isPos ? chartH / 2 - barH : chartH / 2;
                    const color   = d.trades === 0 ? '#374151' : isPos ? '#22c55e' : '#ef4444';
                    const isToday = i === daily.length - 1;
                    return (
                        <g key={d.dateMs}>
                            <rect
                                x={x} y={y} width={barW} height={Math.max(barH, 1)}
                                fill={color}
                                opacity={d.trades === 0 ? 0.3 : isToday ? 1 : 0.75}
                                rx={2}
                            />
                            {/* Date label every 2 bars */}
                            {(i % 2 === 0 || isToday) && (
                                <text
                                    x={x + barW / 2} y={chartH + 14}
                                    textAnchor="middle"
                                    fontSize={8}
                                    fill={isToday ? '#a3e635' : '#6b7280'}
                                >
                                    {d.date.replace(/\s.+/, '')}
                                </text>
                            )}
                            {/* Value label for today or non-zero bars */}
                            {d.trades > 0 && (
                                <text
                                    x={x + barW / 2}
                                    y={isPos ? y - 2 : y + barH + 9}
                                    textAnchor="middle"
                                    fontSize={7}
                                    fill={isPos ? '#4ade80' : '#f87171'}
                                >
                                    {isPos ? '+' : ''}{pct.toFixed(0)}
                                </text>
                            )}
                        </g>
                    );
                })}
            </svg>
        </div>
    );
};

// ── Stat Card ────────────────────────────────────────────────────────────────
const StatCard: React.FC<{ label: string; value: string; sub?: string; color?: string }> = ({ label, value, sub, color }) => (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex flex-col gap-0.5">
        <p className="text-xs text-gray-500">{label}</p>
        <p className={`text-base font-bold ${color ?? 'text-white'}`}>{value}</p>
        {sub && <p className="text-xs text-gray-600">{sub}</p>}
    </div>
);

// ── Main Component ───────────────────────────────────────────────────────────
interface Props { apiUrl: string; }

const DailyReport: React.FC<Props> = ({ apiUrl }) => {
    const [data, setData]     = useState<ReportData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]   = useState('');
    const [lastFetch, setLastFetch] = useState(0);

    const load = useCallback(async () => {
        try {
            const res  = await authFetch(`${apiUrl}/api/report`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setData(await res.json());
            setError('');
            setLastFetch(Date.now());
        } catch (e: any) {
            setError(e.message || 'Gagal memuat laporan');
        } finally {
            setLoading(false);
        }
    }, [apiUrl]);

    useEffect(() => {
        load();
        const iv = setInterval(load, 30_000);
        return () => clearInterval(iv);
    }, [load]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-16">
                <svg className="animate-spin h-6 w-6 text-green-500" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="bg-red-900/30 border border-red-800 rounded-xl p-4 text-sm text-red-400">
                {error || 'Data tidak tersedia'}
            </div>
        );
    }

    const { today, daily, allTime, recentTrades } = data;
    const todayPnlColor = today.totalPnlPct > 0 ? 'text-green-400' : today.totalPnlPct < 0 ? 'text-red-400' : 'text-gray-400';

    return (
        <div className="space-y-4 pb-6">

            {/* ── Header ──────────────────────────────────────── */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-sm font-semibold text-gray-300">Laporan P&L</h2>
                    <p className="text-xs text-gray-600">{today.date}</p>
                </div>
                <button
                    onClick={load}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
                >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {lastFetch ? new Date(lastFetch).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                </button>
            </div>

            {/* ── ETH Balance banner ──────────────────────────── */}
            {today.ethBalance && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-lg">Ξ</span>
                        <div>
                            <p className="text-sm font-bold text-white">{parseFloat(today.ethBalance).toFixed(5)} ETH</p>
                            {today.ethUsd !== null && (
                                <p className="text-xs text-gray-500">${today.ethUsd.toFixed(2)} USD</p>
                            )}
                        </div>
                    </div>
                    <span className="text-xs text-gray-600">Saldo Wallet</span>
                </div>
            )}

            {/* ── Today KPI Cards ──────────────────────────────── */}
            <div className="grid grid-cols-2 gap-2">
                <StatCard
                    label="Total P&L Hari Ini"
                    value={`${today.totalPnlPct >= 0 ? '+' : ''}${today.totalPnlPct.toFixed(1)}%`}
                    sub={`${today.trades} trade`}
                    color={todayPnlColor}
                />
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex items-center gap-3">
                    <div className="relative">
                        <WinRateRing rate={today.winRate} size={52} />
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                            {today.winRate.toFixed(0)}%
                        </span>
                    </div>
                    <div>
                        <p className="text-xs text-gray-500">Win Rate Hari Ini</p>
                        <p className="text-sm font-bold text-white">{today.wins}W / {today.losses}L</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <StatCard
                    label="Terbaik Hari Ini"
                    value={today.bestPct !== null ? `+${today.bestPct.toFixed(1)}%` : '—'}
                    color="text-green-400"
                />
                <StatCard
                    label="Terburuk Hari Ini"
                    value={today.worstPct !== null ? `${today.worstPct.toFixed(1)}%` : '—'}
                    color="text-red-400"
                />
            </div>

            {/* ── 14-Day Bar Chart ─────────────────────────────── */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-gray-400">P&L per Hari (14 hari)</p>
                    <div className="flex items-center gap-3 text-xs text-gray-600">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500 inline-block" />Profit</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500 inline-block" />Rugi</span>
                    </div>
                </div>
                <BarChart daily={daily} />

                {/* Day summary table (compact) */}
                <div className="mt-3 space-y-1 max-h-36 overflow-y-auto">
                    {[...daily].reverse().filter(d => d.trades > 0).map(d => (
                        <div key={d.dateMs} className="flex items-center justify-between text-xs py-1 border-b border-gray-800/60 last:border-0">
                            <span className="text-gray-500 w-14 shrink-0">{d.date}</span>
                            <span className="text-gray-400">{d.trades} trade</span>
                            <span className="text-gray-400">{d.wins}W/{d.losses}L</span>
                            <span className={`font-medium w-16 text-right ${d.totalPnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {d.totalPnlPct >= 0 ? '+' : ''}{d.totalPnlPct.toFixed(1)}%
                            </span>
                        </div>
                    ))}
                    {daily.every(d => d.trades === 0) && (
                        <p className="text-center text-xs text-gray-600 py-3">Belum ada trade dalam 14 hari</p>
                    )}
                </div>
            </div>

            {/* ── All-time Stats ───────────────────────────────── */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-400 mb-3">Statistik Semua Waktu</p>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                    {[
                        { label: 'Total Trade',  value: allTime.total.toString() },
                        { label: 'Win Rate',     value: `${allTime.winRate.toFixed(1)}%`, color: allTime.winRate >= 50 ? 'text-green-400' : 'text-red-400' },
                        { label: 'Total Wins',   value: allTime.wins.toString(),   color: 'text-green-400' },
                        { label: 'Total Losses', value: allTime.losses.toString(), color: 'text-red-400'   },
                        { label: 'Kum. P&L',    value: `${allTime.totalPnlPct >= 0 ? '+' : ''}${allTime.totalPnlPct.toFixed(1)}%`, color: allTime.totalPnlPct >= 0 ? 'text-green-400' : 'text-red-400' },
                    ].map(({ label, value, color }) => (
                        <div key={label} className="flex justify-between">
                            <span className="text-gray-500">{label}</span>
                            <span className={`font-medium ${color ?? 'text-white'}`}>{value}</span>
                        </div>
                    ))}
                </div>
                {allTime.bestTrade && (
                    <div className="mt-3 pt-3 border-t border-gray-800 grid grid-cols-2 gap-y-1 text-xs">
                        <div className="flex justify-between">
                            <span className="text-gray-500">Trade Terbaik</span>
                            <span className="text-green-400 font-medium">+{(allTime.bestTrade.profitPct ?? 0).toFixed(1)}% ({allTime.bestTrade.tokenSymbol})</span>
                        </div>
                        {allTime.worstTrade && (
                            <div className="flex justify-between">
                                <span className="text-gray-500">Trade Terburuk</span>
                                <span className="text-red-400 font-medium">{(allTime.worstTrade.profitPct ?? 0).toFixed(1)}% ({allTime.worstTrade.tokenSymbol})</span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ── Recent Closed Trades ─────────────────────────── */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-400 mb-3">Trade Terbaru ({recentTrades.length})</p>
                {recentTrades.length === 0 ? (
                    <p className="text-center text-xs text-gray-600 py-3">Belum ada trade yang tercatat</p>
                ) : (
                    <div className="space-y-2">
                        {recentTrades.map((t) => {
                            const pnlColor = (t.profitPct ?? 0) > 0 ? 'text-green-400' : (t.profitPct ?? 0) < 0 ? 'text-red-400' : 'text-gray-400';
                            const icon = REASON_ICON[t.reason] ?? '⚡';
                            return (
                                <div key={t.id} className="flex items-center justify-between gap-2 py-2 border-b border-gray-800/60 last:border-0">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-sm shrink-0">{icon}</span>
                                        <div className="min-w-0">
                                            <p className="text-xs font-medium text-white truncate">
                                                {t.tokenSymbol}
                                                {t.reason === 'take-profit' && t.tpLevel ? ` TP${t.tpLevel}` : ''}
                                                {' '}<span className="text-gray-600 font-normal">({t.percentSold}%)</span>
                                            </p>
                                            <p className="text-xs text-gray-600">{timeAgo(t.closedAt)} · {holdTime(t.holdMs)}</p>
                                        </div>
                                    </div>
                                    <span className={`text-xs font-semibold shrink-0 ${pnlColor}`}>
                                        {t.profitPct !== null
                                            ? `${t.profitPct >= 0 ? '+' : ''}${t.profitPct.toFixed(1)}%`
                                            : '—'}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

        </div>
    );
};

export default DailyReport;
