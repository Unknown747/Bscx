import React, { useEffect, useState, useCallback, useRef } from 'react';
import { authFetch } from '../lib/authFetch';

interface SignalHistoryItem {
    id:           number;
    tokenAddr:    string;
    symbol:       string;
    signal:       string;
    scoreTotal:   number;
    liqUsd:       number;
    volH24:       number;
    priceChgH1:   number;
    buyTxH1:      number;
    ageMinutes:   number;
    dexUrl:       string;
    source:       string;
    discoveredAt: number;
}

interface ScoreBreakdown {
    momentum:  number;
    activity:  number;
    safety:    number;
    freshness: number;
    total:     number;
    reasons:   string[];
}

interface ScreenerSignal {
    id:             string;
    tokenAddress:   string;
    tokenSymbol:    string;
    tokenName:      string;
    pairAddress:    string;
    signal:         'STRONG_BUY' | 'BUY' | 'WATCH' | 'SKIP';
    score:          ScoreBreakdown;
    liquidityUsd:   number;
    volumeH24:      number;
    priceUsd:       string;
    priceChangeH1:  number;
    priceChangeH24: number;
    buyTxH1:        number;
    sellTxH1:       number;
    ageMinutes:     number;
    fdvUsd:         number;
    safetyFlags:    string[];
    sellTax:        number;
    buyTax:         number;
    holderCount:    number;
    creatorPct:     number;
    source:         'new_pool' | 'trending' | 'top_gainers';
    dexUrl:         string;
    basescanUrl:    string;
    discoveredAt:   number;
}

interface ScreenerStats {
    total:     number;
    strongBuy: number;
    buy:       number;
    watch:     number;
    scanCount: number;
}

interface SmartScreenerProps {
    apiUrl: string;
}

const SIGNAL_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
    STRONG_BUY: { bg: 'bg-emerald-950/60', border: 'border-emerald-600/50', text: 'text-emerald-400', badge: 'bg-emerald-600 text-white' },
    BUY:        { bg: 'bg-blue-950/60',    border: 'border-blue-600/50',    text: 'text-blue-400',    badge: 'bg-blue-600 text-white' },
    WATCH:      { bg: 'bg-yellow-950/40',  border: 'border-yellow-600/40',  text: 'text-yellow-400',  badge: 'bg-yellow-700 text-white' },
    SKIP:       { bg: 'bg-gray-900/40',    border: 'border-gray-700/40',    text: 'text-gray-500',    badge: 'bg-gray-700 text-gray-300' },
};

const SIGNAL_ICON: Record<string, string> = {
    STRONG_BUY: '🔥',
    BUY:        '📡',
    WATCH:      '👀',
    SKIP:       '⏭️',
};

function fmtAge(minutes: number): string {
    if (minutes < 60)  return `${minutes}m`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    return `${Math.floor(minutes / 1440)}d`;
}

