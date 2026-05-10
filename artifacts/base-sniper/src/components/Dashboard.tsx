import React, { useEffect, useState, useCallback } from 'react';
import PositionCard from './PositionCard';
import ActivityLog from './ActivityLog';
import Portfolio from './Portfolio';
import SettingsModal from './SettingsModal';
import CopyWalletsModal from './CopyWalletsModal';
import WalletMonitorPage from './WalletMonitorPage';
import VettedWalletsPage from './VettedWalletsPage';
import BlacklistModal from './BlacklistModal';
import TradeHistory from './TradeHistory';
import WhaleLeaderboard from './WhaleLeaderboard';
import Backtest from './Backtest';
import DailyReport from './DailyReport';
import SmartScreener from './SmartScreener';
import PushNotification from './PushNotification';
import { authFetch } from '../lib/authFetch';
import { usePwaInstall } from '../hooks/usePwaInstall';

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
    emergencyStop: boolean;
    lastTradeAt: number | null;
    timestamp: number;
}

interface Config {
    capital: string;
    maxTrade: string;
    minLiquidity: string;
    maxSlippage: string;
    copyEnabled: boolean;
    copyAmount: string;
    copyDelaySeconds: string;
    copyMaxPerDay: string;
    minSafetyScore: string;
    maxPoolAgeSeconds: string;
    aiEnabled: boolean;
    tp1Multiplier: number;
    tp1Percentage: number;
    tp2Multiplier: number;
    tp2Percentage: number;
    stopLoss: number;
    maxPriorityFee: string;
    maxFeePerGas: string;
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
    blockHoneypot: boolean;
    blockHighTax: boolean;
    maxTaxPercent: string;
    minAiConfidence: string;
    enableFlashblocks: boolean;
    gasMode: string;
    dcaEnabled: boolean;
}

type Tab = 'overview' | 'portfolio' | 'positions' | 'log' | 'history' | 'backtest' | 'report' | 'screener';

interface DashboardProps {
    apiUrl: string;
}

