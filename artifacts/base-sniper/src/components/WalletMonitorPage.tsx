import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../lib/authFetch';

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
}

interface WalletMonitorPageProps {
    apiUrl:  string;
    onClose: () => void;
}

function verdictBadge(verdict: string) {
    if (verdict === 'approved') return 'bg-green-900/40 text-green-400 border-green-700';
    if (verdict === 'rejected') return 'bg-red-900/30 text-red-400 border-red-800';
    return 'bg-yellow-900/20 text-yellow-400 border-yellow-800';
}
function verdictLabel(verdict: string) {
    if (verdict === 'approved') return '✅ AI Setujui';
    if (verdict === 'rejected') return '❌ AI Tolak';
    return '⏳ Menunggu Evaluasi';
}
function winRateColor(wr: number, total: number) {
    if (total === 0) return 'text-gray-500';
    if (wr >= 55)   return 'text-green-400';
    if (wr >= 40)   return 'text-yellow-400';
    return 'text-red-400';
}
function pnlColor(pnl: number) { return pnl >= 0 ? 'text-green-400' : 'text-red-400'; }
function fmtDuration(ms: number) {
    const h = Math.floor((Date.now() - ms) / 3_600_000);
    if (h < 24) return `${h}j`;
    return `${Math.floor(h / 24)}h`;
}
function fmtTime(ms: number) {
    if (ms === 0) return 'Belum ada';
    const diff = Date.now() - ms;
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} mnt lalu`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}j lalu`;
    return `${Math.floor(diff / 86_400_000)}h lalu`;
}

