import React, { useEffect, useState, useCallback } from 'react';
import PositionCard from './PositionCard';
import ActivityLog from './ActivityLog';

interface Status {
    connected: boolean;
    copyStats: {
        activeWallets: number;
        dailyCopies: number;
        maxCopies: number;
        copyAmount: number;
        delaySeconds: number;
    };
    config: {
        flashblocksEnabled: boolean;
        SCAN_INTERVAL_MS: number;
    };
    openPositions: any[];
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
    aiEnabled: boolean;
}

type Tab = 'overview' | 'positions' | 'log';

interface DashboardProps {
    apiUrl: string;
}

const TAB_LIST: { id: Tab; label: string; icon: string }[] = [
    { id: 'overview',   label: 'Overview',  icon: '📊' },
    { id: 'positions',  label: 'Posisi',    icon: '💼' },
    { id: 'log',        label: 'Log',       icon: '📋' }
];

const Dashboard: React.FC<DashboardProps> = ({ apiUrl }) => {
    const [activeTab, setActiveTab] = useState<Tab>('overview');
    const [status, setStatus]       = useState<Status | null>(null);
    const [config, setConfig]       = useState<Config | null>(null);
    const [lastUpdate, setLastUpdate] = useState('');
    const [error, setError]         = useState('');

    const fetchData = useCallback(async () => {
        try {
            const [statusRes, configRes] = await Promise.all([
                fetch(`${apiUrl}/api/status`),
                fetch(`${apiUrl}/api/config`)
            ]);
            setStatus(await statusRes.json());
            setConfig(await configRes.json());
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

    const openCount = status?.openPositions?.length ?? 0;

    return (
        <div className="min-h-screen bg-gray-950 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-5 pb-3">
                <div className="flex items-center gap-3">
                    <span className="text-3xl">🔥</span>
                    <div>
                        <h1 className="text-xl font-bold text-white leading-tight">Base Sniper</h1>
                        <p className="text-xs text-gray-500">Modal 0.006 ETH · 100rb</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${status?.connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                    <span className="text-xs text-gray-400">{status?.connected ? 'Live' : 'Offline'}</span>
                </div>
            </div>

            {error && (
                <div className="mx-4 mb-3 bg-red-900/30 border border-red-800 rounded-xl p-3 text-sm text-red-400">
                    {error}
                </div>
            )}

            {/* Tab Bar */}
            <div className="flex mx-4 mb-4 bg-gray-900 rounded-xl p-1 gap-1">
                {TAB_LIST.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all
                            ${activeTab === tab.id
                                ? 'bg-gray-700 text-white shadow'
                                : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        <span>{tab.icon}</span>
                        <span>{tab.label}</span>
                        {tab.id === 'positions' && openCount > 0 && (
                            <span className="bg-green-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                                {openCount}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 px-4 pb-6 overflow-y-auto">

                {/* ─── OVERVIEW ─── */}
                {activeTab === 'overview' && (
                    <div className="space-y-4">
                        {/* Stats Grid */}
                        <div className="grid grid-cols-2 gap-3">
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
                                <p className="text-xs text-gray-500 mb-1">Copy Hari Ini</p>
                                <p className="text-lg font-bold text-white">
                                    {status?.copyStats?.dailyCopies ?? '—'}
                                    <span className="text-sm text-gray-500"> / {config?.copyMaxPerDay || '—'}</span>
                                </p>
                                <p className="text-xs text-gray-600">transaksi</p>
                            </div>
                            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                                <p className="text-xs text-gray-500 mb-1">Posisi Terbuka</p>
                                <p className="text-lg font-bold text-white">{openCount}</p>
                                <p className="text-xs text-gray-600">aktif</p>
                            </div>
                        </div>

                        {/* Config Summary */}
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                            <h2 className="text-sm font-semibold text-gray-300 mb-3">Konfigurasi Aktif</h2>
                            <div className="space-y-2 text-sm">
                                {[
                                    { label: 'AI Trading',      value: config?.aiEnabled   ? '✓ Aktif' : '✗ Nonaktif', green: config?.aiEnabled },
                                    { label: 'Copy Trading',    value: config?.copyEnabled ? '✓ Aktif' : '✗ Nonaktif', green: config?.copyEnabled },
                                    { label: 'Jumlah Copy',     value: `${config?.copyAmount || '—'} ETH` },
                                    { label: 'Delay Copy',      value: `${config?.copyDelaySeconds || '—'} detik` },
                                    { label: 'Min Safety Score',value: `${config?.minSafetyScore || '—'}/100` },
                                    { label: 'Max Pool Age',    value: `${config?.maxPoolAgeSeconds || '—'}s` },
                                    { label: 'Flashblocks',     value: status?.config?.flashblocksEnabled ? '✓ Aktif' : '—', green: status?.config?.flashblocksEnabled }
                                ].map(({ label, value, green }) => (
                                    <div key={label} className="flex justify-between">
                                        <span className="text-gray-500">{label}</span>
                                        <span className={green != null ? (green ? 'text-green-400' : 'text-red-400') : 'text-white'}>
                                            {value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {lastUpdate && (
                            <p className="text-center text-xs text-gray-700">Update terakhir: {lastUpdate}</p>
                        )}
                    </div>
                )}

                {/* ─── POSITIONS ─── */}
                {activeTab === 'positions' && (
                    <PositionCard apiUrl={apiUrl} />
                )}

                {/* ─── LOG ─── */}
                {activeTab === 'log' && (
                    <ActivityLog apiUrl={apiUrl} />
                )}
            </div>
        </div>
    );
};

export default Dashboard;
