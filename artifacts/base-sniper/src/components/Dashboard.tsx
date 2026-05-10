import React, { useEffect, useState, useCallback } from 'react';
import PositionCard from './PositionCard';
import ActivityLog from './ActivityLog';
import Portfolio from './Portfolio';
import Modal100k, { ModalSettings } from './Modal100k';
import WalletConfigModal from './WalletConfigModal';
import CopyWalletsModal from './CopyWalletsModal';
import WalletMonitorPage from './WalletMonitorPage';
import BlacklistModal from './BlacklistModal';
import TradeHistory from './TradeHistory';
import WhaleLeaderboard from './WhaleLeaderboard';
import Backtest from './Backtest';
import DailyReport from './DailyReport';
import PushNotification from './PushNotification';
import { authFetch } from '../lib/authFetch';

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
    pendingWhales: number;
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
    serialRuggerEnabled:    boolean;
    serialRuggerMaxDeploys: string;
    serialRuggerWindowHours: string;
    reputationEnabled:  boolean;
    reputationMinScore: string;
    dynamicSizingEnabled: boolean;
    tradeBalancePct: string;
    geckoScannerEnabled: boolean;
    whaleValidationEnabled: boolean;
    whaleAutoScanEnabled: boolean;
}

type Tab = 'overview' | 'portfolio' | 'positions' | 'log' | 'history' | 'backtest' | 'report';

interface DashboardProps {
    apiUrl: string;
}

const TAB_LIST: { id: Tab; label: string; icon: string }[] = [
    { id: 'overview',  label: 'Overview',  icon: '📊' },
    { id: 'portfolio', label: 'Portfolio', icon: '👜' },
    { id: 'positions', label: 'Posisi',    icon: '💼' },
    { id: 'log',       label: 'Log',       icon: '📋' },
    { id: 'history',   label: 'Histori',   icon: '📈' },
    { id: 'report',    label: 'Laporan',   icon: '📉' },
    { id: 'backtest',  label: 'Backtest',  icon: '🔬' },
];

