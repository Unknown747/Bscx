import React, { useState, useEffect, useCallback, useRef } from 'react';
import { authFetch } from '../lib/authFetch';
import TokenSafetyBadge from './TokenSafetyBadge';

interface MonitoredWallet {
    address:        string;
    name:           string;
    monitoredSince: number;
    tradesObserved: number;
    winsObserved:   number;
    lossesObserved: number;
    totalPnlPct:    number;
    tradesPerDay:   number;
    lastTradeMs:    number;
    aiVerdict:      'pending' | 'approved' | 'rejected';
    aiReason?:      string;
    aiScore?:       number;
    dataSource?:    'basescan' | 'gecko';
}

interface EvalBreakdown {
    label:     string;
    pass:      boolean | null;
    value:     string;
    threshold: string;
}

interface RecentTrade {
    txHash:       string;
    direction:    'buy' | 'sell';
    tokenAddress: string;
    tokenSymbol:  string;
    tokenIcon:    string;
    amountFmt:    string;
    timestampMs:  number;
    explorerUrl:  string;
}

interface WalletMonitorPageProps {
    apiUrl:  string;
    onClose: () => void;
}

function winRateColor(wr: number, total: number) {
    if (total === 0) return 'text-gray-500';
    if (wr >= 55)   return 'text-green-400';
    if (wr >= 40)   return 'text-yellow-400';
    return 'text-red-400';
}
function pnlColor(pnl: number, hasPairs: boolean) {
    if (!hasPairs) return 'text-gray-500';
    return pnl >= 0 ? 'text-green-400' : 'text-red-400';
}
function fmtDuration(ms: number) {
    const totalMs = Date.now() - ms;
    const h = Math.floor(totalMs / 3_600_000);
    if (h < 24) return `${h}j`;
    return `${Math.floor(h / 24)}h ${h % 24}j`;
}
function fmtTime(ms: number) {
    if (ms === 0) return 'Belum ada';
    const diff = Date.now() - ms;
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} mnt lalu`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}j lalu`;
    return `${Math.floor(diff / 86_400_000)}h lalu`;
}
function dataScore(w: MonitoredWallet): number {
    const pairs     = w.winsObserved + w.lossesObserved;
    const daysScore = Math.min(40, ((Date.now() - w.monitoredSince) / 86_400_000) * 20);
    const pairsScore = Math.min(40, pairs * 13);
    const actScore   = Math.min(20, w.tradesPerDay * 10);
    return Math.round(Math.min(100, daysScore + pairsScore + actScore));
}

