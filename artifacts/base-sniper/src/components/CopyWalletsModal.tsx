import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../lib/authFetch';
import WhaleDetailModal from './WhaleDetailModal';

interface Wallet {
    address: string;
    name: string;
    isActive: boolean;
    lastBuyTime: number;
    lastBuyToken: string;
    totalPnL: number;
    winRate: number;
    copiedTrades: number;
    wins: number;
    losses: number;
    autoPaused: boolean;
}

interface WhaleCandidate {
    address: string;
    estimatedWinRate: number;
    tradeCount: number;
    avgProfitPct: number;
    totalVolumeEth: number;
    lastActiveMs: number;
    discoveredAt: number;
    score: number;
    tokens: string[];
    status: 'pending' | 'approved' | 'rejected';
}

interface SimResult {
    walletAddress: string;
    tokenAddress: string;
    tokenSymbol: string;
    simulated: boolean;
    estimatedProfit: number;
    estimatedRisk: 'LOW' | 'MEDIUM' | 'HIGH';
    winRate: number;
    tradeCount: number;
    summary: string;
}

interface CopyWalletsModalProps {
    apiUrl: string;
    onClose: () => void;
}

type ModalTab = 'manual' | 'finder';

interface DetailTarget {
    address: string;
    name?:   string;
    showActions?: boolean;
}

function winRateColor(wr: number, trades: number): string {
    if (trades === 0) return 'text-gray-500 border-gray-700 bg-gray-800/40';
    if (wr >= 60)    return 'text-green-400 border-green-800 bg-green-900/30';
    if (wr >= 40)    return 'text-yellow-400 border-yellow-800 bg-yellow-900/20';
    return 'text-red-400 border-red-800 bg-red-900/20';
}

function scoreColor(score: number): string {
    if (score >= 75) return 'text-green-400';
    if (score >= 55) return 'text-yellow-400';
    return 'text-red-400';
}

function riskColor(risk: 'LOW' | 'MEDIUM' | 'HIGH'): string {
    if (risk === 'LOW')    return 'text-green-400 bg-green-900/30 border-green-800';
    if (risk === 'MEDIUM') return 'text-yellow-400 bg-yellow-900/20 border-yellow-800';
    return 'text-red-400 bg-red-900/20 border-red-800';
}