const WalletMonitorPage: React.FC<WalletMonitorPageProps> = ({ apiUrl, onClose }) => {
    const [wallets, setWallets]           = useState<MonitoredWallet[]>([]);
    const [loading, setLoading]           = useState(true);
    const [evaluating, setEvaluating]     = useState<string | null>(null);
    const [promoting, setPromoting]       = useState<string | null>(null);
    const [removing, setRemoving]         = useState<string | null>(null);
    const [feedbackMsg, setFeedbackMsg]   = useState<{ addr: string; msg: string; ok: boolean } | null>(null);

    const fetchWallets = useCallback(async () => {
        try {
            const res  = await authFetch(`${apiUrl}/api/whale/monitored`);
            const data = await res.json();
            setWallets(data.wallets || []);
        } catch { }
        setLoading(false);
    }, [apiUrl]);

    useEffect(() => { fetchWallets(); }, [fetchWallets]);
    useEffect(() => {
        const t = setInterval(fetchWallets, 15_000);
        return () => clearInterval(t);
    }, [fetchWallets]);

    const showFeedback = (addr: string, msg: string, ok: boolean) => {
        setFeedbackMsg({ addr, msg, ok });
        setTimeout(() => setFeedbackMsg(null), 4000);
    };

    const handleEvaluate = async (address: string) => {
        setEvaluating(address);
        try {
            const res  = await authFetch(`${apiUrl}/api/whale/evaluate/${address}`, { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                showFeedback(address, `AI: ${data.verdict === 'approved' ? '✅ Disetujui' : '❌ Ditolak'} — ${data.reason}`, data.verdict === 'approved');
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
            <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col shadow-2xl">

                {/* Header */}
                <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-2xl">
                    <div>
                        <h2 className="text-lg font-bold text-white">🔬 Manajemen Monitoring Whale</h2>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {wallets.length} wallet dimonitor
                            {approvedCount > 0 && <span className="ml-2 text-green-400">· {approvedCount} siap copy</span>}
                            {pendingCount  > 0 && <span className="ml-2 text-yellow-400">· {pendingCount} menunggu evaluasi</span>}
                            {rejectedCount > 0 && <span className="ml-2 text-red-400">· {rejectedCount} ditolak AI</span>}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none transition-colors">&times;</button>
                </div>

                {/* Info banner */}
                <div className="mx-5 mt-4 bg-blue-900/20 border border-blue-800/40 rounded-xl p-3">
                    <div className="flex gap-2.5">
                        <span className="text-lg flex-shrink-0">🤖</span>
                        <div className="text-xs text-blue-300 leading-relaxed space-y-0.5">
                            <p><span className="text-white font-semibold">Tahap 1:</span> Kandidat disetujui → masuk Monitoring</p>
                            <p><span className="text-white font-semibold">Tahap 2:</span> Bot amati trade, win/loss, PnL selama 10 menit tiap poll</p>
                            <p><span className="text-white font-semibold">Tahap 3:</span> Klik "Evaluasi AI" → jika disetujui → "Promosikan ke Copy"</p>
                        </div>
                    </div>
                </div>

                {/* Wallet list */}
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
                        const fb         = feedbackMsg?.addr === w.address ? feedbackMsg : null;
                        const isEval     = evaluating === w.address;
                        const isPromote  = promoting  === w.address;
                        const isRemove   = removing   === w.address;

                        return (
                            <div key={w.address} className={`border rounded-xl p-4 transition-all ${
                                w.aiVerdict === 'approved' ? 'border-green-700/70 bg-green-950/20' :
                                w.aiVerdict === 'rejected' ? 'border-red-900/50 bg-red-950/10 opacity-75' :
                                'border-gray-700 bg-gray-800/40'
                            }`}>
                                {/* Top row: name + verdict badge */}
                                <div className="flex items-start justify-between gap-2 mb-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-white truncate">{w.name}</p>
                                        <p className="text-xs text-gray-500 font-mono">{w.address.slice(0, 14)}…{w.address.slice(-6)}</p>
                                    </div>
                                    <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold whitespace-nowrap flex-shrink-0 ${verdictBadge(w.aiVerdict)}`}>
                                        {verdictLabel(w.aiVerdict)}
                                    </span>
                                </div>

                                {/* Stats grid */}
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
                                        <p className={`text-sm font-bold ${pnlColor(w.totalPnlPct)}`}>
                                            {totalPairs > 0 ? `${w.totalPnlPct >= 0 ? '+' : ''}${w.totalPnlPct.toFixed(1)}%` : '—'}
                                        </p>
                                    </div>
                                </div>

                                {/* Secondary stats */}
                                <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
                                    <span>📊 {w.winsObserved}W / {w.lossesObserved}L</span>
                                    <span>⚡ {w.tradesPerDay > 0 ? `${w.tradesPerDay} trade/hari` : 'Belum ada data'}</span>
                                    <span>🕐 {fmtTime(w.lastTradeMs)}</span>
                                </div>

                                {/* AI score + reason */}
                                {w.aiVerdict !== 'pending' && w.aiReason && (
                                    <div className={`rounded-lg p-2.5 mb-3 text-xs leading-relaxed ${
                                        w.aiVerdict === 'approved'
                                            ? 'bg-green-900/20 border border-green-800/40 text-green-300'
                                            : 'bg-red-900/15 border border-red-900/40 text-red-300'
                                    }`}>
                                        {w.aiScore !== undefined && (
                                            <span className="font-bold mr-2">Skor AI: {w.aiScore}/100 —</span>
                                        )}
                                        {w.aiReason}
                                    </div>
                                )}

                                {/* Feedback */}
                                {fb && (
                                    <div className={`rounded-lg p-2.5 mb-3 text-xs leading-relaxed ${fb.ok ? 'bg-green-900/30 text-green-300' : 'bg-red-900/20 text-red-300'}`}>
                                        {fb.msg}
                                    </div>
                                )}

                                {/* Action buttons */}
                                <div className="flex gap-2">
                                    {w.aiVerdict === 'pending' && (
                                        <button
                                            onClick={() => handleEvaluate(w.address)}
                                            disabled={isEval}
                                            className="flex-1 bg-purple-700 hover:bg-purple-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-xs py-2 rounded-lg font-semibold transition-all flex items-center justify-center gap-1.5"
                                        >
                                            {isEval ? (
                                                <><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>Evaluasi...</>
                                            ) : '🤖 Evaluasi AI'}
                                        </button>
                                    )}
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
                                    {w.aiVerdict === 'rejected' && (
                                        <button
                                            onClick={() => handleEvaluate(w.address)}
                                            disabled={isEval}
                                            className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 text-xs py-2 rounded-lg font-semibold transition-all"
                                        >
                                            {isEval ? 'Evaluasi...' : '🔄 Evaluasi Ulang'}
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleRemove(w.address, w.name)}
                                        disabled={isRemove}
                                        className="bg-red-900/30 hover:bg-red-900/60 border border-red-900/50 text-red-400 text-xs px-3 py-2 rounded-lg font-semibold transition-all disabled:opacity-50"
                                        title="Hapus dari monitoring"
                                    >
                                        🗑️
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Footer */}
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