const TAB_LIST: { id: Tab; label: string; icon: string }[] = [
    { id: 'overview',  label: 'Overview',  icon: '📊' },
    { id: 'screener',  label: 'Screener',  icon: '📡' },
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
    const [todayPnl, setTodayPnl]               = useState<{ eth: number; pct: number } | null>(null);
    const [showSettings, setShowSettings]       = useState(false);
    const { canInstall, install }               = usePwaInstall();
    const [showCopyWallets, setShowCopyWallets]     = useState(false);
    const [showMonitor, setShowMonitor]             = useState(false);
    const [showVetted, setShowVetted]               = useState(false);
    const [showBlacklist, setShowBlacklist]         = useState(false);
    const [monitorCount, setMonitorCount]           = useState(0);
    const [vettedCount, setVettedCount]             = useState(0);
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
        } catch { }
    }, [apiUrl]);

    const fetchMonitorCount = useCallback(async () => {
        try {
            const res  = await authFetch(`${apiUrl}/api/whale/monitored`);
            const data = await res.json();
            const ws   = data.wallets || [];
            setMonitorCount(ws.length);
            setVettedCount(ws.filter((w: any) => w.aiVerdict === 'approved').length);
        } catch { }
    }, [apiUrl]);

    const fetchTodayPnl = useCallback(async () => {
        try {
            const res  = await authFetch(`${apiUrl}/api/report`);
            const data = await res.json();
            const today = data?.today;
            if (today) {
                setTodayPnl({
                    eth: parseFloat(today.profitEth ?? today.profit ?? 0),
                    pct: parseFloat(today.profitPct ?? today.winRate ?? 0),
                });
            }
        } catch { }
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

    useEffect(() => {
        fetchTodayPnl();
        const interval = setInterval(fetchTodayPnl, 30000);
        return () => clearInterval(interval);
    }, [fetchTodayPnl]);


    const openCount = status?.openPositions?.length ?? 0;

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

            {/* ── Header ── */}
            <div className="px-4 pt-4 pb-2 bg-gray-950 sticky top-0 z-10 border-b border-gray-900">
                {/* Top row: logo + status + STOP */}
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                        <span className="text-2xl">🔥</span>
                        <div>
                            <h1 className="text-base font-bold text-white leading-tight">Base Sniper</h1>
                            <div className="flex items-center gap-2">
                                {ethBalance !== null && (
                                    <p className="text-xs text-green-400 font-medium">Ξ {ethBalance}</p>
                                )}
                                {todayPnl !== null && todayPnl.eth !== 0 && (
                                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                                        todayPnl.eth >= 0
                                            ? 'bg-green-900/50 text-green-400'
                                            : 'bg-red-900/50 text-red-400'
                                    }`}>
                                        {todayPnl.eth >= 0 ? '+' : ''}{todayPnl.eth.toFixed(4)} ETH hari ini
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                            <div className={`w-2 h-2 rounded-full ${status?.connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                            <span className="text-xs text-gray-400">{status?.connected ? 'Live' : 'Offline'}</span>
                        </div>
                        <button
                            onClick={handleEmergencyStop}
                            disabled={emergencyLoading || emergencyDone || (status?.emergencyStop === true)}
                            className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg transition-all font-semibold border
                                ${emergencyDone || status?.emergencyStop
                                    ? 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed'
                                    : 'bg-red-900/80 hover:bg-red-800 border-red-700 text-red-300 hover:text-white'
                                }`}
                        >
                            <span>{emergencyLoading ? '⏳' : emergencyDone || status?.emergencyStop ? '🔴' : '🚨'}</span>
                            <span className="hidden xs:inline">{emergencyDone || status?.emergencyStop ? 'STOPPED' : 'STOP'}</span>
                        </button>
                    </div>
                </div>

                {/* Action buttons — scrollable */}
                <div className="flex items-center gap-1.5 overflow-x-auto pt-2 pb-1 scrollbar-hide -mx-1 px-1">
                    <button
                        onClick={() => setShowBlacklist(true)}
                        className="flex-shrink-0 flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-gray-300 hover:text-white text-xs px-3 py-2 rounded-lg transition-all"
                    >
                        <span>🚫</span>
                        <span>Blokir</span>
                    </button>

                    <button
                        onClick={() => setShowCopyWallets(true)}
                        className="flex-shrink-0 relative flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-gray-300 hover:text-white text-xs px-3 py-2 rounded-lg transition-all"
                    >
                        <span>🐋</span>
                        <span>Whale</span>
                        {(status?.pendingWhales ?? 0) > 0 && (
                            <span className="absolute -top-2.5 -right-2 bg-blue-500 text-white font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center leading-none" style={{fontSize:'10px'}}>
                                {status!.pendingWhales > 99 ? '99+' : status!.pendingWhales}
                            </span>
                        )}
                    </button>

                    <button
                        onClick={() => setShowMonitor(true)}
                        className="flex-shrink-0 relative flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-gray-300 hover:text-white text-xs px-3 py-2 rounded-lg transition-all"
                    >
                        <span>🔬</span>
                        <span>Monitor</span>
                        {monitorCount > 0 && (
                            <span className="absolute -top-2.5 -right-2 bg-purple-500 text-white font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center leading-none" style={{fontSize:'10px'}}>
                                {monitorCount > 99 ? '99+' : monitorCount}
                            </span>
                        )}
                    </button>

                    <button
                        onClick={() => setShowVetted(true)}
                        className="flex-shrink-0 relative flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-gray-300 hover:text-white text-xs px-3 py-2 rounded-lg transition-all"
                    >
                        <span>🤖</span>
                        <span>Vetted</span>
                        {vettedCount > 0 && (
                            <span className="absolute -top-2.5 -right-2 bg-green-500 text-white font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center leading-none" style={{fontSize:'10px'}}>
                                {vettedCount > 99 ? '99+' : vettedCount}
                            </span>
                        )}
                    </button>

                    <div className="flex-shrink-0">
                        <PushNotification apiUrl={apiUrl} />
                    </div>

                    <button
                        onClick={() => setShowSettings(true)}
                        className="flex-shrink-0 flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-gray-300 hover:text-white text-xs px-3 py-2 rounded-lg transition-all"
                    >
                        <span>⚙️</span>
                        <span>Pengaturan</span>
                    </button>
                </div>
            </div>

            {/* PWA Install Banner */}
            {canInstall && (
                <div className="mx-4 mt-2 flex items-center gap-3 bg-indigo-900/40 border border-indigo-700/60 rounded-xl px-4 py-2.5">
                    <span className="text-xl">📲</span>
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-indigo-300">Install ke Android</p>
                        <p className="text-xs text-indigo-400/70">Tambahkan ke layar utama untuk akses cepat</p>
                    </div>
                    <button
                        onClick={install}
                        className="flex-shrink-0 text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                    >
                        Install
                    </button>
                </div>
            )}

            {/* Banners */}
            {(emergencyDone || status?.emergencyStop) && (
                <div className="mx-4 mt-2 bg-red-900/50 border border-red-700 rounded-xl px-4 py-2 text-sm text-red-300 text-center font-semibold">
                    🚨 EMERGENCY STOP AKTIF — Restart server untuk lanjutkan trading
                </div>
            )}
            {error && (
                <div className="mx-4 mt-2 bg-red-900/30 border border-red-800 rounded-xl p-3 text-sm text-red-400">
                    {error}
                </div>
            )}

            {/* ── Tab Bar ── */}
            <div className="flex mx-4 mt-3 mb-3 bg-gray-900 rounded-xl p-1 gap-0.5 overflow-x-auto scrollbar-hide">
                {TAB_LIST.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-shrink-0 flex flex-col items-center justify-center gap-0.5 py-2 px-2.5 rounded-lg text-xs font-medium transition-all min-w-[52px]
                            ${activeTab === tab.id
                                ? 'bg-gray-700 text-white shadow'
                                : 'text-gray-500 hover:text-gray-300 active:text-gray-200'}`}
                    >
                        <span className="text-base leading-none">{tab.icon}</span>
                        <span className="text-[10px] leading-tight">{tab.label}</span>
                        {tab.id === 'positions' && openCount > 0 && (
                            <span className="bg-green-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                                {openCount}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* ── Tab Content ── */}
            <div className="flex-1 px-4 pb-8 overflow-y-auto">

                {/* OVERVIEW */}
                {activeTab === 'overview' && (
                    <div className="space-y-4">

                        {/* Pending whale alert */}
                        {(status?.pendingWhales ?? 0) > 0 && (
                            <button
                                onClick={() => setShowCopyWallets(true)}
                                className="w-full flex items-center gap-3 bg-blue-900/30 border border-blue-700/60 rounded-xl px-4 py-3 text-left hover:bg-blue-900/50 active:bg-blue-900/70 transition-colors"
                            >
                                <span className="text-xl">🐋</span>
                                <div className="flex-1">
                                    <p className="text-sm font-semibold text-blue-300">
                                        {status!.pendingWhales} Whale Kandidat Menunggu
                                    </p>
                                    <p className="text-xs text-blue-400/70 mt-0.5">Buka Whale Manager → Auto Finder</p>
                                </div>
                                <span className="text-blue-400 text-sm">›</span>
                            </button>
                        )}

                        {/* Stats grid */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                                <p className="text-xs text-gray-500 mb-1">Copy Hari Ini</p>
                                <p className="text-xl font-bold text-white">
                                    {status?.copyStats?.dailyCopies ?? '—'}
                                    <span className="text-sm text-gray-500"> / {config?.copyMaxPerDay || '—'}</span>
                                </p>
                                <p className="text-xs text-gray-600 mt-0.5">transaksi</p>
                            </div>
                            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                                <p className="text-xs text-gray-500 mb-1">Posisi Terbuka</p>
                                <p className="text-xl font-bold text-white">{openCount}</p>
                                <p className="text-xs text-gray-600 mt-0.5">aktif</p>
                            </div>
                        </div>

                        {/* Config card */}
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-sm font-semibold text-gray-300">Konfigurasi Aktif</h2>
                                <button
                                    onClick={() => setShowSettings(true)}
                                    className="text-xs text-green-400 hover:text-green-300 transition-colors py-1 px-2 -mr-2"
                                >
                                    Edit ✏️
                                </button>
                            </div>
                            <div className="grid grid-cols-1 gap-1.5">
                                {[
                                    { label: 'AI Trading',         value: config?.aiEnabled              ? '✓ Aktif' : '✗ Nonaktif', green: config?.aiEnabled },
                                    { label: 'Copy Trading',       value: config?.copyEnabled            ? '✓ Aktif' : '✗ Nonaktif', green: config?.copyEnabled },
                                    { label: 'Dynamic Sizing',     value: config?.dynamicSizingEnabled   ? `✓ ${config.tradeBalancePct || 10}%/trade` : '✗ Nonaktif', green: config?.dynamicSizingEnabled },
                                    { label: 'GeckoTerminal Scan', value: config?.geckoScannerEnabled    ? '✓ Aktif' : '✗ Nonaktif', green: config?.geckoScannerEnabled },
                                    { label: 'Auto Whale Finder',  value: config?.whaleAutoScanEnabled   ? '✓ Aktif' : '✗ Nonaktif', green: config?.whaleAutoScanEnabled },
                                    { label: 'Jumlah Copy',        value: `${config?.copyAmount || '—'} ETH` },
                                    { label: 'Min Safety Score',   value: `${config?.minSafetyScore || '—'}/100` },
                                    { label: 'Serial Rugger',      value: config?.serialRuggerEnabled    ? `✓ Aktif` : '✗ Nonaktif', green: config?.serialRuggerEnabled },
                                    { label: 'Reputasi Deployer',  value: config?.reputationEnabled      ? `✓ Min ${config.reputationMinScore}` : '✗ Nonaktif', green: config?.reputationEnabled },
                                ].map(({ label, value, green }) => (
                                    <div key={label} className="flex justify-between items-center py-1 border-b border-gray-800/60 last:border-0">
                                        <span className="text-xs text-gray-500">{label}</span>
                                        <span className={`text-xs font-medium ${green != null ? (green ? 'text-green-400' : 'text-red-400') : 'text-white'}`}>
                                            {value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <WhaleLeaderboard apiUrl={apiUrl} />

                        {lastUpdate && (
                            <p className="text-center text-xs text-gray-700">Update: {lastUpdate}</p>
                        )}
                    </div>
                )}

                {activeTab === 'screener'  && <SmartScreener apiUrl={apiUrl} />}
                {activeTab === 'portfolio' && <Portfolio apiUrl={apiUrl} />}
                {activeTab === 'positions' && <PositionCard apiUrl={apiUrl} />}
                {activeTab === 'log'       && <ActivityLog apiUrl={apiUrl} />}
                {activeTab === 'history'   && <TradeHistory apiUrl={apiUrl} />}
                {activeTab === 'report'    && <DailyReport apiUrl={apiUrl} />}
                {activeTab === 'backtest'  && <Backtest apiUrl={apiUrl} />}
            </div>

            {/* Modals */}
            {showSettings && (
                <SettingsModal
                    apiUrl={apiUrl}
                    onClose={() => { setShowSettings(false); fetchData(); }}
                    currentConfig={config ?? undefined}
                />
            )}
            {showCopyWallets && (
                <CopyWalletsModal
                    apiUrl={apiUrl}
                    onClose={() => setShowCopyWallets(false)}
                />
            )}
            {showBlacklist && (
                <BlacklistModal
                    apiUrl={apiUrl}
                    onClose={() => setShowBlacklist(false)}
                />
            )}
            {showMonitor && (
                <WalletMonitorPage
                    apiUrl={apiUrl}
                    onClose={() => { setShowMonitor(false); fetchMonitorCount(); }}
                />
            )}
            {showVetted && (
                <VettedWalletsPage
                    apiUrl={apiUrl}
                    onClose={() => { setShowVetted(false); fetchMonitorCount(); }}
                />
            )}
        </div>
    );
};

export default Dashboard;
