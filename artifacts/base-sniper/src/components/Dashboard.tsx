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
import PnLChart from './PnLChart';
import DeploymentStatus from './DeploymentStatus';
import WhaleCorrelation from './WhaleCorrelation';
import DeployerRepCheck from './DeployerRepCheck';
import MempoolGauge from './MempoolGauge';
import LiveDashboard from './LiveDashboard';
import AIProviderStatus from './AIProviderStatus';
import RpcStatusBadge from './RpcStatusBadge';
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
    aiStats?: {
        providers: {
            groq:         { hasKey: boolean; onCooldown: boolean; cooldownSecsLeft: number; success: number; fail: number; avgLatency: number };
            gemini:       { hasKey: boolean; onCooldown: boolean; cooldownSecsLeft: number; success: number; fail: number; avgLatency: number };
            huggingface:  { hasKey: boolean; onCooldown: boolean; cooldownSecsLeft: number; success: number; fail: number; avgLatency: number };
        };
        currentProvider: string;
        timestamp:       number;
    };
}

interface RiskState {
    todayLossEth: number;
    dailyLossLimit: number;
    dailyLossCooldownHours: number;
    consecutiveLosses: number;
    cooldownUntil: number;
    cooldownReason: string;
    tradesBlockedToday: number;
    circuitBreakerTripped: boolean;
    circuitBreakerReason: string;
    dailyResetAt: number;
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

type Tab = 'live' | 'overview' | 'portfolio' | 'positions' | 'log' | 'history' | 'backtest' | 'report' | 'screener' | 'deployment' | 'correlation' | 'deployer';

interface DashboardProps {
    apiUrl: string;
}

const TAB_LIST: { id: Tab; label: string; icon: string }[] = [
    { id: 'live',         label: 'Live',        icon: '🔴' },
    { id: 'overview',     label: 'Overview',    icon: '📊' },
    { id: 'screener',     label: 'Screener',    icon: '📡' },
    { id: 'correlation',  label: 'Korelasi',    icon: '🔗' },
    { id: 'deployer',     label: 'Deployer',    icon: '🕵️' },
    { id: 'portfolio',    label: 'Portfolio',   icon: '👜' },
    { id: 'positions',    label: 'Posisi',      icon: '💼' },
    { id: 'log',          label: 'Log',         icon: '📋' },
    { id: 'history',      label: 'Histori',     icon: '📈' },
    { id: 'report',       label: 'Laporan',     icon: '📉' },
    { id: 'backtest',     label: 'Backtest',    icon: '🔬' },
    { id: 'deployment',   label: 'Deployment',  icon: '🚀' },
];

const Dashboard: React.FC<DashboardProps> = ({ apiUrl }) => {
    const [activeTab, setActiveTab]             = useState<Tab>('live');
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
    const [riskState, setRiskState]               = useState<RiskState | null>(null);

    const fetchData = useCallback(async () => {
        try {
            const [statusRes, configRes] = await Promise.all([
                authFetch(`${apiUrl}/api/status`),
                authFetch(`${apiUrl}/api/config`)
            ]);
            if (!statusRes.ok || !configRes.ok) throw new Error('Server error');
            const statusJson = await statusRes.json();
            const configJson = await configRes.json();
            if (statusJson.error) throw new Error(statusJson.error);
            setStatus(statusJson);
            if (!configJson.error) setConfig(configJson);
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

    const fetchRiskState = useCallback(async () => {
        try {
            const res  = await authFetch(`${apiUrl}/api/risk`);
            const data = await res.json();
            if (data?.riskState) setRiskState(data.riskState);
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

    useEffect(() => {
        fetchRiskState();
        const interval = setInterval(fetchRiskState, 10000);
        return () => clearInterval(interval);
    }, [fetchRiskState]);


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
                        <RpcStatusBadge apiUrl={apiUrl} connected={status?.connected} />
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

                {/* LIVE DASHBOARD */}
                {activeTab === 'live' && (
                    <LiveDashboard apiUrl={apiUrl} />
                )}

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

                        {/* AI Provider Status */}
                        <AIProviderStatus aiStats={status?.aiStats} />

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

                        {/* Auto Cooldown / Circuit Breaker Status */}
                        {riskState && (() => {
                            const now           = Date.now();
                            const inCooldown    = riskState.cooldownUntil > now;
                            const emergencyStop = riskState.circuitBreakerTripped;
                            const remainingMs   = Math.max(0, riskState.cooldownUntil - now);
                            const remainingMins = Math.ceil(remainingMs / 60_000);
                            const remainingDisp = remainingMins >= 60
                                ? `${(remainingMs / 3_600_000).toFixed(1)} jam`
                                : `${remainingMins} menit`;
                            const lossRatioPct  = riskState.dailyLossLimit > 0
                                ? Math.min(100, (riskState.todayLossEth / riskState.dailyLossLimit) * 100) : 0;

                            return (
                                <div className={`rounded-xl border p-4 ${
                                    emergencyStop ? 'bg-red-950/50 border-red-700'
                                    : inCooldown  ? 'bg-yellow-950/30 border-yellow-800/60'
                                    : 'bg-gray-900 border-gray-800'
                                }`}>
                                    <div className="flex items-center justify-between mb-3">
                                        <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                                            <span>{emergencyStop ? '🔴' : inCooldown ? '⏳' : '🟢'}</span>
                                            Auto Cooldown
                                        </h2>
                                        {emergencyStop && (
                                            <span className="text-xs bg-red-900 text-red-300 border border-red-700 px-2 py-0.5 rounded-full font-semibold animate-pulse">
                                                EMERGENCY STOP
                                            </span>
                                        )}
                                        {!emergencyStop && inCooldown && (
                                            <span className="text-xs bg-yellow-900/60 text-yellow-300 border border-yellow-700 px-2 py-0.5 rounded-full font-semibold">
                                                ⏳ {remainingDisp} tersisa
                                            </span>
                                        )}
                                        {!emergencyStop && !inCooldown && (
                                            <span className="text-xs bg-green-900/40 text-green-400 border border-green-800 px-2 py-0.5 rounded-full">
                                                Trading Aktif
                                            </span>
                                        )}
                                    </div>

                                    {emergencyStop && riskState.circuitBreakerReason && (
                                        <p className="text-xs text-red-400 mb-3 bg-red-900/30 rounded-lg px-3 py-2">{riskState.circuitBreakerReason}</p>
                                    )}
                                    {!emergencyStop && inCooldown && riskState.cooldownReason && (
                                        <p className="text-xs text-yellow-400/80 mb-3 bg-yellow-900/20 rounded-lg px-3 py-2">
                                            Alasan: {riskState.cooldownReason} — lanjut otomatis setelah {remainingDisp}
                                        </p>
                                    )}

                                    <div className="grid grid-cols-2 gap-2">
                                        <div className={`rounded-lg p-3 ${lossRatioPct > 70 ? 'bg-red-900/30 border border-red-800/60' : 'bg-gray-950 border border-gray-800'}`}>
                                            <p className="text-xs text-gray-500 mb-1">Rugi Hari Ini</p>
                                            <p className={`text-sm font-bold ${lossRatioPct > 70 ? 'text-red-400' : 'text-white'}`}>
                                                {riskState.todayLossEth.toFixed(5)} ETH
                                            </p>
                                            <div className="mt-1.5 h-1 bg-gray-800 rounded-full overflow-hidden">
                                                <div className={`h-full rounded-full transition-all ${lossRatioPct >= 100 ? 'bg-red-500' : lossRatioPct > 70 ? 'bg-orange-500' : lossRatioPct > 40 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                                    style={{ width: `${lossRatioPct}%` }} />
                                            </div>
                                            <p className="text-xs text-gray-600 mt-1">limit: {riskState.dailyLossLimit.toFixed(5)} ETH → CD {riskState.dailyLossCooldownHours}j</p>
                                        </div>
                                        <div className={`rounded-lg p-3 ${riskState.consecutiveLosses >= 2 ? 'bg-orange-900/30 border border-orange-800/60' : 'bg-gray-950 border border-gray-800'}`}>
                                            <p className="text-xs text-gray-500 mb-1">Kalah Berturut</p>
                                            <p className={`text-sm font-bold ${riskState.consecutiveLosses >= 2 ? 'text-orange-400' : 'text-white'}`}>
                                                {riskState.consecutiveLosses}×
                                            </p>
                                            <p className="text-xs text-gray-600 mt-1">CD 30 mnt di {riskState.consecutiveLosses >= 3 ? '3×' : `${riskState.consecutiveLosses}/3`}</p>
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-700 mt-2 text-right">
                                        Counter reset: {new Date(riskState.dailyResetAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} (tengah malam UTC)
                                    </p>
                                </div>
                            );
                        })()}

                        {/* Mempool Gauge */}
                        <MempoolGauge apiUrl={apiUrl} />

                        {/* Realtime P&L Chart */}
                        <PnLChart apiUrl={apiUrl} compact={true} />

                        <WhaleLeaderboard apiUrl={apiUrl} />

                        {lastUpdate && (
                            <p className="text-center text-xs text-gray-700">Update: {lastUpdate}</p>
                        )}
                    </div>
                )}

                {activeTab === 'screener'     && <SmartScreener apiUrl={apiUrl} />}
                {activeTab === 'correlation'  && <WhaleCorrelation apiUrl={apiUrl} />}
                {activeTab === 'deployer'     && <DeployerRepCheck apiUrl={apiUrl} />}
                {activeTab === 'portfolio'    && <Portfolio apiUrl={apiUrl} />}
                {activeTab === 'positions'    && <PositionCard apiUrl={apiUrl} />}
                {activeTab === 'log'          && <ActivityLog apiUrl={apiUrl} />}
                {activeTab === 'history'      && <TradeHistory apiUrl={apiUrl} />}
                {activeTab === 'report'       && <DailyReport apiUrl={apiUrl} />}
                {activeTab === 'backtest'     && <Backtest apiUrl={apiUrl} />}
                {activeTab === 'deployment'   && <DeploymentStatus apiUrl={apiUrl} />}
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
