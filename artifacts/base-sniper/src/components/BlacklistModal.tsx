import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../lib/authFetch';

interface BlacklistEntry {
    address: string;
    addedAt: number;
    label?: string;
}

interface BlacklistModalProps {
    apiUrl: string;
    onClose: () => void;
}

const BlacklistModal: React.FC<BlacklistModalProps> = ({ apiUrl, onClose }) => {
    const [list, setList]           = useState<BlacklistEntry[]>([]);
    const [loading, setLoading]     = useState(true);
    const [addAddress, setAddAddress] = useState('');
    const [addLabel, setAddLabel]   = useState('');
    const [addError, setAddError]   = useState('');
    const [adding, setAdding]       = useState(false);
    const [removing, setRemoving]   = useState<string | null>(null);

    const fetchList = useCallback(async () => {
        try {
            const res = await authFetch(`${apiUrl}/api/blacklist`);
            const data = await res.json();
            setList(data.blacklist || []);
        } catch { }
        setLoading(false);
    }, [apiUrl]);

    useEffect(() => { fetchList(); }, [fetchList]);

    const handleAdd = async () => {
        setAddError('');
        const addr = addAddress.trim();
        if (!addr) { setAddError('Masukkan alamat token'); return; }
        if (!addr.match(/^0x[0-9a-fA-F]{40}$/)) {
            setAddError('Format alamat tidak valid — harus dimulai 0x dan 42 karakter');
            return;
        }
        setAdding(true);
        try {
            const res = await authFetch(`${apiUrl}/api/blacklist`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address: addr, label: addLabel.trim() || undefined })
            });
            const data = await res.json();
            if (!res.ok) { setAddError(data.error || 'Gagal menambahkan'); setAdding(false); return; }
            setList(data.blacklist || []);
            setAddAddress('');
            setAddLabel('');
        } catch { setAddError('Gagal menghubungi server'); }
        setAdding(false);
    };

    const handleRemove = async (address: string) => {
        setRemoving(address);
        try {
            const res = await authFetch(`${apiUrl}/api/blacklist/${address}`, { method: 'DELETE' });
            const data = await res.json();
            if (res.ok) setList(data.blacklist || []);
        } catch { }
        setRemoving(null);
    };

    const formatTime = (ts: number) => {
        const d = new Date(ts);
        return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }) +
            ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">

                {/* Header */}
                <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-2xl">
                    <div>
                        <h2 className="text-lg font-bold text-white">🚫 Blacklist Token</h2>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {list.length} token diblacklist · bot tidak akan pernah membeli ini
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-white text-2xl leading-none transition-colors"
                    >&times;</button>
                </div>

                <div className="p-5 space-y-5">

                    {/* Add form */}
                    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
                        <h3 className="text-sm font-semibold text-gray-200">➕ Blacklist Token Baru</h3>
                        <input
                            type="text"
                            value={addAddress}
                            onChange={e => { setAddAddress(e.target.value); setAddError(''); }}
                            onKeyDown={e => e.key === 'Enter' && handleAdd()}
                            placeholder="0x... (contract address token)"
                            className="w-full bg-gray-900 border border-gray-700 focus:border-red-500 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 text-sm font-mono focus:outline-none transition-colors"
                        />
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={addLabel}
                                onChange={e => setAddLabel(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                                placeholder="Label (opsional, cth: SCAM, Honeypot)"
                                className="flex-1 bg-gray-900 border border-gray-700 focus:border-red-500 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 text-sm focus:outline-none transition-colors"
                            />
                            <button
                                onClick={handleAdd}
                                disabled={adding}
                                className="bg-red-700 hover:bg-red-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap flex items-center gap-1.5"
                            >
                                {adding ? (
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                                    </svg>
                                ) : '🚫 Blokir'}
                            </button>
                        </div>
                        {addError && (
                            <p className="text-xs text-red-400">{addError}</p>
                        )}
                    </div>

                    {/* List */}
                    <div className="space-y-2">
                        {loading ? (
                            <div className="text-center py-8 text-gray-600 text-sm">Memuat...</div>
                        ) : list.length === 0 ? (
                            <div className="text-center py-10 space-y-2">
                                <p className="text-3xl">✅</p>
                                <p className="text-gray-500 text-sm">Blacklist kosong</p>
                                <p className="text-gray-700 text-xs">Tambahkan token yang ingin diblokir permanen</p>
                            </div>
                        ) : list.map(entry => (
                            <div
                                key={entry.address}
                                className="bg-red-950/20 border border-red-900/40 rounded-xl px-4 py-3 flex items-center gap-3"
                            >
                                <span className="text-red-500 text-base flex-shrink-0">🚫</span>
                                <div className="flex-1 min-w-0">
                                    {entry.label && (
                                        <p className="text-sm font-semibold text-red-300 truncate">{entry.label}</p>
                                    )}
                                    <p className="text-xs text-gray-400 font-mono truncate">{entry.address}</p>
                                    <p className="text-xs text-gray-600 mt-0.5">Ditambahkan {formatTime(entry.addedAt)}</p>
                                </div>
                                <button
                                    onClick={() => handleRemove(entry.address)}
                                    disabled={removing === entry.address}
                                    title="Hapus dari blacklist"
                                    className="flex-shrink-0 text-gray-600 hover:text-green-400 transition-colors disabled:opacity-40 text-base"
                                >
                                    {removing === entry.address ? (
                                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                                        </svg>
                                    ) : '✅'}
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Info */}
                    <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-xl p-4">
                        <div className="flex gap-3">
                            <span className="text-lg">⚡</span>
                            <div className="text-xs text-yellow-300/80 leading-relaxed space-y-1">
                                <p>Token yang diblacklist <span className="font-semibold text-yellow-300">langsung aktif</span> tanpa restart server.</p>
                                <p>Bot tidak akan membeli token ini melalui screener maupun sniper.</p>
                                <p className="text-yellow-500">Token yang kena stop loss otomatis juga masuk blacklist ini.</p>
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

export default BlacklistModal;