const CopyWalletsModal: React.FC<CopyWalletsModalProps> = ({ apiUrl, onClose }) => {
    const [activeTab, setActiveTab] = useState<ModalTab>('manual');

    // ─── Manual tab state ───────────────────────────────────────────────────────
    const [wallets, setWallets]         = useState<Wallet[]>([]);
    const [loading, setLoading]         = useState(true);
    const [addAddress, setAddAddress]   = useState('');
    const [addLabel, setAddLabel]       = useState('');
    const [addError, setAddError]       = useState('');
    const [adding, setAdding]           = useState(false);
    const [editingAddr, setEditingAddr] = useState<string | null>(null);
    const [editName, setEditName]       = useState('');

    // ─── Finder tab state ───────────────────────────────────────────────────────
    const [candidates, setCandidates]   = useState<WhaleCandidate[]>([]);
    const [scanning, setScanning]       = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null); // address being acted on
    const [simResult, setSimResult]     = useState<SimResult | null>(null);
    const [simAddress, setSimAddress]   = useState('');
    const [simToken, setSimToken]       = useState('');
    const [simLoading, setSimLoading]   = useState(false);

    // ─── Detail modal state ─────────────────────────────────────────────────────
    const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);

    const fetchWallets = useCallback(async () => {
        try {
            const res = await authFetch(`${apiUrl}/api/wallets`);
            const data = await res.json();
            setWallets(data.wallets || []);
        } catch { }
        setLoading(false);
    }, [apiUrl]);

    const fetchCandidates = useCallback(async () => {
        try {
            const res = await authFetch(`${apiUrl}/api/whale/all`);
            const data = await res.json();
            setCandidates(data.candidates || []);
        } catch { }
    }, [apiUrl]);

    useEffect(() => { fetchWallets(); }, [fetchWallets]);
    useEffect(() => {
        if (activeTab === 'finder') fetchCandidates();
    }, [activeTab, fetchCandidates]);

    // ─── Manual tab handlers ───────────────────────────────────────────────────
    const handleAdd = async () => {
        setAddError('');
        if (!addAddress.trim()) { setAddError('Masukkan alamat wallet'); return; }
        setAdding(true);
        try {
            const res = await authFetch(`${apiUrl}/api/wallets`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address: addAddress.trim(), name: addLabel.trim() })
            });
            const data = await res.json();
            if (!res.ok) { setAddError(data.error || 'Gagal menambahkan'); return; }
            setWallets(data.wallets);
            setAddAddress('');
            setAddLabel('');
        } catch { setAddError('Gagal menghubungi server'); }
        setAdding(false);
    };

    const handleRemove = async (address: string) => {
        if (!confirm('Hapus wallet ini dari daftar?')) return;
        try {
            const res = await authFetch(`${apiUrl}/api/wallets/${address}`, { method: 'DELETE' });
            const data = await res.json();
            if (res.ok) setWallets(data.wallets);
        } catch { }
    };

    const handleToggle = async (address: string, current: boolean) => {
        try {
            const res = await authFetch(`${apiUrl}/api/wallets/${address}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active: !current })
            });
            const data = await res.json();
            if (res.ok) setWallets(data.wallets);
        } catch { }
    };

    const handleRename = async (address: string) => {
        if (!editName.trim()) { setEditingAddr(null); return; }
        try {
            const res = await authFetch(`${apiUrl}/api/wallets/${address}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: editName.trim() })
            });
            const data = await res.json();
            if (res.ok) setWallets(data.wallets);
        } catch { }
        setEditingAddr(null);
    };

    // ─── Finder tab handlers ───────────────────────────────────────────────────
    const handleScan = async () => {
        setScanning(true);
        try {
            const res  = await authFetch(`${apiUrl}/api/whale/scan`, { method: 'POST' });
            const data = await res.json();
            if (data.candidates) setCandidates(data.candidates);
            await fetchCandidates();
        } catch { }
        setScanning(false);
    };

    const handleApprove = async (address: string) => {
        setActionLoading(address);
        try {
            const res = await authFetch(`${apiUrl}/api/whale/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address })
            });
            if (res.ok) {
                await fetchCandidates();
                await fetchWallets();
            }
        } catch { }
        setActionLoading(null);
    };

    const handleReject = async (address: string) => {
        setActionLoading(address);
        try {
            await authFetch(`${apiUrl}/api/whale/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address })
            });
            await fetchCandidates();
        } catch { }
        setActionLoading(null);
    };

    const handleSimulate = async () => {
        if (!simAddress.trim() || !simToken.trim()) return;
        setSimLoading(true);
        setSimResult(null);
        try {
            const res  = await authFetch(`${apiUrl}/api/simulate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: simAddress.trim(), tokenAddress: simToken.trim() })
            });
            const data = await res.json();
            if (!data.error) setSimResult(data);
        } catch { }
        setSimLoading(false);
    };

    const activeCount  = wallets.filter(w => w.isActive).length;
    const pausedByBot  = wallets.filter(w => w.autoPaused).length;
    const pendingCount = candidates.filter(c => c.status === 'pending').length;

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">

                {/* Header */}
                <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-2xl">
                    <div>
                        <h2 className="text-lg font-bold text-white">🐋 Whale Manager</h2>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {activeCount} aktif · {wallets.length} total
                            {pausedByBot > 0 && <span className="ml-2 text-orange-400">· {pausedByBot} auto-paused</span>}
                            {pendingCount > 0 && <span className="ml-2 text-blue-400">· {pendingCount} pending approval</span>}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none transition-colors">&times;</button>
                </div>

                {/* Tab selector */}
                <div className="flex mx-5 mt-4 bg-gray-800 rounded-xl p-1 gap-1">
                    <button
                        onClick={() => setActiveTab('manual')}
                        className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${activeTab === 'manual' ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        📝 Manual
                    </button>
                    <button
                        onClick={() => setActiveTab('finder')}
                        className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1 ${activeTab === 'finder' ? 'bg-blue-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        🔍 Auto Finder
                        {pendingCount > 0 && (
                            <span className="bg-blue-400 text-gray-900 text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                                {pendingCount}
                            </span>
                        )}
                    </button>
                </div>

                {/* ═══════════════════ MANUAL TAB ═══════════════════ */}
                {activeTab === 'manual' && (
                    <div className="p-5 space-y-5">
                        {/* Add wallet form */}
                        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
                            <h3 className="text-sm font-semibold text-gray-200">➕ Tambah Whale Baru</h3>
                            <input
                                type="text"
                                value={addAddress}
                                onChange={e => { setAddAddress(e.target.value); setAddError(''); }}
                                placeholder="0x... (alamat wallet)"
                                className="w-full bg-gray-900 border border-gray-700 focus:border-green-500 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 text-sm font-mono focus:outline-none transition-colors"
                            />
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={addLabel}
                                    onChange={e => setAddLabel(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleAdd()}
                                    placeholder="Label (opsional)"
                                    className="flex-1 bg-gray-900 border border-gray-700 focus:border-green-500 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 text-sm focus:outline-none transition-colors"
                                />
                                <button
                                    onClick={handleAdd}
                                    disabled={adding}
                                    className="bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap"
                                >
                                    {adding ? '...' : '+ Tambah'}
                                </button>
                            </div>
                            {addError && <p className="text-xs text-red-400">{addError}</p>}
                        </div>

                        {/* Wallet list */}
                        <div className="space-y-3">
                            {loading ? (
                                <div className="text-center py-8 text-gray-600 text-sm">Memuat...</div>
                            ) : wallets.length === 0 ? (
                                <div className="text-center py-8 text-gray-600 text-sm">
                                    Belum ada whale wallet.<br />Tambahkan di atas atau gunakan Auto Finder.
                                </div>
                            ) : wallets.map(w => (
                                <div
                                    key={w.address}
                                    className={`border rounded-xl p-4 transition-all ${
                                        w.autoPaused
                                            ? 'bg-orange-950/20 border-orange-800/50'
                                            : w.isActive
                                                ? 'bg-gray-800/50 border-gray-700'
                                                : 'bg-gray-900/30 border-gray-800 opacity-60'
                                    }`}
                                >
                                    <div className="flex items-start gap-3">
                                        <button
                                            onClick={() => handleToggle(w.address, w.isActive)}
                                            className={`mt-0.5 flex-shrink-0 w-9 h-5 rounded-full transition-colors relative ${w.isActive ? 'bg-green-600' : 'bg-gray-700'}`}
                                        >
                                            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${w.isActive ? 'left-4' : 'left-0.5'}`} />
                                        </button>
                                        <div className="flex-1 min-w-0">
                                            {editingAddr === w.address ? (
                                                <div className="flex gap-2 mb-1">
                                                    <input
                                                        autoFocus
                                                        value={editName}
                                                        onChange={e => setEditName(e.target.value)}
                                                        onKeyDown={e => { if (e.key === 'Enter') handleRename(w.address); if (e.key === 'Escape') setEditingAddr(null); }}
                                                        className="flex-1 bg-gray-900 border border-green-500 rounded-lg px-3 py-1 text-white text-sm focus:outline-none"
                                                    />
                                                    <button onClick={() => handleRename(w.address)} className="text-green-400 text-xs px-2">✓</button>
                                                    <button onClick={() => setEditingAddr(null)} className="text-gray-500 text-xs px-1">✗</button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                    <span className="text-sm font-semibold text-white truncate">{w.name}</span>
                                                    <button onClick={() => { setEditingAddr(w.address); setEditName(w.name); }} className="text-gray-600 hover:text-gray-400 text-xs" title="Ganti nama">✏️</button>
                                                    {w.autoPaused && <span className="text-xs px-2 py-0.5 rounded-full border bg-orange-900/40 text-orange-400 border-orange-700">⏸ Auto-paused</span>}
                                                </div>
                                            )}
                                            <p className="text-xs text-gray-500 font-mono truncate">{w.address}</p>
                                            {w.copiedTrades > 0 ? (
                                                <div className="flex items-center gap-2 mt-2 flex-wrap">
                                                    <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${winRateColor(w.winRate, w.copiedTrades)}`}>{w.winRate.toFixed(0)}% WR</span>
                                                    <span className="text-xs text-gray-500">{w.wins}W / {w.losses}L</span>
                                                    <span className={`text-xs font-medium ${w.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>{w.totalPnL >= 0 ? '+' : ''}{w.totalPnL.toFixed(1)}%</span>
                                                </div>
                                            ) : (
                                                <p className="text-xs text-gray-600 mt-1.5 italic">Belum ada copy trade tercatat</p>
                                            )}
                                            {w.autoPaused && <p className="text-xs text-orange-500/80 mt-1">Win rate turun — toggle untuk aktifkan kembali</p>}
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <span className={`text-xs px-2 py-0.5 rounded-full border ${w.autoPaused ? 'bg-orange-900/30 text-orange-400 border-orange-800' : w.isActive ? 'bg-green-900/40 text-green-400 border-green-800' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>
                                                {w.autoPaused ? 'Auto-Pause' : w.isActive ? 'Aktif' : 'Jeda'}
                                            </span>
                                            <button onClick={() => handleRemove(w.address)} className="text-gray-600 hover:text-red-400 text-base transition-colors" title="Hapus wallet">🗑️</button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Info box */}
                        <div className="bg-blue-900/20 border border-blue-800/40 rounded-xl p-4">
                            <div className="flex gap-3">
                                <span className="text-lg">📊</span>
                                <div className="text-xs text-blue-300 leading-relaxed space-y-1">
                                    <p><span className="text-green-400 font-semibold">Win Rate ≥ 60%</span> — whale performa bagus</p>
                                    <p><span className="text-yellow-400 font-semibold">Win Rate 40–60%</span> — performa sedang</p>
                                    <p><span className="text-red-400 font-semibold">Win Rate &lt; 40%</span> — hati-hati</p>
                                    <p className="text-orange-400 font-semibold">⏸ Auto-paused jika WR &lt; 30% setelah 5 trade</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ═══════════════════ AUTO FINDER TAB ═══════════════════ */}
                {activeTab === 'finder' && (
                    <div className="p-5 space-y-5">
                        {/* Scan button */}
                        <div className="bg-blue-900/20 border border-blue-800/40 rounded-xl p-4">
                            <div className="flex items-start gap-3 mb-3">
                                <span className="text-xl">🔍</span>
                                <div>
                                    <p className="text-sm font-semibold text-blue-300">Auto Whale Finder</p>
                                    <p className="text-xs text-blue-400/70 mt-0.5">
                                        Scan GeckoTerminal trending pools untuk menemukan whale profitabel.
                                        Semua kandidat harus Anda setujui sebelum dicopy.
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={handleScan}
                                disabled={scanning}
                                className="w-full bg-blue-700 hover:bg-blue-600 disabled:bg-blue-900 disabled:cursor-not-allowed text-white py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
                            >
                                {scanning ? (
                                    <>
                                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
                                        Scanning GeckoTerminal...
                                    </>
                                ) : '🔍 Scan Sekarang'}
                            </button>
                        </div>

                        {/* Candidate list */}
                        {candidates.length === 0 ? (
                            <div className="text-center py-8 text-gray-600 text-sm">
                                Belum ada kandidat whale.<br />
                                Klik "Scan Sekarang" untuk mencari.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                                    {candidates.length} kandidat ditemukan
                                </p>
                                {candidates.map(c => {
                                    const daysSince = ((Date.now() - c.lastActiveMs) / 86_400_000).toFixed(1);
                                    const isLoading = actionLoading === c.address;
                                    return (
                                        <div
                                            key={c.address}
                                            className={`border rounded-xl p-4 transition-all ${
                                                c.status === 'approved' ? 'border-green-700 bg-green-900/10' :
                                                c.status === 'rejected' ? 'border-gray-800 bg-gray-900/20 opacity-50' :
                                                'border-blue-800/50 bg-blue-900/10'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-3 mb-3">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <p className="text-xs font-mono text-gray-400 truncate">{c.address.slice(0, 14)}...{c.address.slice(-6)}</p>
                                                        <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${
                                                            c.status === 'approved' ? 'text-green-400 border-green-700 bg-green-900/30' :
                                                            c.status === 'rejected' ? 'text-gray-500 border-gray-700 bg-gray-800' :
                                                            'text-blue-400 border-blue-700 bg-blue-900/30'
                                                        }`}>
                                                            {c.status === 'approved' ? '✅ Approved' : c.status === 'rejected' ? '❌ Ditolak' : '⏳ Waitlist'}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 flex-shrink-0">
                                                    <button
                                                        onClick={() => setDetailTarget({ address: c.address, showActions: c.status === 'pending' })}
                                                        className="text-xs text-blue-400 hover:text-blue-300 bg-blue-900/20 border border-blue-800/50 px-2 py-0.5 rounded-lg transition-colors"
                                                    >
                                                        🔬 Analisis
                                                    </button>
                                                    <span className={`text-sm font-bold ${scoreColor(c.score)}`}>{c.score}/100</span>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-3 gap-2 mb-3">
                                                <div className="text-center bg-gray-800/50 rounded-lg p-2">
                                                    <p className="text-xs text-gray-500">Est. WR</p>
                                                    <p className="text-sm font-bold text-white">{c.estimatedWinRate}%</p>
                                                </div>
                                                <div className="text-center bg-gray-800/50 rounded-lg p-2">
                                                    <p className="text-xs text-gray-500">Avg Profit</p>
                                                    <p className="text-sm font-bold text-green-400">+{c.avgProfitPct}%</p>
                                                </div>
                                                <div className="text-center bg-gray-800/50 rounded-lg p-2">
                                                    <p className="text-xs text-gray-500">Terakhir</p>
                                                    <p className="text-sm font-bold text-white">{daysSince}h lalu</p>
                                                </div>
                                            </div>

                                            {c.status === 'pending' && (
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleApprove(c.address)}
                                                        disabled={isLoading}
                                                        className="flex-1 bg-green-700 hover:bg-green-600 disabled:bg-gray-700 text-white text-xs py-2 rounded-lg font-semibold transition-all"
                                                    >
                                                        {isLoading ? '...' : '✅ Setujui & Copy'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleReject(c.address)}
                                                        disabled={isLoading}
                                                        className="flex-1 bg-red-900/40 hover:bg-red-900/70 border border-red-800 disabled:bg-gray-700 text-red-400 text-xs py-2 rounded-lg font-semibold transition-all"
                                                    >
                                                        {isLoading ? '...' : '❌ Tolak'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Simulation Panel */}
                        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
                            <h3 className="text-sm font-semibold text-gray-200">🔮 Simulasi Copy Trade</h3>
                            <p className="text-xs text-gray-500">Estimasi P&L jika mengikuti whale pada token tertentu sebelum eksekusi.</p>
                            <input
                                type="text"
                                value={simAddress}
                                onChange={e => setSimAddress(e.target.value)}
                                placeholder="0x... (alamat whale wallet)"
                                className="w-full bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 text-xs font-mono focus:outline-none transition-colors"
                            />
                            <input
                                type="text"
                                value={simToken}
                                onChange={e => setSimToken(e.target.value)}
                                placeholder="0x... (alamat token)"
                                className="w-full bg-gray-900 border border-gray-700 focus:border-blue-500 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 text-xs font-mono focus:outline-none transition-colors"
                            />
                            <button
                                onClick={handleSimulate}
                                disabled={simLoading || !simAddress.trim() || !simToken.trim()}
                                className="w-full bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2"
                            >
                                {simLoading ? (
                                    <><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>Menghitung...</>
                                ) : '🔮 Hitung Estimasi'}
                            </button>

                            {simResult && (
                                <div className="mt-3 bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-semibold text-gray-300">Hasil Simulasi: <span className="text-blue-400">{simResult.tokenSymbol || '?'}</span></p>
                                        <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${riskColor(simResult.estimatedRisk)}`}>
                                            {simResult.estimatedRisk} Risk
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <div className="text-center bg-gray-800 rounded-lg p-2">
                                            <p className="text-xs text-gray-500">Est. P&L</p>
                                            <p className={`text-base font-bold ${simResult.estimatedProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                {simResult.estimatedProfit >= 0 ? '+' : ''}{simResult.estimatedProfit}%
                                            </p>
                                        </div>
                                        <div className="text-center bg-gray-800 rounded-lg p-2">
                                            <p className="text-xs text-gray-500">Win Rate</p>
                                            <p className="text-base font-bold text-white">{simResult.winRate}%</p>
                                        </div>
                                        <div className="text-center bg-gray-800 rounded-lg p-2">
                                            <p className="text-xs text-gray-500">Trades</p>
                                            <p className="text-base font-bold text-white">{simResult.tradeCount}</p>
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-400 leading-relaxed">{simResult.summary}</p>
                                    {!simResult.simulated && (
                                        <p className="text-xs text-yellow-500/80">⚠️ Data historis terbatas — estimasi berdasarkan performa umum whale</p>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Info box */}
                        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-3">
                            <p className="text-xs text-gray-500 leading-relaxed">
                                <span className="text-blue-400 font-semibold">🤖 Filter ketat:</span> WR ≥55%, min 8 trade, aktif dalam 3 hari, skor ≥60.
                                Simulasi P&L otomatis dijalankan sebelum setiap copy trade.
                                Candidate yang memiliki estimasi profit rendah &amp; risiko tinggi akan diblokir otomatis.
                            </p>
                        </div>
                    </div>
                )}

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

            {/* Whale Detail Modal */}
            {detailTarget && (
                <WhaleDetailModal
                    apiUrl={apiUrl}
                    address={detailTarget.address}
                    name={detailTarget.name}
                    showActions={detailTarget.showActions}
                    onClose={() => setDetailTarget(null)}
                    onApprove={async (address) => { await handleApprove(address); }}
                    onReject={async (address) => { await handleReject(address); }}
                />
            )}
        </div>
    );
};

export default CopyWalletsModal;
