import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../lib/authFetch';

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

interface CopyWalletsModalProps {
    apiUrl: string;
    onClose: () => void;
}

function winRateColor(wr: number, trades: number): string {
    if (trades === 0) return 'text-gray-500 border-gray-700 bg-gray-800/40';
    if (wr >= 60)    return 'text-green-400 border-green-800 bg-green-900/30';
    if (wr >= 40)    return 'text-yellow-400 border-yellow-800 bg-yellow-900/20';
    return 'text-red-400 border-red-800 bg-red-900/20';
}

const CopyWalletsModal: React.FC<CopyWalletsModalProps> = ({ apiUrl, onClose }) => {
    const [wallets, setWallets]         = useState<Wallet[]>([]);
    const [loading, setLoading]         = useState(true);
    const [addAddress, setAddAddress]   = useState('');
    const [addLabel, setAddLabel]       = useState('');
    const [addError, setAddError]       = useState('');
    const [adding, setAdding]           = useState(false);
    const [editingAddr, setEditingAddr] = useState<string | null>(null);
    const [editName, setEditName]       = useState('');

    const fetchWallets = useCallback(async () => {
        try {
            const res = await authFetch(`${apiUrl}/api/wallets`);
            const data = await res.json();
            setWallets(data.wallets || []);
        } catch { }
        setLoading(false);
    }, [apiUrl]);

    useEffect(() => { fetchWallets(); }, [fetchWallets]);

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

    const startEdit = (w: Wallet) => {
        setEditingAddr(w.address);
        setEditName(w.name);
    };

    const activeCount   = wallets.filter(w => w.isActive).length;
    const pausedByBot   = wallets.filter(w => w.autoPaused).length;

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">

                {/* Header */}
                <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-2xl">
                    <div>
                        <h2 className="text-lg font-bold text-white">🐋 Whale Wallets</h2>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {activeCount} aktif · {wallets.length} total
                            {pausedByBot > 0 && (
                                <span className="ml-2 text-orange-400">· {pausedByBot} auto-paused</span>
                            )}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none transition-colors">&times;</button>
                </div>

                <div className="p-5 space-y-5">

                    {/* Add wallet form */}
                    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
                        <h3 className="text-sm font-semibold text-gray-200">➕ Tambah Whale Baru</h3>
                        <div>
                            <input
                                type="text"
                                value={addAddress}
                                onChange={e => { setAddAddress(e.target.value); setAddError(''); }}
                                placeholder="0x... (alamat wallet)"
                                className="w-full bg-gray-900 border border-gray-700 focus:border-green-500 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 text-sm font-mono focus:outline-none transition-colors"
                            />
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={addLabel}
                                onChange={e => setAddLabel(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                                placeholder="Label (opsional, cth: Alpha Whale)"
                                className="flex-1 bg-gray-900 border border-gray-700 focus:border-green-500 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 text-sm focus:outline-none transition-colors"
                            />
                            <button
                                onClick={handleAdd}
                                disabled={adding}
                                className="bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap flex items-center gap-1.5"
                            >
                                {adding ? (
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                                    </svg>
                                ) : '+ Tambah'}
                            </button>
                        </div>
                        {addError && (
                            <p className="text-xs text-red-400">{addError}</p>
                        )}
                    </div>

                    {/* Wallet list */}
                    <div className="space-y-3">
                        {loading ? (
                            <div className="text-center py-8 text-gray-600 text-sm">Memuat...</div>
                        ) : wallets.length === 0 ? (
                            <div className="text-center py-8 text-gray-600 text-sm">
                                Belum ada whale wallet.<br />Tambahkan di atas untuk mulai copy trading.
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
                                    {/* Active toggle */}
                                    <button
                                        onClick={() => handleToggle(w.address, w.isActive)}
                                        title={w.isActive ? 'Jeda wallet' : 'Aktifkan wallet'}
                                        className={`mt-0.5 flex-shrink-0 w-9 h-5 rounded-full transition-colors relative ${w.isActive ? 'bg-green-600' : 'bg-gray-700'}`}
                                    >
                                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${w.isActive ? 'left-4' : 'left-0.5'}`} />
                                    </button>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        {editingAddr === w.address ? (
                                            <div className="flex gap-2 mb-1">
                                                <input
                                                    autoFocus
                                                    value={editName}
                                                    onChange={e => setEditName(e.target.value)}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') handleRename(w.address);
                                                        if (e.key === 'Escape') setEditingAddr(null);
                                                    }}
                                                    className="flex-1 bg-gray-900 border border-green-500 rounded-lg px-3 py-1 text-white text-sm focus:outline-none"
                                                />
                                                <button onClick={() => handleRename(w.address)} className="text-green-400 hover:text-green-300 text-xs px-2">✓</button>
                                                <button onClick={() => setEditingAddr(null)} className="text-gray-500 hover:text-gray-300 text-xs px-1">✗</button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                <span className="text-sm font-semibold text-white truncate">{w.name}</span>
                                                <button
                                                    onClick={() => startEdit(w)}
                                                    className="text-gray-600 hover:text-gray-400 text-xs flex-shrink-0 transition-colors"
                                                    title="Ganti nama"
                                                >✏️</button>
                                                {w.autoPaused && (
                                                    <span className="text-xs px-2 py-0.5 rounded-full border bg-orange-900/40 text-orange-400 border-orange-700 flex-shrink-0">
                                                        ⏸ Auto-paused
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        <p className="text-xs text-gray-500 font-mono truncate">{w.address}</p>

                                        {/* Per-whale stats row */}
                                        {w.copiedTrades > 0 ? (
                                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                                                {/* Win rate badge */}
                                                <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${winRateColor(w.winRate, w.copiedTrades)}`}>
                                                    {w.winRate.toFixed(0)}% WR
                                                </span>
                                                {/* Trade count */}
                                                <span className="text-xs text-gray-500">
                                                    {w.wins}W / {w.losses}L
                                                </span>
                                                {/* Total PnL */}
                                                <span className={`text-xs font-medium ${w.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                    {w.totalPnL >= 0 ? '+' : ''}{w.totalPnL.toFixed(1)}% P&L
                                                </span>
                                            </div>
                                        ) : (
                                            <p className="text-xs text-gray-600 mt-1.5 italic">Belum ada copy trade tercatat</p>
                                        )}

                                        {/* Auto-pause hint */}
                                        {w.autoPaused && (
                                            <p className="text-xs text-orange-500/80 mt-1">
                                                Win rate turun di bawah 30% — toggle untuk aktifkan kembali
                                            </p>
                                        )}

                                        {w.lastBuyToken && !w.autoPaused && (
                                            <p className="text-xs text-gray-600 mt-1">
                                                Terakhir beli: <span className="text-gray-500 font-mono">{w.lastBuyToken.slice(0, 12)}...</span>
                                            </p>
                                        )}
                                    </div>

                                    {/* Status & delete */}
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <span className={`text-xs px-2 py-0.5 rounded-full border ${
                                            w.autoPaused
                                                ? 'bg-orange-900/30 text-orange-400 border-orange-800'
                                                : w.isActive
                                                    ? 'bg-green-900/40 text-green-400 border-green-800'
                                                    : 'bg-gray-800 text-gray-500 border-gray-700'
                                        }`}>
                                            {w.autoPaused ? 'Auto-Pause' : w.isActive ? 'Aktif' : 'Jeda'}
                                        </span>
                                        <button
                                            onClick={() => handleRemove(w.address)}
                                            className="text-gray-600 hover:text-red-400 text-base transition-colors"
                                            title="Hapus wallet"
                                        >🗑️</button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Info box */}
                    <div className="bg-blue-900/20 border border-blue-800/40 rounded-xl p-4 space-y-2">
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

export default CopyWalletsModal;