const WalletMonitorPage: React.FC<WalletMonitorPageProps> = ({ apiUrl, onClose }) => {
    const [wallets, setWallets]           = useState<MonitoredWallet[]>([]);
    const [loading, setLoading]           = useState(true);
    const [evaluating, setEvaluating]     = useState<string | null>(null);
    const [promoting, setPromoting]       = useState<string | null>(null);
    const [forcePromo, setForcePromo]     = useState<string | null>(null);
    const [removing, setRemoving]         = useState<string | null>(null);
    const [rescanning, setRescanning]     = useState<string | null>(null);
    const [expanded, setExpanded]         = useState<Record<string, boolean>>({});
    const [breakdowns, setBreakdowns]     = useState<Record<string, EvalBreakdown[]>>({});
    const [feedbackMsg, setFeedbackMsg]   = useState<{ addr: string; msg: string; ok: boolean } | null>(null);
    const [tokenInputs, setTokenInputs]   = useState<Record<string, string>>({});
    const [checkedTokens, setCheckedTokens] = useState<Record<string, string>>({});
    const [basescanEnabled, setBasescanEnabled] = useState<boolean | null>(null);
    const [feedOpen, setFeedOpen]               = useState<Record<string, boolean>>({});
    const [feedTrades, setFeedTrades]           = useState<Record<string, RecentTrade[]>>({});
    const [feedLoading, setFeedLoading]         = useState<Record<string, boolean>>({});
    const feedTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

    const fetchWallets = useCallback(async () => {
        try {
            const res  = await authFetch(`${apiUrl}/api/whale/monitored`);
            const data = await res.json();
            setWallets(data.wallets || []);
        } catch { }
        setLoading(false);
    }, [apiUrl]);

    const fetchMonitorStatus = useCallback(async () => {
        try {
            const res  = await authFetch(`${apiUrl}/api/whale/monitor-status`);
            const data = await res.json();
            setBasescanEnabled(!!data.basescanEnabled);
        } catch { }
    }, [apiUrl]);

    const fetchFeedTrades = useCallback(async (address: string, silent = false) => {
        if (!silent) setFeedLoading(prev => ({ ...prev, [address]: true }));
        try {
            const res  = await authFetch(`${apiUrl}/api/whale/blockscout/${address}/trades?limit=10`);
            const data = await res.json();
            if (data.ok) setFeedTrades(prev => ({ ...prev, [address]: data.trades || [] }));
        } catch { }
        setFeedLoading(prev => ({ ...prev, [address]: false }));
    }, [apiUrl]);

    const toggleFeed = useCallback((address: string) => {
        setFeedOpen(prev => {
            const next = !prev[address];
            if (next) {
                fetchFeedTrades(address);
                // Auto-refresh every 30s while open
                feedTimers.current[address] = setInterval(() => fetchFeedTrades(address, true), 30_000);
            } else {
                clearInterval(feedTimers.current[address]);
                delete feedTimers.current[address];
            }
            return { ...prev, [address]: next };
        });
    }, [fetchFeedTrades]);

    // Cleanup timers on unmount
    useEffect(() => {
        const timers = feedTimers.current;
        return () => { Object.values(timers).forEach(clearInterval); };
    }, []);

    useEffect(() => { fetchWallets(); fetchMonitorStatus(); }, [fetchWallets, fetchMonitorStatus]);
    useEffect(() => {
        const t = setInterval(fetchWallets, 15_000);
        return () => clearInterval(t);
    }, [fetchWallets]);

    const showFeedback = (addr: string, msg: string, ok: boolean) => {
        setFeedbackMsg({ addr, msg, ok });
        setTimeout(() => setFeedbackMsg(null), 6000);
    };

    const handleRescan = async (address: string) => {
        setRescanning(address);
        try {
            const res  = await authFetch(`${apiUrl}/api/whale/rescan/${address}`, { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                showFeedback(address, `🔗 Rescan Blockscout selesai — data diperbarui dari blockchain Base`, true);
                await fetchWallets();
            } else {
                showFeedback(address, data.error || 'Rescan gagal', false);
            }
        } catch { showFeedback(address, 'Gagal menghubungi server', false); }
        setRescanning(null);
    };

    const handleEvaluate = async (address: string) => {
        setEvaluating(address);
        try {
            const res  = await authFetch(`${apiUrl}/api/whale/evaluate/${address}`, { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                if (data.breakdown) {
                    setBreakdowns(prev => ({ ...prev, [address]: data.breakdown }));
                    setExpanded(prev => ({ ...prev, [address]: true }));
                }
                if (data.verdict === 'pending') {
                    showFeedback(address, `⏳ Data belum cukup — ${data.reason?.split('\n')[0]}`, false);
                } else {
                    showFeedback(address,
                        `AI: ${data.verdict === 'approved' ? '✅ Disetujui' : '❌ Ditolak'}${data.score ? ` (skor ${data.score}/100)` : ''} — ${data.reason?.split('\n')[0]}`,
                        data.verdict === 'approved'
                    );
                }
                await fetchWallets();
            } else {
                showFeedback(address, data.error || 'Evaluasi gagal', false);
            }
        } catch { showFeedback(address, 'Gagal menghubungi server', false); }
        setEvaluating(null);
    };

    const handlePromote = async (address: string) => {
        setPromoting(address);
        try {
            const res  = await authFetch(`${apiUrl}/api/whale/promote/${address}`, { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                showFeedback(address, '🚀 Wallet berhasil dipromosikan ke Copy!', true);
                await fetchWallets();
            } else {
                showFeedback(address, data.error || 'Gagal mempromosikan', false);
            }
        } catch { showFeedback(address, 'Gagal menghubungi server', false); }
        setPromoting(null);
    };

    const handleForcePromote = async (address: string, name: string) => {
        if (!confirm(
            `⚠️ Paksa Promosikan "${name}"?\n\n` +
            `Wallet ini akan langsung masuk copy list meskipun AI belum setuju atau data masih kurang.\n` +
            `Lanjutkan?`
        )) return;
        setForcePromo(address);
        try {
            const res  = await authFetch(`${apiUrl}/api/whale/force-promote/${address}`, { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                showFeedback(address, '🚀 Wallet dipromosikan secara manual!', true);
                await fetchWallets();
            } else {
                showFeedback(address, data.error || 'Gagal', false);
            }
        } catch { showFeedback(address, 'Gagal menghubungi server', false); }
        setForcePromo(null);
    };

    const handleRemove = async (address: string, name: string) => {
        if (!confirm(`Hapus "${name}" dari monitoring?`)) return;
        setRemoving(address);
        try {
            const res = await authFetch(`${apiUrl}/api/whale/monitored/${address}`, { method: 'DELETE' });
            if (res.ok) await fetchWallets();
        } catch { }
        setRemoving(null);
    };

    const pendingCount  = wallets.filter(w => w.aiVerdict === 'pending').length;
    const approvedCount = wallets.filter(w => w.aiVerdict === 'approved').length;
    const rejectedCount = wallets.filter(w => w.aiVerdict === 'rejected').length;

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-xl max-h-[92vh] flex flex-col shadow-2xl">

                {/* ── Header ── */}
                <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-2xl">
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-lg font-bold text-white">🔬 Monitoring Whale</h2>
                            {basescanEnabled === true && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/50 border border-blue-700/60 text-blue-300 font-semibold">
                                    🔗 Blockscout On-Chain
                                </span>
                            )}
                            {basescanEnabled === false && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-500">
                                    🦎 GeckoTerminal
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {wallets.length} wallet dimonitor
                            {approvedCount > 0 && <span className="ml-2 text-green-400">· {approvedCount} siap copy</span>}
                            {pendingCount  > 0 && <span className="ml-2 text-yellow-400">· {pendingCount} menunggu</span>}
                            {rejectedCount > 0 && <span className="ml-2 text-red-400">· {rejectedCount} ditolak</span>}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none transition-colors">&times;</button>
                </div>

                {/* ── Info banner ── */}
                <div className={`mx-5 mt-4 rounded-xl p-3 border ${basescanEnabled ? 'bg-blue-900/20 border-blue-800/40' : 'bg-gray-800/40 border-gray-700/50'}`}>
                    <div className="flex gap-2.5">
                        <span className="text-lg flex-shrink-0">{basescanEnabled ? '🔗' : '🤖'}</span>
                        <div className="text-xs leading-relaxed space-y-0.5">
                            {basescanEnabled ? (
                                <>
                                    <p className="text-blue-200 font-semibold">Blockscout aktif — data langsung dari blockchain Base</p>
                                    <p className="text-blue-300"><span className="text-white font-semibold">Tahap 1:</span> Kandidat disetujui → masuk Monitoring</p>
                                    <p className="text-blue-300"><span className="text-white font-semibold">Tahap 2:</span> Semua ERC-20 tx on-chain dibaca tiap 10 menit via Blockscout</p>
                                    <p className="text-blue-300"><span className="text-white font-semibold">Tahap 3:</span> Klik "Evaluasi AI" → lihat alasan → promosikan ke Copy</p>
                                    <p className="text-green-400/80 pt-0.5">✅ Data lengkap & akurat: riwayat swap, realized PnL, frekuensi trading</p>
                                </>
                            ) : (
                                <>
                                    <p className="text-yellow-300 font-semibold">Mode GeckoTerminal — hanya mencakup pool trending</p>
                                    <p className="text-gray-300"><span className="text-white font-semibold">Tahap 1:</span> Kandidat disetujui → masuk Monitoring</p>
                                    <p className="text-gray-300"><span className="text-white font-semibold">Tahap 2:</span> Bot kumpulkan data: trade, win/loss, PnL (setiap 10 menit)</p>
                                    <p className="text-gray-300"><span className="text-white font-semibold">Tahap 3:</span> Klik "Evaluasi AI" → lihat alasan → promosikan ke Copy</p>
                                    <p className="text-blue-400/80 pt-0.5">ℹ️ Migrasi ke Blockscout sedang berlangsung secara otomatis</p>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── Wallet list ── */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    {loading ? (
                        <div className="text-center py-12 text-gray-600 text-sm">Memuat...</div>
                    ) : wallets.length === 0 ? (
                        <div className="text-center py-12 space-y-2">
                            <p className="text-4xl">🔬</p>
                            <p className="text-gray-400 font-medium">Belum ada wallet dimonitor</p>
                            <p className="text-gray-600 text-xs">Buka Whale Manager → Auto Finder → klik "Setujui untuk Monitor"</p>
                        </div>
                    ) : wallets.map(w => {
                        const totalPairs = w.winsObserved + w.lossesObserved;
                        const winRate    = totalPairs > 0 ? Math.round((w.winsObserved / totalPairs) * 100) : 0;
                        const dScore     = dataScore(w);
                        const fb         = feedbackMsg?.addr === w.address ? feedbackMsg : null;
                        const isEval     = evaluating  === w.address;
                        const isPromote  = promoting   === w.address;
                        const isFP       = forcePromo  === w.address;
                        const isRemove   = removing    === w.address;
                        const isRescan   = rescanning  === w.address;
                        const isExpanded = expanded[w.address] ?? false;
                        const bd         = breakdowns[w.address];

                        const borderColor =
                            w.aiVerdict === 'approved' ? 'border-green-700/70 bg-green-950/20' :
                            w.aiVerdict === 'rejected' ? 'border-orange-900/50 bg-orange-950/10' :
                            'border-gray-700 bg-gray-800/40';

                        return (
                            <div key={w.address} className={`border rounded-xl p-4 transition-all ${borderColor}`}>

                                {/* ── Top row ── */}
                                <div className="flex items-start justify-between gap-2 mb-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-white truncate">{w.name}</p>
                                        <p className="text-xs text-gray-500 font-mono">{w.address.slice(0, 14)}…{w.address.slice(-6)}</p>
                                    </div>
                                    <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold whitespace-nowrap flex-shrink-0 ${
                                        w.aiVerdict === 'approved'
                                            ? 'bg-green-900/40 text-green-400 border-green-700'
                                            : w.aiVerdict === 'rejected'
                                            ? 'bg-orange-900/30 text-orange-400 border-orange-800'
                                            : 'bg-yellow-900/20 text-yellow-400 border-yellow-800'
                                    }`}>
                                        {w.aiVerdict === 'approved' ? '✅ AI Setujui' :
                                         w.aiVerdict === 'rejected' ? '⚠️ AI Tolak' : '⏳ Belum Dievaluasi'}
                                    </span>
                                </div>

                                {/* ── Data Sufficiency Bar ── */}
                                <div className="mb-3">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs text-gray-500">Kecukupan data monitoring</span>
                                        <span className={`text-xs font-bold ${dScore >= 60 ? 'text-green-400' : dScore >= 30 ? 'text-yellow-400' : 'text-red-400'}`}>
                                            {dScore}%
                                        </span>
                                    </div>
                                    <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all ${dScore >= 60 ? 'bg-green-500' : dScore >= 30 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                            style={{ width: `${dScore}%` }}
                                        />
                                    </div>
                                    {dScore < 40 && (
                                        <p className="text-xs text-yellow-500/80 mt-1">
                                            ⚠️ Data masih kurang — bot perlu lebih banyak waktu mengamati trade wallet ini
                                        </p>
                                    )}
                                </div>

                                {/* ── Stats grid ── */}
                                <div className="grid grid-cols-4 gap-2 mb-3">
                                    <div className="text-center bg-gray-900/60 rounded-lg py-2">
                                        <p className="text-xs text-gray-500 mb-0.5">Dimonitor</p>
                                        <p className="text-sm font-bold text-white">{fmtDuration(w.monitoredSince)}</p>
                                    </div>
                                    <div className="text-center bg-gray-900/60 rounded-lg py-2">
                                        <p className="text-xs text-gray-500 mb-0.5">Trade</p>
                                        <p className="text-sm font-bold text-white">{w.tradesObserved}</p>
                                    </div>
                                    <div className="text-center bg-gray-900/60 rounded-lg py-2">
                                        <p className="text-xs text-gray-500 mb-0.5">Win Rate</p>
                                        <p className={`text-sm font-bold ${winRateColor(winRate, totalPairs)}`}>
                                            {totalPairs > 0 ? `${winRate}%` : '—'}
                                        </p>
                                    </div>
                                    <div className="text-center bg-gray-900/60 rounded-lg py-2">
                                        <p className="text-xs text-gray-500 mb-0.5">PnL</p>
                                        <p className={`text-sm font-bold ${pnlColor(w.totalPnlPct, totalPairs > 0)}`}>
                                            {totalPairs > 0 ? `${w.totalPnlPct >= 0 ? '+' : ''}${w.totalPnlPct.toFixed(1)}%` : '—'}
                                        </p>
                                    </div>
                                </div>

                                {/* ── Secondary stats ── */}
                                <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 mb-3">
                                    <span>📊 {w.winsObserved}W / {w.lossesObserved}L</span>
                                    <span>⚡ {w.tradesPerDay > 0 ? `${w.tradesPerDay} trade/hari` : 'Belum ada aktivitas'}</span>
                                    <span>🕐 {fmtTime(w.lastTradeMs)}</span>
                                </div>

                                {/* ── Live TX Feed (Blockscout) ── */}
                                {(() => {
                                    const isFeedOpen   = feedOpen[w.address] ?? false;
                                    const isFeedLoad   = feedLoading[w.address] ?? false;
                                    const trades       = feedTrades[w.address] ?? [];
                                    return (
                                        <div className="mb-3">
                                            <button
                                                onClick={() => toggleFeed(w.address)}
                                                className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-gray-900/70 border border-gray-700/60 hover:border-blue-700/50 hover:bg-gray-900 transition-all text-xs text-gray-400 hover:text-blue-300"
                                            >
                                                <span className="flex items-center gap-1.5 font-semibold">
                                                    <span>🔗</span>
                                                    <span>Feed Transaksi On-Chain</span>
                                                    {isFeedLoad && (
                                                        <svg className="animate-spin h-3 w-3 text-blue-400" viewBox="0 0 24 24" fill="none">
                                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                                                        </svg>
                                                    )}
                                                </span>
                                                <span className="text-gray-600">{isFeedOpen ? '▲' : '▼'}</span>
                                            </button>

                                            {isFeedOpen && (
                                                <div className="mt-1.5 rounded-xl border border-gray-700/60 bg-gray-950/60 overflow-hidden">
                                                    {isFeedLoad && trades.length === 0 ? (
                                                        <div className="py-6 text-center text-xs text-gray-600">
                                                            Memuat transaksi dari Blockscout…
                                                        </div>
                                                    ) : trades.length === 0 ? (
                                                        <div className="py-6 text-center space-y-1">
                                                            <p className="text-gray-600 text-xs">Belum ada transaksi ERC-20 ditemukan</p>
                                                            <p className="text-gray-700 text-xs">Wallet mungkin belum aktif baru-baru ini</p>
                                                        </div>
                                                    ) : (
                                                        <div>
                                                            {/* Header */}
                                                            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800/80">
                                                                <span className="text-xs text-gray-500 font-semibold">10 Transaksi Terbaru</span>
                                                                <span className="text-xs text-gray-600">auto-refresh 30d</span>
                                                            </div>
                                                            {/* Trade rows */}
                                                            <div className="divide-y divide-gray-800/50">
                                                                {trades.map((t, i) => {
                                                                    const isBuy  = t.direction === 'buy';
                                                                    const tsAgo  = (() => {
                                                                        const d = Date.now() - t.timestampMs;
                                                                        if (d < 60_000)        return `${Math.floor(d / 1000)}d lalu`;
                                                                        if (d < 3_600_000)     return `${Math.floor(d / 60_000)} mnt lalu`;
                                                                        if (d < 86_400_000)    return `${Math.floor(d / 3_600_000)}j lalu`;
                                                                        return `${Math.floor(d / 86_400_000)}h lalu`;
                                                                    })();
                                                                    return (
                                                                        <a
                                                                            key={i}
                                                                            href={t.explorerUrl}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-800/40 transition-colors group"
                                                                        >
                                                                            {/* Direction badge */}
                                                                            <span className={`flex-shrink-0 text-xs font-bold px-1.5 py-0.5 rounded font-mono ${
                                                                                isBuy
                                                                                    ? 'bg-green-900/50 text-green-400 border border-green-800/60'
                                                                                    : 'bg-red-900/40 text-red-400 border border-red-900/60'
                                                                            }`}>
                                                                                {isBuy ? 'BUY' : 'SELL'}
                                                                            </span>

                                                                            {/* Token icon + symbol */}
                                                                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                                                                {t.tokenIcon ? (
                                                                                    <img
                                                                                        src={t.tokenIcon}
                                                                                        alt=""
                                                                                        className="w-4 h-4 rounded-full flex-shrink-0 bg-gray-700"
                                                                                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                                                                    />
                                                                                ) : (
                                                                                    <span className="w-4 h-4 rounded-full bg-gray-700 flex-shrink-0 text-gray-500 text-center leading-4 text-xs">?</span>
                                                                                )}
                                                                                <span className="text-xs font-semibold text-white truncate">{t.tokenSymbol}</span>
                                                                                <span className={`text-xs font-mono ${isBuy ? 'text-green-400' : 'text-red-400'}`}>
                                                                                    {isBuy ? '+' : '-'}{t.amountFmt}
                                                                                </span>
                                                                            </div>

                                                                            {/* Time + link arrow */}
                                                                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                                                                <span className="text-xs text-gray-600">{tsAgo}</span>
                                                                                <span className="text-gray-700 group-hover:text-blue-400 transition-colors text-xs">↗</span>
                                                                            </div>
                                                                        </a>
                                                                    );
                                                                })}
                                                            </div>
                                                            {/* Footer - link to full history */}
                                                            <div className="px-3 py-2 border-t border-gray-800/80">
                                                                <a
                                                                    href={`https://basescan.org/address/${w.address}#tokentxns`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-xs text-blue-400/70 hover:text-blue-300 transition-colors"
                                                                >
                                                                    Lihat semua transaksi di Basescan ↗
                                                                </a>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                {/* ── AI Reason (collapsed toggle) ── */}
                                {w.aiReason && (
                                    <div className="mb-3">
                                        <button
                                            onClick={() => setExpanded(prev => ({ ...prev, [w.address]: !prev[w.address] }))}
                                            className={`w-full text-left rounded-lg px-3 py-2 text-xs transition-all border ${
                                                w.aiVerdict === 'approved'
                                                    ? 'bg-green-900/20 border-green-800/40 text-green-300 hover:bg-green-900/30'
                                                    : w.aiVerdict === 'rejected'
                                                    ? 'bg-orange-900/15 border-orange-900/40 text-orange-300 hover:bg-orange-900/20'
                                                    : 'bg-blue-900/15 border-blue-900/40 text-blue-300 hover:bg-blue-900/20'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="font-semibold">
                                                    {w.aiScore !== undefined && w.aiVerdict !== 'pending'
                                                        ? `🤖 Skor AI: ${w.aiScore}/100 — `
                                                        : '🤖 '}
                                                    {w.aiReason.split('\n')[0]}
                                                </span>
                                                <span className="ml-2 flex-shrink-0">{isExpanded ? '▲' : '▼'}</span>
                                            </div>
                                        </button>

                                        {isExpanded && (
                                            <div className="mt-2 space-y-2">
                                                {/* Full reason text */}
                                                {w.aiReason.split('\n').length > 1 && (
                                                    <div className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                                                        w.aiVerdict === 'approved'
                                                            ? 'bg-green-900/10 text-green-300/80'
                                                            : w.aiVerdict === 'rejected'
                                                            ? 'bg-orange-900/10 text-orange-300/80'
                                                            : 'bg-blue-900/10 text-blue-300/80'
                                                    }`}>
                                                        {w.aiReason.split('\n').slice(1).join('\n')}
                                                    </div>
                                                )}

                                                {/* Breakdown checklist */}
                                                {bd && bd.length > 0 && (
                                                    <div className="bg-gray-800/60 border border-gray-700/60 rounded-lg px-3 py-2 space-y-1.5">
                                                        <p className="text-xs font-semibold text-gray-400 mb-2">📋 Detail Kriteria Evaluasi</p>
                                                        {bd.map((c, i) => (
                                                            <div key={i} className="flex items-center justify-between gap-2">
                                                                <div className="flex items-center gap-1.5 min-w-0">
                                                                    <span className="flex-shrink-0 text-sm">
                                                                        {c.pass === true ? '✅' : c.pass === false ? '❌' : '⏳'}
                                                                    </span>
                                                                    <span className="text-xs text-gray-300 truncate">{c.label}</span>
                                                                </div>
                                                                <div className="text-right flex-shrink-0">
                                                                    <span className={`text-xs font-mono font-semibold ${
                                                                        c.pass === true ? 'text-green-400' :
                                                                        c.pass === false ? 'text-red-400' :
                                                                        'text-gray-500'
                                                                    }`}>{c.value}</span>
                                                                    <span className="text-xs text-gray-600 ml-1">({c.threshold})</span>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* ── Feedback ── */}
                                {fb && (
                                    <div className={`rounded-lg p-2.5 mb-3 text-xs leading-relaxed ${fb.ok ? 'bg-green-900/30 text-green-300' : 'bg-orange-900/20 text-orange-300'}`}>
                                        {fb.msg}
                                    </div>
                                )}

                                {/* ── Token Safety Checker ── */}
                                <div className="border-t border-gray-700/50 pt-3 mt-1">
                                    <p className="text-xs text-gray-500 font-semibold mb-2">🔒 Cek Keamanan Token</p>
                                    <div className="flex gap-2 mb-2">
                                        <input
                                            type="text"
                                            placeholder="Tempel alamat token 0x..."
                                            value={tokenInputs[w.address] ?? ''}
                                            onChange={e => setTokenInputs(prev => ({ ...prev, [w.address]: e.target.value.trim() }))}
                                            className="flex-1 text-xs bg-gray-900 border border-gray-700 focus:border-blue-600 text-gray-300 rounded-lg px-3 py-1.5 outline-none font-mono placeholder:text-gray-600 placeholder:font-sans"
                                        />
                                        <button
                                            onClick={() => {
                                                const token = tokenInputs[w.address] ?? '';
                                                if (token.match(/^0x[0-9a-fA-F]{40}$/i)) {
                                                    setCheckedTokens(prev => ({ ...prev, [w.address]: token }));
                                                }
                                            }}
                                            disabled={!tokenInputs[w.address]?.match(/^0x[0-9a-fA-F]{40}$/i)}
                                            className="text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg font-semibold transition-all flex-shrink-0"
                                        >
                                            Cek
                                        </button>
                                    </div>
                                    {checkedTokens[w.address] && (
                                        <TokenSafetyBadge
                                            apiUrl={apiUrl}
                                            tokenAddress={checkedTokens[w.address]}
                                            size="full"
                                            showFlags
                                        />
                                    )}
                                </div>

                                {/* ── Action buttons ── */}
                                <div className="flex gap-2 mt-3">
                                    {/* Evaluate / Re-evaluate */}
                                    {(w.aiVerdict === 'pending' || w.aiVerdict === 'rejected') && (
                                        <button
                                            onClick={() => handleEvaluate(w.address)}
                                            disabled={isEval}
                                            className={`flex-1 text-white text-xs py-2 rounded-lg font-semibold transition-all flex items-center justify-center gap-1.5 ${
                                                w.aiVerdict === 'rejected'
                                                    ? 'bg-gray-700 hover:bg-gray-600 disabled:opacity-50'
                                                    : 'bg-purple-700 hover:bg-purple-600 disabled:bg-gray-700 disabled:cursor-not-allowed'
                                            }`}
                                        >
                                            {isEval ? (
                                                <><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>Evaluasi...</>
                                            ) : w.aiVerdict === 'rejected' ? '🔄 Evaluasi Ulang' : '🤖 Evaluasi AI'}
                                        </button>
                                    )}

                                    {/* Promote (AI approved) */}
                                    {w.aiVerdict === 'approved' && (
                                        <button
                                            onClick={() => handlePromote(w.address)}
                                            disabled={isPromote}
                                            className="flex-1 bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-xs py-2 rounded-lg font-semibold transition-all flex items-center justify-center gap-1.5"
                                        >
                                            {isPromote ? (
                                                <><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>Mempromosikan...</>
                                            ) : '🚀 Promosikan ke Copy'}
                                        </button>
                                    )}

                                    {/* Force Promote (override) — always shown for pending/rejected */}
                                    {(w.aiVerdict === 'pending' || w.aiVerdict === 'rejected') && (
                                        <button
                                            onClick={() => handleForcePromote(w.address, w.name)}
                                            disabled={isFP}
                                            title="Promosikan tanpa persetujuan AI (override manual)"
                                            className="bg-amber-900/40 hover:bg-amber-800/60 border border-amber-700/50 text-amber-400 hover:text-amber-300 text-xs px-3 py-2 rounded-lg font-semibold transition-all disabled:opacity-50 whitespace-nowrap"
                                        >
                                            {isFP ? '...' : '⚡ Paksa'}
                                        </button>
                                    )}

                                    {/* Rescan (Blockscout) */}
                                    <button
                                        onClick={() => handleRescan(w.address)}
                                        disabled={isRescan}
                                        title="Rescan ulang data on-chain via Blockscout"
                                        className="bg-blue-900/30 hover:bg-blue-900/60 border border-blue-800/50 text-blue-400 hover:text-blue-300 text-xs px-3 py-2 rounded-lg font-semibold transition-all disabled:opacity-50"
                                    >
                                        {isRescan ? (
                                            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
                                        ) : '🔗'}
                                    </button>

                                    {/* Remove */}
                                    <button
                                        onClick={() => handleRemove(w.address, w.name)}
                                        disabled={isRemove}
                                        className="bg-red-900/30 hover:bg-red-900/60 border border-red-900/50 text-red-400 text-xs px-3 py-2 rounded-lg font-semibold transition-all disabled:opacity-50"
                                        title="Hapus dari monitoring"
                                    >
                                        🗑️
                                    </button>
                                </div>

                                {/* ── Rejection explanation helper ── */}
                                {w.aiVerdict === 'rejected' && !w.aiReason && (
                                    <div className="mt-3 bg-orange-900/10 border border-orange-900/30 rounded-lg p-2.5 text-xs text-orange-300/80 leading-relaxed">
                                        Klik <b>"Evaluasi Ulang"</b> untuk melihat alasan lengkap penolakan per kriteria.
                                        Atau klik <b>"⚡ Paksa"</b> jika Anda sudah yakin dengan wallet ini.
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* ── Footer ── */}
                <div className="sticky bottom-0 bg-gray-900 border-t border-gray-800 px-6 py-4 rounded-b-2xl">
                    <button
                        onClick={onClose}
                        className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white py-2.5 rounded-xl text-sm font-medium transition-all"
                    >
                        Tutup
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WalletMonitorPage;
