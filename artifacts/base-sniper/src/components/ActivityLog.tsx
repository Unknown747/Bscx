import React, { useEffect, useState, useCallback } from 'react';
import DeployerCard from './DeployerCard';
import { authFetch } from '../lib/authFetch';

interface LogEntry {
    id: string;
    type: 'buy-success' | 'buy-failed' | 'sell-success' | 'take-profit' | 'stop-loss' | 'copy-trade' | 'info';
    message: string;
    detail?: string;
    timestamp: number;
}

interface ActivityLogProps {
    apiUrl: string;
}

const TYPE_CONFIG: Record<LogEntry['type'], { icon: string; color: string; label: string }> = {
    'buy-success':  { icon: '🟢', color: 'text-green-400',  label: 'BUY'        },
    'buy-failed':   { icon: '🔴', color: 'text-red-400',    label: 'GAGAL'      },
    'sell-success': { icon: '💰', color: 'text-yellow-400', label: 'SELL'       },
    'take-profit':  { icon: '🎯', color: 'text-green-300',  label: 'TAKE PROFIT'},
    'stop-loss':    { icon: '🛑', color: 'text-red-500',    label: 'STOP LOSS'  },
    'copy-trade':   { icon: '🐋', color: 'text-blue-400',   label: 'COPY'       },
    'info':         { icon: '📋', color: 'text-gray-400',   label: 'INFO'       }
};

// Extract the first Ethereum address (0x + 40 hex chars) from a string
const ADDRESS_RE = /0x[0-9a-fA-F]{40}/;
function extractAddress(text: string): string | null {
    const m = text.match(ADDRESS_RE);
    return m ? m[0] : null;
}

function timeAgo(ts: number): string {
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60)    return `${secs}s lalu`;
    if (secs < 3600)  return `${Math.floor(secs / 60)}m lalu`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}j lalu`;
    return new Date(ts).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

const ActivityLog: React.FC<ActivityLogProps> = ({ apiUrl }) => {
    const [logs,           setLogs]           = useState<LogEntry[]>([]);
    const [error,          setError]          = useState('');
    const [,               setTick]           = useState(0);
    const [inspectAddress, setInspectAddress] = useState<string | null>(null);

    const fetchLogs = useCallback(async () => {
        try {
            const res  = await authFetch(`${apiUrl}/api/logs`);
            const json = await res.json();
            setLogs(json.logs ?? []);
            setError('');
        } catch {
            setError('Gagal memuat log');
        }
    }, [apiUrl]);

    useEffect(() => {
        fetchLogs();
        const interval = setInterval(fetchLogs, 5000);
        return () => clearInterval(interval);
    }, [fetchLogs]);

    // Tick every 30s to update "x menit lalu" labels
    useEffect(() => {
        const t = setInterval(() => setTick(n => n + 1), 30000);
        return () => clearInterval(t);
    }, []);

    return (
        <>
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-gray-300">Log Aktivitas</h2>
                    <span className="text-xs text-gray-600">{logs.length} entri</span>
                </div>

                {error && (
                    <div className="bg-red-900/30 border border-red-800 rounded-xl p-3 text-xs text-red-400">
                        {error}
                    </div>
                )}

                {!error && logs.length === 0 && (
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
                        <p className="text-2xl mb-2">📭</p>
                        <p className="text-sm text-gray-500">Belum ada aktivitas</p>
                        <p className="text-xs text-gray-700 mt-1">Log trade akan muncul di sini</p>
                    </div>
                )}

                <div className="space-y-2">
                    {logs.map((entry) => {
                        const cfg = TYPE_CONFIG[entry.type] ?? TYPE_CONFIG['info'];

                        // Try to find an inspectable address in the message or detail
                        const inspectable =
                            (entry.detail  && extractAddress(entry.detail))  ||
                            (entry.message && extractAddress(entry.message))  ||
                            null;

                        return (
                            <div
                                key={entry.id}
                                className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-start gap-3"
                            >
                                <span className="text-base mt-0.5 shrink-0">{cfg.icon}</span>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                                        <span className="text-xs text-gray-600">{timeAgo(entry.timestamp)}</span>
                                    </div>
                                    <p className="text-sm text-white leading-snug">{entry.message}</p>
                                    {entry.detail && (
                                        <p className="text-xs text-gray-500 mt-0.5 truncate">{entry.detail}</p>
                                    )}
                                </div>

                                {/* Inspect button — only shown when a token/deployer address is found */}
                                {inspectable && (
                                    <button
                                        onClick={() => setInspectAddress(inspectable)}
                                        title="Lihat profil deployer"
                                        className="flex-shrink-0 mt-0.5 text-xs text-purple-400 hover:text-purple-300 bg-purple-900/30 hover:bg-purple-900/50 border border-purple-800/40 hover:border-purple-700 px-2 py-1 rounded-lg transition-colors"
                                    >
                                        🔍
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* DeployerCard overlay */}
            {inspectAddress && (
                <DeployerCard
                    address={inspectAddress}
                    apiUrl={apiUrl}
                    onClose={() => setInspectAddress(null)}
                />
            )}
        </>
    );
};

export default ActivityLog;