function fmtUsd(n: number): string {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`;
    return `$${n.toFixed(0)}`;
}

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
    const pct = Math.round((value / max) * 100);
    return (
        <div className="flex items-center gap-1.5">
            <span className="text-gray-600 w-16 shrink-0" style={{ fontSize: '10px' }}>{label}</span>
            <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-gray-400 w-5 text-right" style={{ fontSize: '10px' }}>{value}</span>
        </div>
    );
}

const SmartScreener: React.FC<SmartScreenerProps> = ({ apiUrl }) => {
    const [signals,     setSignals]     = useState<ScreenerSignal[]>([]);
    const [stats,       setStats]       = useState<ScreenerStats | null>(null);
    const [enabled,     setEnabled]     = useState(false);
    const [loading,     setLoading]     = useState(false);
    const [toggling,    setToggling]    = useState(false);
    const [filter,      setFilter]      = useState<'ALL' | 'STRONG_BUY' | 'BUY' | 'WATCH'>('ALL');
    const [expanded,    setExpanded]    = useState<string | null>(null);
    const [lastRefresh, setLastRefresh] = useState('');
    const [view,        setView]        = useState<'live' | 'history'>('live');
    const [history,     setHistory]     = useState<SignalHistoryItem[]>([]);
    const [histFilter,  setHistFilter]  = useState<'ALL' | 'STRONG_BUY' | 'BUY' | 'WATCH'>('ALL');
    const [histLoading, setHistLoading] = useState(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetch = useCallback(async () => {
        setLoading(true);
        try {
            const minSig = filter === 'ALL' ? '' : `?minSignal=${filter}`;
            const [sigRes, statsRes] = await Promise.all([
                authFetch(`${apiUrl}/api/screener/signals${minSig}`),
                authFetch(`${apiUrl}/api/screener/stats`),
            ]);
            const sigData   = await sigRes.json();
            const statsData = await statsRes.json();
            setSignals(sigData.signals ?? []);
            setStats(statsData);
            setEnabled(sigData.enabled ?? false);
            setLastRefresh(new Date().toLocaleTimeString('id-ID'));
        } catch { /* silent */ } finally {
            setLoading(false);
        }
    }, [apiUrl, filter]);

    useEffect(() => {
        fetch();
        timerRef.current = setInterval(fetch, 15_000);
        return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }, [fetch]);

    const loadHistory = useCallback(async () => {
        setHistLoading(true);
        try {
            const sig = histFilter === 'ALL' ? '' : `?signal=${histFilter}`;
            const res  = await authFetch(`${apiUrl}/api/screener/history${sig}`);
            const data = await res.json();
            setHistory(data.signals ?? []);
        } catch { /* silent */ } finally {
            setHistLoading(false);
        }
    }, [apiUrl, histFilter]);

    useEffect(() => {
        if (view === 'history') loadHistory();
    }, [view, loadHistory]);

    const toggleScreener = async () => {
        setToggling(true);
        try {
            const res  = await authFetch(`${apiUrl}/api/screener/toggle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: !enabled }),
            });
            const data = await res.json();
            if (data.ok) { setEnabled(!enabled); await fetch(); }
        } finally { setToggling(false); }
    };

    const displayed = filter === 'ALL' ? signals : signals.filter(s => s.signal === filter);

    const HIST_SIGNAL_CFG: Record<string, { badge: string; icon: string }> = {
        STRONG_BUY: { badge: 'bg-emerald-900 text-emerald-300 border border-emerald-700', icon: '🔥' },
        BUY:        { badge: 'bg-blue-900 text-blue-300 border border-blue-700',           icon: '📡' },
        WATCH:      { badge: 'bg-yellow-900 text-yellow-300 border border-yellow-700',     icon: '👀' },
    };

    function fmtUsd2(n: number): string {
        if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
        if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
        return `$${n.toFixed(0)}`;
    }

    return (
        <div className="space-y-3">
            {/* ── Header ── */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <span className="text-lg">📡</span>
                        <div>
                            <h2 className="text-sm font-semibold text-white">Smart Screener</h2>
                            <p className="text-xs text-gray-500">Multi-signal token scanner for Base Network</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Live / History toggle */}
                        <div className="flex bg-gray-800 rounded-lg p-0.5">
                            {(['live', 'history'] as const).map(v => (
                                <button
                                    key={v}
                                    onClick={() => setView(v)}
                                    className={`text-xs px-2.5 py-1 rounded-md font-medium transition-all ${view === v ? 'bg-gray-700 text-white' : 'text-gray-500'}`}
                                >
                                    {v === 'live' ? '⚡ Live' : '🕐 Histori'}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={toggleScreener}
                            disabled={toggling}
                            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold border transition-all
                                ${enabled
                                    ? 'bg-emerald-900/60 border-emerald-700 text-emerald-300 hover:bg-emerald-900'
                                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}
                        >
                            <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`} />
                            {toggling ? '...' : enabled ? 'AKTIF' : 'NONAKTIF'}
                        </button>
                    </div>
                </div>

                {/* Stats row */}
                {stats && (
                    <div className="grid grid-cols-4 gap-2 text-center">
                        <div className="bg-gray-800 rounded-lg py-2 px-1">
                            <p className="text-xs text-gray-500">Total</p>
                            <p className="text-sm font-bold text-white">{stats.total}</p>
                        </div>
                        <div className="bg-emerald-900/40 rounded-lg py-2 px-1">
                            <p className="text-xs text-emerald-500">Strong</p>
                            <p className="text-sm font-bold text-emerald-400">{stats.strongBuy}</p>
                        </div>
                        <div className="bg-blue-900/40 rounded-lg py-2 px-1">
                            <p className="text-xs text-blue-500">Buy</p>
                            <p className="text-sm font-bold text-blue-400">{stats.buy}</p>
                        </div>
                        <div className="bg-gray-800 rounded-lg py-2 px-1">
                            <p className="text-xs text-gray-500">Scans</p>
                            <p className="text-sm font-bold text-white">{stats.scanCount}</p>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Live view: filter bar + signal cards ── */}
            {view === 'live' && (
            <>
            <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
                {(['ALL', 'STRONG_BUY', 'BUY', 'WATCH'] as const).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium border transition-all
                            ${filter === f
                                ? f === 'ALL'        ? 'bg-gray-700 border-gray-600 text-white'
                                : f === 'STRONG_BUY' ? 'bg-emerald-800 border-emerald-600 text-emerald-200'
                                : f === 'BUY'        ? 'bg-blue-800 border-blue-600 text-blue-200'
                                :                      'bg-yellow-900 border-yellow-700 text-yellow-200'
                                : 'bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300'}`}
                    >
                        {f === 'ALL' ? 'Semua' : f === 'STRONG_BUY' ? '🔥 Strong' : f === 'BUY' ? '📡 Buy' : '👀 Watch'}
                        {f !== 'ALL' && stats && (
                            <span className="ml-1 opacity-60">
                                ({f === 'STRONG_BUY' ? stats.strongBuy : f === 'BUY' ? stats.buy : stats.watch})
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* ── Signal cards ── */}
            {!enabled && signals.length === 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
                    <p className="text-2xl mb-2">📡</p>
                    <p className="text-sm text-gray-400 font-medium">Smart Screener Nonaktif</p>
                    <p className="text-xs text-gray-600 mt-1">Aktifkan untuk mulai scan token baru di Base Network</p>
                    <button
                        onClick={toggleScreener}
                        disabled={toggling}
                        className="mt-3 text-xs bg-emerald-700 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
                    >
                        Aktifkan Screener
                    </button>
                </div>
            )}

            {enabled && displayed.length === 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
                    <p className="text-lg mb-2">{loading ? '⏳' : '🔍'}</p>
                    <p className="text-sm text-gray-400">{loading ? 'Scanning...' : 'Belum ada sinyal ditemukan'}</p>
                    <p className="text-xs text-gray-600 mt-1">Screener akan scan pool baru setiap 20 detik</p>
                </div>
            )}

            <div className="space-y-2">
                {displayed.map(sig => {
                    const c        = SIGNAL_COLORS[sig.signal];
                    const isOpen   = expanded === sig.id;
                    const bsr      = sig.buyTxH1 / Math.max(sig.sellTxH1, 1);

                    return (
                        <div
                            key={sig.id}
                            className={`${c.bg} border ${c.border} rounded-xl transition-all`}
                        >
                            <button
                                className="w-full px-4 py-3 text-left"
                                onClick={() => setExpanded(isOpen ? null : sig.id)}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${c.badge}`}>
                                                {SIGNAL_ICON[sig.signal]} {sig.signal.replace('_', ' ')}
                                            </span>
                                            <span className="text-white font-bold text-sm">{sig.tokenSymbol}</span>
                                            <span className="text-gray-600 text-xs">{sig.source === 'new_pool' ? '🆕' : '📈'}</span>
                                        </div>
                                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                            <span className="text-gray-400 text-xs">💧 {fmtUsd(sig.liquidityUsd)}</span>
                                            <span className="text-gray-400 text-xs">📊 {fmtUsd(sig.volumeH24)}/24h</span>
                                            <span className={`text-xs font-medium ${sig.priceChangeH1 >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {sig.priceChangeH1 >= 0 ? '+' : ''}{sig.priceChangeH1.toFixed(1)}% 1h
                                            </span>
                                            <span className="text-gray-500 text-xs">⏱️ {fmtAge(sig.ageMinutes)}</span>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <div className={`text-lg font-bold ${c.text}`}>{sig.score.total}</div>
                                        <div className="text-gray-600 text-xs">/100</div>
                                    </div>
                                </div>
                            </button>

                            {/* Expanded detail */}
                            {isOpen && (
                                <div className="px-4 pb-4 border-t border-gray-800/60 pt-3 space-y-3">
                                    {/* Score breakdown */}
                                    <div className="space-y-1.5">
                                        <p className="text-xs text-gray-500 font-medium mb-1">Score Breakdown</p>
                                        <ScoreBar label="Momentum" value={sig.score.momentum} max={30} color="bg-orange-500" />
                                        <ScoreBar label="Activity"  value={sig.score.activity}  max={25} color="bg-blue-500" />
                                        <ScoreBar label="Safety"    value={sig.score.safety}    max={25} color="bg-emerald-500" />
                                        <ScoreBar label="Freshness" value={sig.score.freshness} max={20} color="bg-purple-500" />
                                    </div>

                                    {/* Reasons */}
                                    {sig.score.reasons.length > 0 && (
                                        <div className="flex flex-wrap gap-1">
                                            {sig.score.reasons.map((r, i) => (
                                                <span key={i} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">{r}</span>
                                            ))}
                                        </div>
                                    )}

                                    {/* Token metrics */}
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                                        {[
                                            { label: 'Buy Tx 1h',    value: `${sig.buyTxH1}` },
                                            { label: 'Sell Tx 1h',   value: `${sig.sellTxH1}` },
                                            { label: 'BSR',           value: `${bsr.toFixed(1)}x` },
                                            { label: '24h Change',    value: `${sig.priceChangeH24 >= 0 ? '+' : ''}${sig.priceChangeH24.toFixed(1)}%` },
                                            { label: 'Sell Tax',      value: sig.sellTax > 0 ? `${sig.sellTax}%` : '✓ 0%' },
                                            { label: 'Buy Tax',       value: sig.buyTax  > 0 ? `${sig.buyTax}%`  : '✓ 0%' },
                                            { label: 'Holders',       value: sig.holderCount > 0 ? `${sig.holderCount}` : '?' },
                                            { label: 'Creator %',     value: sig.creatorPct > 0 ? `${sig.creatorPct.toFixed(1)}%` : '?' },
                                        ].map(({ label, value }) => (
                                            <div key={label} className="flex justify-between">
                                                <span className="text-gray-600" style={{ fontSize: '11px' }}>{label}</span>
                                                <span className="text-gray-300 font-medium" style={{ fontSize: '11px' }}>{value}</span>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Safety flags */}
                                    {sig.safetyFlags.length > 0 && (
                                        <div>
                                            <p className="text-xs text-gray-500 mb-1">Safety Flags</p>
                                            <div className="flex flex-wrap gap-1">
                                                {sig.safetyFlags.map((f, i) => (
                                                    <span key={i} className="text-xs bg-yellow-900/50 text-yellow-400 border border-yellow-800/40 px-2 py-0.5 rounded-full">{f}</span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Token address */}
                                    <div>
                                        <p className="text-xs text-gray-600 mb-1">Token Address</p>
                                        <p className="text-xs text-gray-400 font-mono break-all">{sig.tokenAddress}</p>
                                    </div>

                                    {/* Action links */}
                                    <div className="flex gap-2 pt-1">
                                        <a
                                            href={sig.dexUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="flex-1 text-center text-xs bg-purple-900/60 hover:bg-purple-800/60 border border-purple-700/50 text-purple-300 py-2 rounded-lg transition-colors font-medium"
                                        >
                                            📊 GeckoTerminal
                                        </a>
                                        <a
                                            href={sig.basescanUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="flex-1 text-center text-xs bg-blue-900/60 hover:bg-blue-800/60 border border-blue-700/50 text-blue-300 py-2 rounded-lg transition-colors font-medium"
                                        >
                                            🔍 Basescan
                                        </a>
                                    </div>

                                    <p className="text-center text-gray-700 text-xs">
                                        Ditemukan: {new Date(sig.discoveredAt).toLocaleTimeString('id-ID')}
                                    </p>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {lastRefresh && (
                <p className="text-center text-xs text-gray-700">Auto-refresh: {lastRefresh}</p>
            )}
            </>
            )}

            {/* ── History panel ── */}
            {view === 'history' && (
                <div className="space-y-3 mt-1">
                    {/* History filter bar */}
                    <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
                        {(['ALL', 'STRONG_BUY', 'BUY', 'WATCH'] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => setHistFilter(f)}
                                className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium border transition-all
                                    ${histFilter === f
                                        ? f === 'ALL'        ? 'bg-gray-700 border-gray-600 text-white'
                                        : f === 'STRONG_BUY' ? 'bg-emerald-800 border-emerald-600 text-emerald-200'
                                        : f === 'BUY'        ? 'bg-blue-800 border-blue-600 text-blue-200'
                                        :                      'bg-yellow-900 border-yellow-700 text-yellow-200'
                                        : 'bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300'}`}
                            >
                                {f === 'ALL' ? 'Semua' : f === 'STRONG_BUY' ? '🔥 Strong' : f === 'BUY' ? '📡 Buy' : '👀 Watch'}
                            </button>
                        ))}
                    </div>

                    {histLoading && (
                        <div className="text-center py-8">
                            <div className="inline-block w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-2" />
                            <p className="text-xs text-gray-500">Memuat histori…</p>
                        </div>
                    )}

                    {!histLoading && history.length === 0 && (
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
                            <p className="text-2xl mb-2">🕐</p>
                            <p className="text-sm text-gray-400">Belum ada histori sinyal</p>
                            <p className="text-xs text-gray-600 mt-1">Histori diisi otomatis saat screener menemukan sinyal BUY/WATCH</p>
                        </div>
                    )}

                    {!histLoading && history.length > 0 && (
                        <div className="space-y-2">
                            {history.map(h => {
                                const cfg = HIST_SIGNAL_CFG[h.signal] ?? { badge: 'bg-gray-800 text-gray-300 border border-gray-700', icon: '❓' };
                                return (
                                    <div key={h.id} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>
                                                        {cfg.icon} {h.signal.replace('_', ' ')}
                                                    </span>
                                                    <span className="text-white font-bold text-sm">{h.symbol}</span>
                                                </div>
                                                <div className="flex items-center gap-3 text-xs text-gray-600 flex-wrap">
                                                    <span>💧 {fmtUsd2(h.liqUsd)}</span>
                                                    <span>📊 {fmtUsd2(h.volH24)}/24h</span>
                                                    <span className={h.priceChgH1 >= 0 ? 'text-emerald-500' : 'text-red-500'}>
                                                        {h.priceChgH1 >= 0 ? '+' : ''}{h.priceChgH1.toFixed(1)}% 1h
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-sm font-bold text-white">{h.scoreTotal}<span className="text-gray-600 text-xs font-normal">/100</span></p>
                                                <p className="text-xs text-gray-600">{new Date(h.discoveredAt).toLocaleTimeString('id-ID')}</p>
                                                <p className="text-xs text-gray-700">{new Date(h.discoveredAt).toLocaleDateString('id-ID')}</p>
                                            </div>
                                        </div>
                                        {h.dexUrl && (
                                            <a
                                                href={h.dexUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="mt-2 inline-block text-xs text-blue-500 hover:text-blue-400"
                                            >
                                                GeckoTerminal ↗
                                            </a>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {!histLoading && history.length > 0 && (
                        <p className="text-center text-xs text-gray-700">
                            {history.length} sinyal tersimpan · max 500 · disimpan otomatis
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

export default SmartScreener;
