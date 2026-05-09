import React, { useEffect, useState, useCallback } from 'react';
import PositionCard from './PositionCard';

interface Status {
    connected: boolean;
    copyStats: {
        totalCopied: number;
        todayCopied: number;
        successRate: number;
    };
    config: {
        scanInterval: number;
        flashblocksEnabled: boolean;
    };
    timestamp: number;
}

interface Config {
    capital: string;
    maxTrade: string;
    copyEnabled: boolean;
    copyAmount: string;
    copyDelaySeconds: string;
    copyMaxPerDay: string;
    minSafetyScore: string;
    maxPoolAgeSeconds: string;
}

interface DashboardProps {
    apiUrl: string;
}

const Dashboard: React.FC<DashboardProps> = ({ apiUrl }) => {
    const [status, setStatus] = useState<Status | null>(null);
    const [config, setConfig] = useState<Config | null>(null);
    const [lastUpdate, setLastUpdate] = useState<string>('');
    const [error, setError] = useState<string>('');

    const fetchData = useCallback(async () => {
        try {
            const [statusRes, configRes] = await Promise.all([
                fetch(`${apiUrl}/api/status`),
                fetch(`${apiUrl}/api/config`)
            ]);
            const statusData = await statusRes.json();
            const configData = await configRes.json();
            setStatus(statusData);
            setConfig(configData);
            setLastUpdate(new Date().toLocaleTimeString('id-ID'));
            setError('');
        } catch {
            setError('Gagal terhubung ke server');
        }
    }, [apiUrl]);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 3000);
        return () => clearInterval(interval);
    }, [fetchData]);

    return (
        <div className="min-h-screen bg-gray-950 p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <span className="text-3xl">🔥</span>
                    <div>
                        <h1 className="text-xl font-bold text-white">Base Sniper Ultimate</h1>
                        <p className="text-xs text-gray-500">Modal 100rb · 0.006 ETH</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${status?.connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                    <span className="text-xs text-gray-400">
                        {status?.connected ? 'Live' : 'Offline'}
                    </span>
                </div>
            </div>

            {error && (
                <div className="bg-red-900/30 border border-red-800 rounded-xl p-3 mb-4 text-sm text-red-400">
                    {error}
                </div>
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Modal Total</p>
                    <p className="text-lg font-bold text-green-400">{config?.capital || '—'} ETH</p>
                    <p className="text-xs text-gray-600">≈ Rp 100.000</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Max Per Trade</p>
                    <p className="text-lg font-bold text-yellow-400">{config?.maxTrade || '—'} ETH</p>
                    <p className="text-xs text-gray-600">10% dari modal</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Copy Trade Hari Ini</p>
                    <p className="text-lg font-bold text-white">
                        {status?.copyStats?.todayCopied ?? '—'}
                        <span className="text-sm text-gray-500"> / {config?.copyMaxPerDay || '—'}</span>
                    </p>
                    <p className="text-xs text-gray-600">transaksi</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1">Success Rate</p>
                    <p className="text-lg font-bold text-white">
                        {status?.copyStats?.successRate != null
                            ? `${status.copyStats.successRate.toFixed(1)}%`
                            : '—'}
                    </p>
                    <p className="text-xs text-gray-600">copy trade</p>
                </div>
            </div>

            {/* Config Summary */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
                <h2 className="text-sm font-semibold text-gray-300 mb-3">Konfigurasi Aktif</h2>
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="text-gray-500">Copy Trading</span>
                        <span className={config?.copyEnabled ? 'text-green-400' : 'text-red-400'}>
                            {config?.copyEnabled ? '✓ Aktif' : '✗ Nonaktif'}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-500">Jumlah Copy</span>
                        <span className="text-white">{config?.copyAmount || '—'} ETH</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-500">Delay Copy</span>
                        <span className="text-white">{config?.copyDelaySeconds || '—'} detik</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-500">Min Safety Score</span>
                        <span className="text-white">{config?.minSafetyScore || '—'}/100</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-500">Max Pool Age</span>
                        <span className="text-white">{config?.maxPoolAgeSeconds || '—'} detik</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-500">Flashblocks</span>
                        <span className={status?.config?.flashblocksEnabled ? 'text-green-400' : 'text-gray-500'}>
                            {status?.config?.flashblocksEnabled ? '✓ Aktif' : '—'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Posisi Terbuka */}
            <div className="mb-4">
                <PositionCard apiUrl={apiUrl} />
            </div>

            {/* Footer */}
            {lastUpdate && (
                <p className="text-center text-xs text-gray-700">
                    Update terakhir: {lastUpdate}
                </p>
            )}
        </div>
    );
};

export default Dashboard;
