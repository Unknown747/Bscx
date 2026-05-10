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

interface Props {
    apiUrl:  string;
    onClose: () => void;
}

function fmtTime(ms: number) {
    if (ms === 0) return '—';
    const d = Date.now() - ms;
    if (d < 3_600_000)  return `${Math.floor(d / 60_000)}m lalu`;
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}j lalu`;
    return `${Math.floor(d / 86_400_000)}h lalu`;
}

const VettedWalletsPage: React.FC<Props> = ({ apiUrl, onClose }) => {
    const [wallets, setWallets]       = useState<MonitoredWallet[]>([]);
    const [loading, setLoading]       = useState(true);
    const [promoting, setPromoting]   = useState<string | null>(null);
    const [evaluating, setEvaluating] = useState<string | null>(null);
    const [removing, setRemoving]     = useState<string | null>(null);
    const [feedback, setFeedback]     = useState<{ addr: string; msg: string; ok: boolean } | null>(null);
    const [filter, setFilter]         = useState<'all' | 'approved' | 'rejected' | 'pending'>('approved');

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
        setFeedback({ addr, msg, ok });
        setTimeout(() => setFeedback(null), 4000);
    };

    const handlePromote = async (address: string) => {
        setPromoting(address);
        try {
            const res  = await authFetch(`${apiUrl}/api/whale/promote/${address}`, { method: 'POST' });
            const data = await res.json();
            if (res.ok) { showFeedback(address, '🚀 Berhasil ditambahkan ke Copy Trading!', true); await fetchWallets(); }
            else showFeedback(address, data.error || 'Gagal', false);
        } catch { showFeedback(address, 'Gagal menghubungi server', false); }
        setPromoting(null);
    };

    const handleEvaluate = async (address: string) => {
        setEvaluating(address);
        try {
            const res  = await authFetch(`${apiUrl}/api/whale/evaluate/${address}`, { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                const verdict = data.verdict === 'approved' ? '✅ Disetujui AI' : data.verdict === 'rejected' ? '❌ Ditolak AI' : '⏳ Data belum cukup';
                showFeedback(address, `${verdict}${data.score ? ` (${data.score}/100)` : ''}`, data.verdict === 'approved');
                await fetchWallets();
            } else showFeedback(address, data.error || 'Evaluasi gagal', false);
        } catch { showFeedback(address, 'Gagal menghubungi server', false); }
        setEvaluating(null);
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

    const approved = wallets.filter(w => w.aiVerdict === 'approved');
    const rejected = wallets.filter(w => w.aiVerdict === 'rejected');
    const pending  = wallets.filter(w => w.aiVerdict === 'pending');

    const displayed =
        filter === 'approved' ? approved :
        filter === 'rejected' ? rejected :
        filter === 'pending'  ? pending  : wallets;

    return (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col shadow-2xl">

                {/* Header */}
                <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-4 py-3.5 flex items-center justify-between rounded-t-2xl flex-shrink-0">
                    <div>
                        <h2 className="text-base font-bold text-white">🤖 Hasil Vetting AI</h2>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {approved.length > 0 && <span className="text-green-400">{approved.length} siap copy </span>}
                            {pending.length  > 0 && <span className="text-yellow-400">· {pending.length} perlu evaluasi </span>}
                            {rejected.length > 0 && <span className="text-gray-500">· {rejected.length} ditolak</span>}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none w-10 h-10 flex items-center justify-center">&times;</button>
                </div>

                {/* Filter tabs */}
                <div className="flex gap-1 px-4 pt-3 pb-0 flex-shrink-0">
                    {([
                        { key: 'approved', label: `✅ Siap (${approved.length})`,   cls: 'text-green-400' },
                        { key: 'pending',  label: `⏳ Belum (${pending.length})`,   cls: 'text-yellow-400' },
                        { key: 'rejected', label: `❌ Tolak (${rejected.length})`,  cls: 'text-gray-500' },
                        { key: 'all',      label: `Semua (${wallets.length})`,      cls: 'text-gray-300' },
                    ] as const).map(f => (
                        <button
                            key={f.key}
                            onClick={() => setFilter(f.key)}
                            className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                                filter === f.key ? 'bg-gray-700 text-white' : `${f.cls} hover:text-white`
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                    {loading ? (
                        <div className="text-center py-12 text-gray-600 text-sm">Memuat...</div>
                    ) : displayed.length === 0 ? (
                        <div className="text-center py-12 space-y-2">
                            <p className="text-3xl">
                                {filter === 'approved' ? '✅' : filter === 'rejected' ? '❌' : filter === 'pending' ? '⏳' : '🔬'}
                            </p>
                            <p className="text-gray-500 text-sm">Belum ada wallet di sini</p>
                            {filter === 'approved' && (
                                <p className="text-gray-600 text-xs">Buka tab "Belum" → Evaluasi AI → tunggu disetujui</p>
                            )}
                        </div>
                    ) : displayed.map(w => {
                        const totalPairs = w.winsObserved + w.lossesObserved;
                        const winRate    = totalPairs > 0 ? Math.round((w.winsObserved / totalPairs) * 100) : 0;
                        const fb         = feedback?.addr === w.address ? feedback : null;
                        const isEval     = evaluating === w.address;
                        const isProm     = promoting  === w.address;
                        const isRem      = removing   === w.address;

                        return (
                            <div key={w.address} className={`border rounded-xl p-3.5 transition-all ${
                                w.aiVerdict === 'approved' ? 'border-green-700/60 bg-green-950/20' :
                                w.aiVerdict === 'rejected' ? 'border-gray-800 bg-gray-900/30 opacity-70' :
                                'border-gray-700 bg-gray-800/30'
                            }`}>
                                {/* Top row */}
                                <div className="flex items-start justify-between gap-2 mb-2.5">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-white truncate leading-tight">{w.name}</p>
                                        <p className="text-xs text-gray-500 font-mono">{w.address.slice(0, 10)}…{w.address.slice(-6)}</p>
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                        {w.aiScore !== undefined && (
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-lg border ${
                                                w.aiScore >= 70 ? 'bg-green-900/40 text-green-400 border-green-700' :
                                                w.aiScore >= 50 ? 'bg-yellow-900/30 text-yellow-400 border-yellow-700' :
                                                'bg-gray-800 text-gray-500 border-gray-700'
                                            }`}>{w.aiScore}</span>
                                        )}
                                        <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${
                                            w.aiVerdict === 'approved' ? 'bg-green-900/40 text-green-400 border-green-700' :
                                            w.aiVerdict === 'rejected' ? 'bg-gray-800 text-gray-500 border-gray-700' :
                                            'bg-yellow-900/20 text-yellow-400 border-yellow-800'
                                        }`}>
                                            {w.aiVerdict === 'approved' ? '✅ OK' : w.aiVerdict === 'rejected' ? '❌ Tolak' : '⏳ Pending'}
                                        </span>
                                    </div>
                                </div>

                                {/* Stats */}
                                <div className="grid grid-cols-4 gap-1.5 mb-2.5">
                                    <div className="text-center bg-gray-900/60 rounded-lg py-1.5">
                                        <p className="text-[10px] text-gray-500">Trade</p>
                                        <p className="text-xs font-bold text-white">{w.tradesObserved}</p>
                                    </div>
                                    <div className="text-center bg-gray-900/60 rounded-lg py-1.5">
                                        <p className="text-[10px] text-gray-500">Win%</p>
                                        <p className={`text-xs font-bold ${totalPairs > 0 ? (winRate >= 55 ? 'text-green-400' : winRate >= 40 ? 'text-yellow-400' : 'text-red-400') : 'text-gray-500'}`}>
                                            {totalPairs > 0 ? `${winRate}%` : '—'}
                                        </p>
                                    </div>
                                    <div className="text-center bg-gray-900/60 rounded-lg py-1.5">
                                        <p className="text-[10px] text-gray-500">PnL</p>
                                        <p className={`text-xs font-bold ${totalPairs > 0 ? (w.totalPnlPct >= 0 ? 'text-green-400' : 'text-red-400') : 'text-gray-500'}`}>
                                            {totalPairs > 0 ? `${w.totalPnlPct >= 0 ? '+' : ''}${w.totalPnlPct.toFixed(0)}%` : '—'}
                                        </p>
                                    </div>
                                    <div className="text-center bg-gray-900/60 rounded-lg py-1.5">
                                        <p className="text-[10px] text-gray-500">Aktif</p>
                                        <p className="text-xs font-bold text-white">{fmtTime(w.lastTradeMs)}</p>
                                    </div>
                                </div>

                                {/* AI reason summary */}
                                {w.aiReason && (
                                    <p className={`text-xs rounded-lg px-2.5 py-1.5 mb-2.5 leading-relaxed ${
                                        w.aiVerdict === 'approved' ? 'bg-green-900/20 text-green-300/80' :
                                        w.aiVerdict === 'rejected' ? 'bg-gray-800/50 text-gray-500' :
                                        'bg-blue-900/20 text-blue-300/80'
                                    }`}>
                                        {w.aiReason.split('\n')[0]}
                                    </p>
                                )}

                                {/* Feedback */}
                                {fb && (
                                    <div className={`rounded-lg px-2.5 py-1.5 mb-2.5 text-xs ${fb.ok ? 'bg-green-900/30 text-green-300' : 'bg-orange-900/20 text-orange-300'}`}>
                                        {fb.msg}
                                    </div>
                                )}

                                {/* Action buttons */}
                                <div className="flex gap-2">
                                    {w.aiVerdict === 'approved' ? (
                                        <>
                                            <button
                                                onClick={() => handlePromote(w.address)}
                                                disabled={isProm}
                                                className="flex-1 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-xs py-2.5 rounded-xl font-bold transition-all"
                                            >
                                                {isProm ? '⏳...' : '🚀 Tambah ke Copy'}
                                            </button>
                                            <button
                                                onClick={() => handleRemove(w.address, w.name)}
                                                disabled={isRem}
                                                className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 text-xs px-3 py-2.5 rounded-xl font-semibold transition-all"
                                                title="Hapus dari monitoring"
                                            >
                                                🗑️
                                            </button>
                                        </>
                                    ) : w.aiVerdict === 'pending' ? (
                                        <>
                                            <button
                                                onClick={() => handleEvaluate(w.address)}
                                                disabled={isEval}
                                                className="flex-1 bg-purple-700 hover:bg-purple-600 disabled:bg-gray-700 text-white text-xs py-2.5 rounded-xl font-bold transition-all"
                                            >
                                                {isEval ? '⏳ Evaluasi...' : '🤖 Evaluasi AI'}
                                            </button>
                                            <button
                                                onClick={() => handleRemove(w.address, w.name)}
                                                disabled={isRem}
                                                className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 text-xs px-3 py-2.5 rounded-xl font-semibold transition-all"
                                            >
                                                🗑️
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                onClick={() => handleEvaluate(w.address)}
                                                disabled={isEval}
                                                className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white text-xs py-2.5 rounded-xl font-semibold transition-all"
                                            >
                                                {isEval ? '⏳...' : '🔄 Evaluasi Ulang'}
                                            </button>
                                            <button
                                                onClick={() => handleRemove(w.address, w.name)}
                                                disabled={isRem}
                                                className="bg-red-900/30 hover:bg-red-900/60 border border-red-900/50 text-red-400 text-xs px-3 py-2.5 rounded-xl font-semibold transition-all"
                                            >
                                                🗑️
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="flex-shrink-0 border-t border-gray-800 px-4 py-3">
                    <button onClick={onClose} className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-3 rounded-xl text-sm font-medium transition-all">
                        Tutup
                    </button>
                </div>
            </div>
        </div>
    );
};

export default VettedWalletsPage;
