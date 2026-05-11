import React, { useEffect, useState, useCallback } from 'react';
import { authFetch } from '../lib/authFetch';

interface DeploymentInfo {
    version: string;
    startedAt: number;
    uptimeMs: number;
    uptimeStr: string;
    productionUrl: string | null;
    nodeVersion: string;
    environment: string;
    network: string;
    port: number | string;
}

interface Props {
    apiUrl: string;
}

function formatUptime(ms: number): string {
    const totalSecs = Math.floor(ms / 1000);
    const days    = Math.floor(totalSecs / 86400);
    const hours   = Math.floor((totalSecs % 86400) / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;
    if (days > 0)    return `${days}h ${hours}j ${minutes}m`;
    if (hours > 0)   return `${hours}j ${minutes}m ${seconds}d`;
    if (minutes > 0) return `${minutes}m ${seconds}d`;
    return `${seconds}d`;
}

const DeploymentStatus: React.FC<Props> = ({ apiUrl }) => {
    const [data, setData]       = useState<DeploymentInfo | null>(null);
    const [error, setError]     = useState(false);
    const [now, setNow]         = useState(Date.now());
    const [copied, setCopied]   = useState(false);

    const fetch_ = useCallback(async () => {
        try {
            const res  = await authFetch(`${apiUrl}/api/deployment-status`);
            const json = await res.json();
            if (json.error) { setError(true); return; }
            setData(json);
            setError(false);
        } catch {
            setError(true);
        }
    }, [apiUrl]);

    useEffect(() => {
        fetch_();
        const interval = setInterval(fetch_, 10000);
        return () => clearInterval(interval);
    }, [fetch_]);

    useEffect(() => {
        const tick = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(tick);
    }, []);

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const liveUptime = data ? formatUptime(now - data.startedAt) : '—';

    const startedAtFormatted = data
        ? new Date(data.startedAt).toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
          })
        : '—';

    const networkShort = data?.network
        ? data.network.replace('https://', '').replace('http://', '')
        : '—';

    const isProduction = data?.environment === 'production';
    const envColor = isProduction ? 'text-green-400' : 'text-yellow-400';
    const envBg    = isProduction ? 'bg-green-900/30 border-green-800' : 'bg-yellow-900/20 border-yellow-800/50';

    return (
        <div className="space-y-4 pb-4">

            {/* Header */}
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                    <span>🚀</span> Status Deployment
                </h2>
                {data && (
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${envBg} ${envColor}`}>
                        {data.environment}
                    </span>
                )}
            </div>

            {error && (
                <div className="bg-red-900/30 border border-red-800 rounded-xl p-3 text-sm text-red-400">
                    Gagal mengambil data deployment. Periksa koneksi ke server.
                </div>
            )}

            {/* Bot Version & Uptime */}
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Versi Bot</p>
                    <p className="text-2xl font-bold text-white font-mono">
                        v{data?.version ?? '—'}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">Base Sniper Ultimate</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Uptime</p>
                    <p className="text-2xl font-bold text-green-400 font-mono">
                        {data ? liveUptime : '—'}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">sejak restart terakhir</p>
                </div>
            </div>

            {/* Started At */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-2">Server Dimulai</p>
                <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-white">{startedAtFormatted}</p>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-xs text-green-400">Online</span>
                    </div>
                </div>
            </div>

            {/* Production URL */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-2">URL Produksi</p>
                {data?.productionUrl ? (
                    <div className="flex items-center gap-2">
                        <a
                            href={data.productionUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 text-sm font-mono text-blue-400 hover:text-blue-300 underline truncate transition-colors"
                        >
                            {data.productionUrl}
                        </a>
                        <button
                            onClick={() => handleCopy(data.productionUrl!)}
                            className="flex-shrink-0 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-white px-2.5 py-1.5 rounded-lg transition-all"
                        >
                            {copied ? '✓ Disalin' : '📋 Salin'}
                        </button>
                    </div>
                ) : (
                    <p className="text-sm text-gray-500 italic">
                        Tidak tersedia — jalankan di Replit untuk mendapatkan URL produksi
                    </p>
                )}
            </div>

            {/* System Info */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-3">Informasi Sistem</p>
                <div className="space-y-2">
                    {[
                        { label: 'Node.js',   value: data?.nodeVersion ?? '—' },
                        { label: 'Port',      value: data?.port ? `${data.port}` : '—' },
                        { label: 'Network',   value: networkShort },
                    ].map(({ label, value }) => (
                        <div key={label} className="flex justify-between items-center py-1 border-b border-gray-800/60 last:border-0">
                            <span className="text-xs text-gray-500">{label}</span>
                            <span className="text-xs font-mono font-medium text-white">{value}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Live ticker */}
            <p className="text-center text-xs text-gray-700">
                Diperbarui otomatis setiap 10 detik · {new Date(now).toLocaleTimeString('id-ID')}
            </p>
        </div>
    );
};

export default DeploymentStatus;