const Dashboard: React.FC<DashboardProps> = ({ apiUrl }) => {
    const [activeTab, setActiveTab]             = useState<Tab>('overview');
    const [status, setStatus]                   = useState<Status | null>(null);
    const [config, setConfig]                   = useState<Config | null>(null);
    const [lastUpdate, setLastUpdate]           = useState('');
    const [error, setError]                     = useState('');
    const [ethBalance, setEthBalance]           = useState<string | null>(null);
    const [showSettings, setShowSettings]       = useState(false);
    const [showWalletConfig, setShowWalletConfig]   = useState(false);
    const [showCopyWallets, setShowCopyWallets]     = useState(false);
    const [showMonitor, setShowMonitor]             = useState(false);
    const [showBlacklist, setShowBlacklist]         = useState(false);
    const [monitorCount, setMonitorCount]           = useState(0);
    const [saveStatus, setSaveStatus]           = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [emergencyLoading, setEmergencyLoading] = useState(false);
    const [emergencyDone, setEmergencyDone]       = useState(false);

    const fetchData = useCallback(async () => {
        try {
            const [statusRes, configRes] = await Promise.all([
                authFetch(`${apiUrl}/api/status`),
                authFetch(`${apiUrl}/api/config`)
            ]);
            setStatus(await statusRes.json());
            setConfig(await configRes.json());
            setLastUpdate(new Date().toLocaleTimeString('id-ID'));
            setError('');
        } catch {
            setError('Gagal terhubung ke server');
        }
    }, [apiUrl]);

    const fetchBalance = useCallback(async () => {
        try {
            const res  = await authFetch(`${apiUrl}/api/portfolio`);
            const json = await res.json();
            if (json.ethBalance) setEthBalance(parseFloat(json.ethBalance).toFixed(5));
        } catch { /* silent */ }
    }, [apiUrl]);

    const fetchMonitorCount = useCallback(async () => {
        try {
            const res  = await authFetch(`${apiUrl}/api/whale/monitored`);
            const data = await res.json();
            setMonitorCount((data.wallets || []).length);
        } catch { /* silent */ }
    }, [apiUrl]);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 3000);
        return () => clearInterval(interval);
    }, [fetchData]);

    useEffect(() => {
        fetchBalance();
        const interval = setInterval(fetchBalance, 30000);
        return () => clearInterval(interval);
    }, [fetchBalance]);

    useEffect(() => {
        fetchMonitorCount();
        const interval = setInterval(fetchMonitorCount, 15000);
        return () => clearInterval(interval);
    }, [fetchMonitorCount]);

    const handleSaveSettings = useCallback(async (settings: ModalSettings) => {
        setSaveStatus('saving');
        try {
            const res = await authFetch(`${apiUrl}/api/settings`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(settings)
            });
            if (!res.ok) throw new Error('Server error');
            setSaveStatus('saved');
            setShowSettings(false);
            await fetchData();
            setTimeout(() => setSaveStatus('idle'), 2000);
        } catch {
            setSaveStatus('error');
            setTimeout(() => setSaveStatus('idle'), 3000);
        }
    }, [apiUrl, fetchData]);

    const openCount = status?.openPositions?.length ?? 0;
    const currentCapital = config?.capital ? parseFloat(config.capital) : 0.006;

    const handleEmergencyStop = useCallback(async () => {
        if (!window.confirm('⚠️ EMERGENCY STOP: Ini akan menghentikan semua scanner dan menjual SEMUA posisi terbuka sekarang. Lanjutkan?')) return;
        setEmergencyLoading(true);
        try {
            const res  = await authFetch(`${apiUrl}/api/emergency-stop`, { method: 'POST' });
            const data = await res.json();
            setEmergencyDone(true);
            alert(`✅ ${data.message ?? 'Emergency stop berhasil'}`);
        } catch {
            alert('❌ Gagal mengirim emergency stop. Periksa koneksi ke server.');
        } finally {
            setEmergencyLoading(false);
        }
    }, [apiUrl]);

    return (
        <div className="min-h-screen bg-gray-950 flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-5 pb-3">
                <div className="flex items-center gap-3">
                    <span className="text-3xl">🔥</span>
                    <div>
                        <h1 className="text-xl font-bold text-white leading-tight">Base Sniper</h1>
                        {ethBalance !== null && (
                            <p className="text-xs text-green-400 font-medium">Ξ {ethBalance} ETH</p>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Connection status */}
                    <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${status?.connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                        <span className="text-xs text-gray-400">{status?.connected ? 'Live' : 'Offline'}</span>
                    </div>

                    {/* Blacklist button */}
                    <button
                        onClick={() => setShowBlacklist(true)}
                        className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white text-xs px-3 py-1.5 rounded-lg transition-all"
                    >
                        <span>🚫</span>
                        <span>Blokir</span>
                    </button>

                    {/* Copy wallets button */}
                    <button
                        onClick={() => setShowCopyWallets(true)}
                        className="relative flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white text-xs px-3 py-1.5 rounded-lg transition-all"
                    >
                        <span>🐋</span>
                        <span>Whale</span>
                        {(status?.pendingWhales ?? 0) > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 bg-blue-500 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                                {status!.pendingWhales}
                            </span>
                        )}
                    </button>

                    {/* Monitor button */}
                    <button
                        onClick={() => setShowMonitor(true)}
                        className="relative flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white text-xs px-3 py-1.5 rounded-lg transition-all"
                    >
                        <span>🔬</span>
                        <span>Monitor</span>
                        {monitorCount > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 bg-purple-500 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                                {monitorCount}
                            </span>
                        )}
                    </button>

                    {/* Push notification toggle */}
                    <PushNotification apiUrl={apiUrl} />

                    {/* Wallet config button */}
                    <button
                        onClick={() => setShowWalletConfig(true)}
                        className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white text-xs px-3 py-1.5 rounded-lg transition-all"
                    >
                        <span>🔑</span>
                        <span>Kunci</span>
                    </button>

                    {/* Settings button */}
                    <button
                        onClick={() => setShowSettings(true)}
                        className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white text-xs px-3 py-1.5 rounded-lg transition-all"
                    >
                        <span>⚙️</span>
                        <span>Atur</span>
                    </button>

                    {/* Emergency Stop button */}
                    <button
                        onClick={handleEmergencyStop}
                        disabled={emergencyLoading || emergencyDone || (status?.emergencyStop === true)}
                        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all font-semibold border
                            ${emergencyDone || status?.emergencyStop
                                ? 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed'
                                : 'bg-red-900/80 hover:bg-red-800 border-red-700 text-red-300 hover:text-white'
                            }`}
                        title="Hentikan semua scanner & jual semua posisi"
                    >
                        <span>{emergencyLoading ? '⏳' : emergencyDone || status?.emergencyStop ? '🔴' : '🚨'}</span>
                        <span>{emergencyDone || status?.emergencyStop ? 'STOPPED' : 'STOP'}</span>
                    </button>
                </div>
            </div>

            {/* Emergency stop active banner */}
            {(emergencyDone || status?.emergencyStop) && (
                <div className="mx-4 mb-2 bg-red-900/50 border border-red-700 rounded-xl px-4 py-2 text-sm text-red-300 text-center font-semibold">
                    🚨 EMERGENCY STOP AKTIF — Restart server API untuk melanjutkan trading
                </div>
            )}

            {/* Save feedback banner */}
            {saveStatus === 'saved' && (
                <div className="mx-4 mb-2 bg-green-900/40 border border-green-700 rounded-xl px-4 py-2 text-sm text-green-400 text-center">
                    ✅ Pengaturan berhasil disimpan
                </div>
            )}
            {saveStatus === 'error' && (
                <div className="mx-4 mb-2 bg-red-900/40 border border-red-700 rounded-xl px-4 py-2 text-sm text-red-400 text-center">
                    ❌ Gagal menyimpan — coba lagi
                </div>
            )}

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
                        className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium transition-all
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

                        {/* Pending whale candidates alert */}
                        {(status?.pendingWhales ?? 0) > 0 && (
                            <button
                                onClick={() => setShowCopyWallets(true)}
                                className="w-full flex items-center gap-3 bg-blue-900/30 border border-blue-700/60 rounded-xl px-4 py-3 text-left hover:bg-blue-900/50 transition-colors"
                            >
                                <span className="text-xl">🐋</span>
                                <div className="flex-1">
                                    <p className="text-sm font-semibold text-blue-300">
                                        {status!.pendingWhales} Whale Kandidat Menunggu
                                    </p>
                                    <p className="text-xs text-blue-400/70 mt-0.5">Buka Whale Manager → Auto Finder untuk setujui atau tolak</p>
                                </div>
                                <span className="text-blue-400 text-xs">→</span>
                            </button>
                        )}

                        <div className="grid grid-cols-2 gap-3">
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

                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-sm font-semibold text-gray-300">Konfigurasi Aktif</h2>
                                <button
                                    onClick={() => setShowSettings(true)}
                                    className="text-xs text-green-400 hover:text-green-300 transition-colors"
                                >
                                    Edit ✏️
                                </button>
                            </div>
                            <div className="space-y-2 text-sm">
                                {[
                                    { label: 'AI Trading',        value: config?.aiEnabled         ? '✓ Aktif' : '✗ Nonaktif', green: config?.aiEnabled         },
                                    { label: 'Copy Trading',      value: config?.copyEnabled       ? '✓ Aktif' : '✗ Nonaktif', green: config?.copyEnabled       },
                                    { label: 'Dynamic Sizing',    value: config?.dynamicSizingEnabled ? `✓ ${config.tradeBalancePct || 10}% per trade` : '✗ Nonaktif', green: config?.dynamicSizingEnabled },
                                    { label: 'GeckoTerminal Scan',value: config?.geckoScannerEnabled  ? '✓ Aktif' : '✗ Nonaktif', green: config?.geckoScannerEnabled },
                                    { label: 'Auto Whale Finder', value: config?.whaleAutoScanEnabled ? '✓ Aktif' : '✗ Nonaktif', green: config?.whaleAutoScanEnabled },
                                    { label: 'Jumlah Copy',       value: `${config?.copyAmount || '—'} ETH`                },
                                    { label: 'Delay Copy',        value: `${config?.copyDelaySeconds || '—'} detik`          },
                                    { label: 'Min Safety Score',  value: `${config?.minSafetyScore || '—'}/100`             },
                                    { label: 'Serial Rugger',     value: config?.serialRuggerEnabled ? `✓ Aktif (>${config.serialRuggerMaxDeploys}x/${config.serialRuggerWindowHours}j)` : '✗ Nonaktif', green: config?.serialRuggerEnabled },
                                    { label: 'Reputasi Deployer', value: config?.reputationEnabled  ? `✓ Aktif (min ${config.reputationMinScore}/100)` : '✗ Nonaktif', green: config?.reputationEnabled }
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

                        <WhaleLeaderboard apiUrl={apiUrl} />

                        {lastUpdate && (
                            <p className="text-center text-xs text-gray-700">Update terakhir: {lastUpdate}</p>
                        )}
                    </div>
                )}

                {/* ─── PORTFOLIO ─── */}
                {activeTab === 'portfolio' && <Portfolio apiUrl={apiUrl} />}

                {/* ─── POSITIONS ─── */}
                {activeTab === 'positions' && <PositionCard apiUrl={apiUrl} />}

                {/* ─── LOG ─── */}
                {activeTab === 'log' && <ActivityLog apiUrl={apiUrl} />}

                {/* ─── HISTORY ─── */}
                {activeTab === 'history' && <TradeHistory apiUrl={apiUrl} />}

                {/* ─── LAPORAN P&L ─── */}
                {activeTab === 'report' && <DailyReport apiUrl={apiUrl} />}

                {/* ─── BACKTEST ─── */}
                {activeTab === 'backtest' && <Backtest apiUrl={apiUrl} />}
            </div>

            {/* Settings Modal */}
            {showSettings && (
                <Modal100k
                    currentBalance={currentCapital}
                    onClose={() => setShowSettings(false)}
                    onSave={handleSaveSettings}
                />
            )}

            {/* Wallet & API Key Config Modal */}
            {showWalletConfig && (
                <WalletConfigModal
                    apiUrl={apiUrl}
                    onClose={() => setShowWalletConfig(false)}
                />
            )}

            {/* Copy Wallets Manager */}
            {showCopyWallets && (
                <CopyWalletsModal
                    apiUrl={apiUrl}
                    onClose={() => setShowCopyWallets(false)}
                />
            )}

            {/* Blacklist Manager */}
            {showBlacklist && (
                <BlacklistModal
                    apiUrl={apiUrl}
                    onClose={() => setShowBlacklist(false)}
                />
            )}

            {/* Wallet Monitor Manager */}
            {showMonitor && (
                <WalletMonitorPage
                    apiUrl={apiUrl}
                    onClose={() => { setShowMonitor(false); fetchMonitorCount(); }}
                />
            )}

            {/* Full-screen saving overlay */}
            {saveStatus === 'saving' && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
                    <div className="bg-gray-900 border border-gray-700 rounded-2xl px-8 py-6 flex items-center gap-4">
                        <svg className="animate-spin h-5 w-5 text-green-400" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                        <span className="text-white text-sm font-medium">Menyimpan pengaturan...</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;
