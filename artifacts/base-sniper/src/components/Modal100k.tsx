import React, { useState, useEffect } from 'react';

interface Modal100kProps {
    onSave: (settings: ModalSettings) => void;
    onClose: () => void;
    currentBalance?: number;
    currentConfig?: Record<string, any>;
}

export interface ModalSettings {
    // Modal Management
    totalCapital: number;
    maxTradeAmount: number;
    minLiquidity: number;
    maxSlippage: number;

    // Exit Strategy
    tp1Multiplier: number;
    tp1Percentage: number;
    tp2Multiplier: number;
    tp2Percentage: number;
    stopLoss: number;

    // Gas Settings
    maxPriorityFee: number;
    maxFeePerGas: number;
    gasMode: string;

    // Copy Trading
    copyEnabled: boolean;
    copyAmount: number;
    copyDelay: number;
    copyMaxPerDay: number;

    // AI Settings
    aiEnabled: boolean;
    minAiConfidence: number;

    // Token Safety
    blockHoneypot: boolean;
    blockHighTax: boolean;
    maxTaxPercent: number;
    minSafetyScore: number;
    maxPoolAgeSeconds: number;

    // Scanner
    enableFlashblocks: boolean;
    geckoScannerEnabled: boolean;

    // DCA
    dcaEnabled: boolean;

    // Dynamic Sizing
    dynamicSizingEnabled: boolean;
    tradeBalancePct: number;

    // Whale Validation & Auto-Scan
    whaleValidationEnabled: boolean;
    whaleAutoScanEnabled: boolean;

    // Serial Rugger Detection
    serialRuggerEnabled: boolean;
    serialRuggerMaxDeploys: number;
    serialRuggerWindowHours: number;

    // Deployer Reputation
    reputationEnabled: boolean;
    reputationMinScore: number;
}

const SWAP_GAS_UNITS = 150000;

const DEFAULT_SETTINGS: ModalSettings = {
    totalCapital: 0.006,
    maxTradeAmount: 0.0006,
    minLiquidity: 0.15,
    maxSlippage: 15,
    tp1Multiplier: 1.5,
    tp1Percentage: 50,
    tp2Multiplier: 2.5,
    tp2Percentage: 50,
    stopLoss: 30,
    maxPriorityFee: 0.005,
    maxFeePerGas: 0.05,
    gasMode: 'auto',
    copyEnabled: true,
    copyAmount: 0.0003,
    copyDelay: 2,
    copyMaxPerDay: 10,
    aiEnabled: true,
    minAiConfidence: 75,
    blockHoneypot: true,
    blockHighTax: true,
    maxTaxPercent: 15,
    minSafetyScore: 60,
    maxPoolAgeSeconds: 3600,
    enableFlashblocks: false,
    geckoScannerEnabled: true,
    dcaEnabled: true,
    dynamicSizingEnabled: true,
    tradeBalancePct: 10,
    whaleValidationEnabled: true,
    whaleAutoScanEnabled: false,
    serialRuggerEnabled: true,
    serialRuggerMaxDeploys: 3,
    serialRuggerWindowHours: 24,
    reputationEnabled: true,
    reputationMinScore: 25,
};

function parseNum(v: any, fallback: number): number {
    const n = parseFloat(v);
    return isNaN(n) ? fallback : n;
}
function parseBool(v: any, fallback: boolean): boolean {
    if (v === undefined || v === null) return fallback;
    if (typeof v === 'boolean') return v;
    return v === 'true' || v === true;
}

function Toggle({ checked, onChange, color = 'green' }: { checked: boolean; onChange: (v: boolean) => void; color?: string }) {
    const colors: Record<string, string> = {
        green: 'peer-checked:bg-green-600',
        blue:  'peer-checked:bg-blue-600',
        cyan:  'peer-checked:bg-cyan-600',
        purple:'peer-checked:bg-purple-600',
        red:   'peer-checked:bg-red-600',
        emerald:'peer-checked:bg-emerald-600',
        yellow:'peer-checked:bg-yellow-600',
        orange:'peer-checked:bg-orange-600',
    };
    return (
        <label className="relative inline-flex items-center cursor-pointer ml-4 flex-shrink-0">
            <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only peer" />
            <div className={`w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all ${colors[color] || colors.green}`} />
        </label>
    );
}

const Modal100k: React.FC<Modal100kProps> = ({ onSave, onClose, currentBalance = 0.006, currentConfig }) => {
    const [settings, setSettings] = useState<ModalSettings>({ ...DEFAULT_SETTINGS, totalCapital: currentBalance });

    useEffect(() => {
        if (!currentConfig) return;
        const c = currentConfig;
        setSettings({
            totalCapital:           parseNum(c.capital, currentBalance),
            maxTradeAmount:         parseNum(c.maxTrade, DEFAULT_SETTINGS.maxTradeAmount),
            minLiquidity:           parseNum(c.minLiquidity, DEFAULT_SETTINGS.minLiquidity),
            maxSlippage:            parseNum(c.maxSlippage, DEFAULT_SETTINGS.maxSlippage),
            tp1Multiplier:          parseNum(c.tp1Multiplier, DEFAULT_SETTINGS.tp1Multiplier),
            tp1Percentage:          parseNum(c.tp1Percentage, DEFAULT_SETTINGS.tp1Percentage),
            tp2Multiplier:          parseNum(c.tp2Multiplier, DEFAULT_SETTINGS.tp2Multiplier),
            tp2Percentage:          parseNum(c.tp2Percentage, DEFAULT_SETTINGS.tp2Percentage),
            stopLoss:               parseNum(c.stopLoss, DEFAULT_SETTINGS.stopLoss),
            maxPriorityFee:         parseNum(c.maxPriorityFee, DEFAULT_SETTINGS.maxPriorityFee),
            maxFeePerGas:           parseNum(c.maxFeePerGas, DEFAULT_SETTINGS.maxFeePerGas),
            gasMode:                c.gasMode || DEFAULT_SETTINGS.gasMode,
            copyEnabled:            parseBool(c.copyEnabled, DEFAULT_SETTINGS.copyEnabled),
            copyAmount:             parseNum(c.copyAmount, DEFAULT_SETTINGS.copyAmount),
            copyDelay:              parseNum(c.copyDelaySeconds, DEFAULT_SETTINGS.copyDelay),
            copyMaxPerDay:          parseNum(c.copyMaxPerDay, DEFAULT_SETTINGS.copyMaxPerDay),
            aiEnabled:              parseBool(c.aiEnabled, DEFAULT_SETTINGS.aiEnabled),
            minAiConfidence:        parseNum(c.minAiConfidence, DEFAULT_SETTINGS.minAiConfidence),
            blockHoneypot:          parseBool(c.blockHoneypot, DEFAULT_SETTINGS.blockHoneypot),
            blockHighTax:           parseBool(c.blockHighTax, DEFAULT_SETTINGS.blockHighTax),
            maxTaxPercent:          parseNum(c.maxTaxPercent, DEFAULT_SETTINGS.maxTaxPercent),
            minSafetyScore:         parseNum(c.minSafetyScore, DEFAULT_SETTINGS.minSafetyScore),
            maxPoolAgeSeconds:      parseNum(c.maxPoolAgeSeconds, DEFAULT_SETTINGS.maxPoolAgeSeconds),
            enableFlashblocks:      parseBool(c.enableFlashblocks, DEFAULT_SETTINGS.enableFlashblocks),
            geckoScannerEnabled:    parseBool(c.geckoScannerEnabled, DEFAULT_SETTINGS.geckoScannerEnabled),
            dcaEnabled:             parseBool(c.dcaEnabled, DEFAULT_SETTINGS.dcaEnabled),
            dynamicSizingEnabled:   parseBool(c.dynamicSizingEnabled, DEFAULT_SETTINGS.dynamicSizingEnabled),
            tradeBalancePct:        parseNum(c.tradeBalancePct, DEFAULT_SETTINGS.tradeBalancePct),
            whaleValidationEnabled: parseBool(c.whaleValidationEnabled, DEFAULT_SETTINGS.whaleValidationEnabled),
            whaleAutoScanEnabled:   parseBool(c.whaleAutoScanEnabled, DEFAULT_SETTINGS.whaleAutoScanEnabled),
            serialRuggerEnabled:    parseBool(c.serialRuggerEnabled, DEFAULT_SETTINGS.serialRuggerEnabled),
            serialRuggerMaxDeploys: parseNum(c.serialRuggerMaxDeploys, DEFAULT_SETTINGS.serialRuggerMaxDeploys),
            serialRuggerWindowHours:parseNum(c.serialRuggerWindowHours, DEFAULT_SETTINGS.serialRuggerWindowHours),
            reputationEnabled:      parseBool(c.reputationEnabled, DEFAULT_SETTINGS.reputationEnabled),
            reputationMinScore:     parseNum(c.reputationMinScore, DEFAULT_SETTINGS.reputationMinScore),
        });
    }, [currentConfig]);

    const [estimatedGasCost, setEstimatedGasCost] = useState(0.00015);
    const [recommendedTrades, setRecommendedTrades] = useState(0);

    useEffect(() => {
        const gasCost = (settings.maxFeePerGas * SWAP_GAS_UNITS) / 1e9;
        setEstimatedGasCost(gasCost);
        const capital = settings.totalCapital > 0 ? settings.totalCapital : 0.006;
        const tradeAmount = settings.maxTradeAmount > 0 ? settings.maxTradeAmount : 0.0006;
        const availableForTrades = capital * 0.7;
        const trades = Math.floor(availableForTrades / (tradeAmount + gasCost));
        setRecommendedTrades(Math.min(trades, 15));
    }, [settings]);

    const capital = settings.totalCapital > 0 ? settings.totalCapital : 0;
    const tradeAmount = settings.maxTradeAmount > 0 ? settings.maxTradeAmount : 0;
    const rupiahEquivalent = capital * 3000 * 18000;
    const tradePercent = capital > 0 ? Math.floor(tradeAmount / capital * 100) : 0;

    const set = (patch: Partial<ModalSettings>) => setSettings(s => ({ ...s, ...patch }));
    const numInput = (label: string, key: keyof ModalSettings, step: number, min: number, hint?: string, max?: number) => (
        <div>
            <label className="block text-sm text-gray-400 mb-1">{label}</label>
            <input
                type="number" step={step} min={min} max={max}
                value={settings[key] as number}
                onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) set({ [key]: v } as any); }}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white"
            />
            {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto border border-gray-700 shadow-2xl">

                {/* Header */}
                <div className="sticky top-0 bg-gradient-to-r from-green-900/50 to-blue-900/50 p-6 border-b border-gray-700 backdrop-blur">
                    <div className="flex justify-between items-start">
                        <div>
                            <h2 className="text-2xl font-bold text-white">⚙️ Pengaturan Bot</h2>
                            <p className="text-gray-400 text-sm mt-1">Semua parameter trading dalam satu tempat</p>
                        </div>
                        <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">&times;</button>
                    </div>
                    <div className="mt-4 bg-gray-800/50 rounded-xl p-4 border border-green-500/30">
                        <div className="flex justify-between items-center flex-wrap gap-4">
                            <div>
                                <div className="text-gray-400 text-sm">Total Modal</div>
                                <div className="text-2xl font-bold text-white">{capital.toFixed(4)} ETH</div>
                                <div className="text-green-400 text-sm">≈ Rp{(rupiahEquivalent / 1000).toFixed(0)}rb</div>
                            </div>
                            <div>
                                <div className="text-gray-400 text-sm">Per Snipe</div>
                                <div className="text-xl font-bold text-yellow-400">{tradeAmount.toFixed(4)} ETH</div>
                                <div className="text-gray-400 text-xs">≈ {tradePercent}% dari modal</div>
                            </div>
                            <div>
                                <div className="text-gray-400 text-sm">Estimasi Gas</div>
                                <div className="text-lg font-mono text-blue-400">{estimatedGasCost.toFixed(5)} ETH</div>
                                <div className="text-gray-400 text-xs">≈ Rp{(estimatedGasCost * 3000 * 18000 / 1000).toFixed(0)}rb</div>
                            </div>
                            <div>
                                <div className="text-gray-400 text-sm">Maksimal Snipe</div>
                                <div className="text-xl font-bold text-green-400">{recommendedTrades}x</div>
                                <div className="text-gray-400 text-xs">per hari (rekomendasi)</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-6 space-y-6">

                    {/* ── MANAJEMEN MODAL ── */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
                        <h3 className="text-lg font-semibold text-white mb-4">💰 Manajemen Modal</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            {numInput('Total Modal (ETH)', 'totalCapital', 0.001, 0.001, '0.006 ETH = ~Rp100.000')}
                            {numInput('Max Trade per Snipe (ETH)', 'maxTradeAmount', 0.0001, 0.0001, '✅ Rekomendasi: 10-15% dari modal')}
                            {numInput('Min Liquidity (ETH)', 'minLiquidity', 0.05, 0, 'Rekomendasi: 0.15 - 0.5 ETH')}
                            {numInput('Max Slippage (%)', 'maxSlippage', 1, 1, '⚠️ Modal kecil bisa lebih tinggi (10-20%)', 50)}
                        </div>
                    </div>

                    {/* ── EXIT STRATEGY ── */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
                        <h3 className="text-lg font-semibold text-white mb-4">📈 Exit Strategy</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="bg-gray-900 rounded-lg p-3">
                                <div className="text-gray-400 text-sm mb-2">Take Profit 1</div>
                                <div className="flex items-center gap-3 mb-2">
                                    <input type="number" step="0.5" min="1" value={settings.tp1Multiplier}
                                        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) set({ tp1Multiplier: v }); }}
                                        className="w-24 bg-gray-800 border border-gray-700 rounded p-1 text-white" />
                                    <span className="text-green-400">x</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-400">Jual</span>
                                    <input type="number" step="10" min="1" max="100" value={settings.tp1Percentage}
                                        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) set({ tp1Percentage: v }); }}
                                        className="w-20 bg-gray-800 border border-gray-700 rounded p-1 text-white text-sm" />
                                    <span className="text-xs text-gray-400">% posisi</span>
                                </div>
                            </div>
                            <div className="bg-gray-900 rounded-lg p-3">
                                <div className="text-gray-400 text-sm mb-2">Take Profit 2</div>
                                <div className="flex items-center gap-3 mb-2">
                                    <input type="number" step="0.5" min="1" value={settings.tp2Multiplier}
                                        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) set({ tp2Multiplier: v }); }}
                                        className="w-24 bg-gray-800 border border-gray-700 rounded p-1 text-white" />
                                    <span className="text-green-400">x</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-400">Jual</span>
                                    <input type="number" step="10" min="1" max="100" value={settings.tp2Percentage}
                                        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) set({ tp2Percentage: v }); }}
                                        className="w-20 bg-gray-800 border border-gray-700 rounded p-1 text-white text-sm" />
                                    <span className="text-xs text-gray-400">% posisi</span>
                                </div>
                            </div>
                            <div className="bg-gray-900 rounded-lg p-3">
                                <div className="text-gray-400 text-sm">Stop Loss</div>
                                <div className="flex items-center gap-3">
                                    <input type="number" step="5" min="1" max="99" value={settings.stopLoss}
                                        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) set({ stopLoss: v }); }}
                                        className="w-24 bg-gray-800 border border-gray-700 rounded p-1 text-white" />
                                    <span className="text-red-400">%</span>
                                    <span className="text-sm text-gray-400">jual SEMUA</span>
                                </div>
                                <p className="text-xs text-red-400 mt-1">Potong rugi di -{settings.stopLoss}%</p>
                            </div>
                        </div>
                    </div>

                    {/* ── GAS SETTINGS ── */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
                        <h3 className="text-lg font-semibold text-white mb-4">⛽ Gas Settings</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            {numInput('Max Priority Fee (Gwei)', 'maxPriorityFee', 0.001, 0, '⚡ Rendah untuk Base L2 (rekomendasi: 0.005)')}
                            {numInput('Max Fee per Gas (Gwei)', 'maxFeePerGas', 0.01, 0, 'Rekomendasi: 0.05 Gwei di Base')}
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Mode Gas</label>
                                <select value={settings.gasMode} onChange={e => set({ gasMode: e.target.value })}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white">
                                    <option value="auto">auto — baca base fee aktual Base</option>
                                    <option value="fast">fast — prioritas tinggi (lebih mahal)</option>
                                    <option value="slow">slow — prioritas rendah (lebih murah)</option>
                                </select>
                                <p className="text-xs text-gray-500 mt-1">GAS_MODE env</p>
                            </div>
                        </div>
                        <div className="mt-3 p-3 bg-blue-900/30 rounded">
                            <p className="text-sm text-blue-300">💡 Estimasi gas {estimatedGasCost.toFixed(5)} ETH ≈ Rp{(estimatedGasCost * 3000 * 18000 / 1000).toFixed(0)}rb per transaksi</p>
                        </div>
                    </div>

                    {/* ── AI SETTINGS ── */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-blue-900/40">
                        <div className="flex justify-between items-center mb-4">
                            <div>
                                <h3 className="text-lg font-semibold text-white">🤖 Analisis AI</h3>
                                <p className="text-xs text-gray-400 mt-0.5">Filter keputusan beli menggunakan AI multi-provider</p>
                            </div>
                            <Toggle checked={settings.aiEnabled} onChange={v => set({ aiEnabled: v })} color="blue" />
                        </div>
                        {settings.aiEnabled && (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">Min Confidence AI (%)</label>
                                    <div className="flex items-center gap-3">
                                        <input type="range" min="50" max="95" step="5" value={settings.minAiConfidence}
                                            onChange={e => set({ minAiConfidence: parseInt(e.target.value) })}
                                            className="flex-1 accent-blue-500" />
                                        <span className="text-blue-400 font-bold w-12 text-right">{settings.minAiConfidence}%</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">MIN_AI_CONFIDENCE — hanya beli jika AI ≥ {settings.minAiConfidence}% yakin</p>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                    <div className={`p-2 rounded border ${settings.minAiConfidence <= 65 ? 'bg-yellow-900/30 border-yellow-700' : 'bg-gray-900/40 border-gray-700'}`}>
                                        <div className="text-yellow-400 font-semibold">Agresif</div>
                                        <div className="text-gray-400">50-65%</div>
                                        <div className="text-gray-500 mt-0.5">Lebih banyak trade</div>
                                    </div>
                                    <div className={`p-2 rounded border ${settings.minAiConfidence > 65 && settings.minAiConfidence <= 80 ? 'bg-blue-900/30 border-blue-700' : 'bg-gray-900/40 border-gray-700'}`}>
                                        <div className="text-blue-400 font-semibold">Balanced</div>
                                        <div className="text-gray-400">70-80%</div>
                                        <div className="text-gray-500 mt-0.5">Rekomendasi</div>
                                    </div>
                                    <div className={`p-2 rounded border ${settings.minAiConfidence > 80 ? 'bg-green-900/30 border-green-700' : 'bg-gray-900/40 border-gray-700'}`}>
                                        <div className="text-green-400 font-semibold">Konservatif</div>
                                        <div className="text-gray-400">85-95%</div>
                                        <div className="text-gray-500 mt-0.5">Lebih selektif</div>
                                    </div>
                                </div>
                            </div>
                        )}
                        {!settings.aiEnabled && (
                            <div className="p-3 bg-yellow-900/20 rounded-lg border border-yellow-800/40">
                                <p className="text-xs text-yellow-300">⚠️ AI dimatikan — bot akan mencoba beli semua token yang lolos safety check tanpa filter AI.</p>
                            </div>
                        )}
                    </div>

                    {/* ── TOKEN SAFETY ── */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-orange-900/40">
                        <h3 className="text-lg font-semibold text-white mb-4">🛡️ Keamanan Token</h3>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <div>
                                    <p className="text-sm text-white font-medium">🍯 Blokir Honeypot</p>
                                    <p className="text-xs text-gray-400 mt-0.5">Tolak token yang terdeteksi sebagai honeypot (tidak bisa dijual)</p>
                                </div>
                                <Toggle checked={settings.blockHoneypot} onChange={v => set({ blockHoneypot: v })} color="orange" />
                            </div>
                            <div className="flex justify-between items-center">
                                <div>
                                    <p className="text-sm text-white font-medium">💸 Blokir Pajak Tinggi</p>
                                    <p className="text-xs text-gray-400 mt-0.5">Tolak token dengan buy/sell tax di atas batas maksimum</p>
                                </div>
                                <Toggle checked={settings.blockHighTax} onChange={v => set({ blockHighTax: v })} color="orange" />
                            </div>
                            {settings.blockHighTax && (
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">Batas Maksimum Tax (%)</label>
                                    <div className="flex items-center gap-3">
                                        <input type="range" min="5" max="50" step="1" value={settings.maxTaxPercent}
                                            onChange={e => set({ maxTaxPercent: parseInt(e.target.value) })}
                                            className="flex-1 accent-orange-500" />
                                        <span className="text-orange-400 font-bold w-12 text-right">{settings.maxTaxPercent}%</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">MAX_TAX_PERCENT — tolak jika buy/sell tax &gt; {settings.maxTaxPercent}%</p>
                                </div>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">Min Safety Score (0-100)</label>
                                    <input type="number" step="5" min="0" max="100" value={settings.minSafetyScore}
                                        onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v)) set({ minSafetyScore: v }); }}
                                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white" />
                                    <p className="text-xs text-gray-500 mt-1">Skor keamanan GoPlus minimum</p>
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">Max Usia Pool (detik)</label>
                                    <input type="number" step="60" min="0" value={settings.maxPoolAgeSeconds}
                                        onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v)) set({ maxPoolAgeSeconds: v }); }}
                                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white" />
                                    <p className="text-xs text-gray-500 mt-1">0 = nonaktifkan. 3600 = max 1 jam</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── COPY TRADING ── */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-green-500/30">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold text-white">🐋 Copy Trading</h3>
                            <Toggle checked={settings.copyEnabled} onChange={v => set({ copyEnabled: v })} color="green" />
                        </div>
                        {settings.copyEnabled && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                {numInput('Copy Amount (ETH)', 'copyAmount', 0.0001, 0.0001, `50% dari max trade (${(settings.maxTradeAmount * 0.5).toFixed(4)} ETH)`)}
                                {numInput('Copy Delay (detik)', 'copyDelay', 0.5, 0, 'Delay setelah whale buy')}
                                {numInput('Max Copy per Hari', 'copyMaxPerDay', 1, 1, 'Batas copy trade harian')}
                            </div>
                        )}
                        {!settings.copyEnabled && (
                            <div className="p-3 bg-yellow-900/30 rounded">
                                <p className="text-sm text-yellow-400">⚠️ Copy trading dimatikan! Dengan modal kecil, sangat tidak disarankan snipe langsung.</p>
                            </div>
                        )}
                    </div>

                    {/* ── DCA ── */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
                        <div className="flex justify-between items-center">
                            <div>
                                <h3 className="text-lg font-semibold text-white">📉 DCA on Dip</h3>
                                <p className="text-xs text-gray-400 mt-0.5">Beli lagi saat harga turun setelah TP1 (tidak direkomendasikan modal kecil &lt; 0.003 ETH)</p>
                            </div>
                            <Toggle checked={settings.dcaEnabled} onChange={v => set({ dcaEnabled: v })} color="blue" />
                        </div>
                        {settings.dcaEnabled && (
                            <div className="mt-3 p-3 bg-blue-900/20 rounded-lg border border-blue-800/40">
                                <p className="text-xs text-blue-300">💡 DCA aktif: Bot akan beli 50% dari posisi awal saat harga turun ke 98% dari entry setelah TP1 tercapai.</p>
                            </div>
                        )}
                    </div>

                    {/* ── DYNAMIC SIZING ── */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-cyan-900/40">
                        <div className="flex justify-between items-center mb-3">
                            <div>
                                <h3 className="text-lg font-semibold text-white">📊 Dynamic Position Sizing</h3>
                                <p className="text-xs text-gray-400 mt-0.5">Ukuran trade menyesuaikan saldo WETH otomatis</p>
                            </div>
                            <Toggle checked={settings.dynamicSizingEnabled} onChange={v => set({ dynamicSizingEnabled: v })} color="cyan" />
                        </div>
                        {settings.dynamicSizingEnabled && (
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">% Saldo per Trade</label>
                                    <div className="flex items-center gap-3">
                                        <input type="range" min="3" max="25" step="1" value={settings.tradeBalancePct}
                                            onChange={e => set({ tradeBalancePct: parseInt(e.target.value) })}
                                            className="flex-1 accent-cyan-500" />
                                        <span className="text-cyan-400 font-bold w-12 text-right">{settings.tradeBalancePct}%</span>
                                    </div>
                                </div>
                                <div className="p-3 bg-cyan-900/20 rounded-lg border border-cyan-800/40">
                                    <p className="text-xs text-cyan-300">💡 AI confidence multiplier: kepercayaan tinggi (≥90%) = 1.5x, rendah = 0.6x. Maks 30% saldo.</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── SCANNER ── */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-emerald-900/40 space-y-4">
                        <h3 className="text-lg font-semibold text-white mb-2">🔭 Scanner</h3>
                        <div className="flex justify-between items-center">
                            <div>
                                <p className="text-sm text-white font-medium">🦎 GeckoTerminal Token Scanner</p>
                                <p className="text-xs text-gray-400 mt-0.5">Pindai token baru & trending di Base secara independen</p>
                            </div>
                            <Toggle checked={settings.geckoScannerEnabled} onChange={v => set({ geckoScannerEnabled: v })} color="emerald" />
                        </div>
                        <div className="flex justify-between items-center">
                            <div>
                                <p className="text-sm text-white font-medium">⚡ Flashblocks Scanner</p>
                                <p className="text-xs text-gray-400 mt-0.5">WebSocket ke Base Flashblocks untuk deteksi pool baru secepat mungkin</p>
                            </div>
                            <Toggle checked={settings.enableFlashblocks} onChange={v => set({ enableFlashblocks: v })} color="yellow" />
                        </div>
                        {settings.enableFlashblocks && (
                            <div className="p-3 bg-yellow-900/20 rounded-lg border border-yellow-800/40">
                                <p className="text-xs text-yellow-300">⚡ Flashblocks aktif — deteksi pool baru sebelum konfirmasi block penuh. Butuh koneksi WebSocket stabil.</p>
                            </div>
                        )}
                    </div>

                    {/* ── WHALE FINDER ── */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-purple-900/40">
                        <h3 className="text-lg font-semibold text-white mb-4">🐋 Whale Finder & Validasi</h3>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <div>
                                    <p className="text-sm text-white font-medium">🔒 Gate Validasi Manual</p>
                                    <p className="text-xs text-gray-400 mt-0.5">Wallet whale harus disetujui sebelum di-copy</p>
                                </div>
                                <Toggle checked={settings.whaleValidationEnabled} onChange={v => set({ whaleValidationEnabled: v })} color="purple" />
                            </div>
                            <div className="flex justify-between items-center">
                                <div>
                                    <p className="text-sm text-white font-medium">🔍 Auto Whale Scan</p>
                                    <p className="text-xs text-gray-400 mt-0.5">Cari wallet whale otomatis via GeckoTerminal (cooldown 15 menit)</p>
                                </div>
                                <Toggle checked={settings.whaleAutoScanEnabled} onChange={v => set({ whaleAutoScanEnabled: v })} color="purple" />
                            </div>
                            <div className="p-3 bg-purple-900/20 rounded-lg border border-purple-800/40">
                                <p className="text-xs text-purple-300">🐋 Kelola wallet whale di tombol <strong>Whale</strong> di header — tab Auto Finder untuk approve/reject kandidat.</p>
                            </div>
                        </div>
                    </div>

                    {/* ── SERIAL RUGGER DETECTION ── */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-red-900/40">
                        <div className="flex justify-between items-center mb-4">
                            <div>
                                <h3 className="text-lg font-semibold text-white">🚨 Serial Rugger Detection</h3>
                                <p className="text-xs text-gray-400 mt-0.5">Blokir token dari deployer yang sering bikin kontrak baru</p>
                            </div>
                            <Toggle checked={settings.serialRuggerEnabled} onChange={v => set({ serialRuggerEnabled: v })} color="red" />
                        </div>
                        {settings.serialRuggerEnabled && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {numInput('Max Deploy dalam Window', 'serialRuggerMaxDeploys', 1, 1, `Blokir jika deployer > ${settings.serialRuggerMaxDeploys} kontrak`, 20)}
                                {numInput('Window Waktu (jam)', 'serialRuggerWindowHours', 1, 1, `Periksa ${settings.serialRuggerWindowHours}j terakhir`, 168)}
                                <div className="md:col-span-2 p-3 bg-red-900/20 rounded-lg border border-red-800/40">
                                    <p className="text-xs text-red-300">🚨 Jika deployer membuat lebih dari <strong>{settings.serialRuggerMaxDeploys} kontrak</strong> dalam <strong>{settings.serialRuggerWindowHours} jam</strong> terakhir, token otomatis diblacklist.</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── DEPLOYER REPUTATION ── */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-purple-900/40">
                        <div className="flex justify-between items-center mb-4">
                            <div>
                                <h3 className="text-lg font-semibold text-white">⭐ Skor Reputasi Deployer</h3>
                                <p className="text-xs text-gray-400 mt-0.5">Cek riwayat token deployer via GeckoTerminal — token mati = rug → skor rendah → tolak</p>
                            </div>
                            <Toggle checked={settings.reputationEnabled} onChange={v => set({ reputationEnabled: v })} color="purple" />
                        </div>
                        {settings.reputationEnabled && (
                            <div className="grid grid-cols-1 gap-4">
                                {numInput('Skor Minimum (0-100)', 'reputationMinScore', 5, 0, `Tolak token jika skor deployer di bawah ${settings.reputationMinScore}/100`, 100)}
                                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                    <div className="p-2 bg-green-900/30 rounded border border-green-800/40">
                                        <div className="text-green-400 font-bold">⭐ Tepercaya</div>
                                        <div className="text-gray-400">Skor ≥ 65</div>
                                    </div>
                                    <div className="p-2 bg-yellow-900/30 rounded border border-yellow-800/40">
                                        <div className="text-yellow-400 font-bold">🟡 Netral</div>
                                        <div className="text-gray-400">Skor 25-64</div>
                                    </div>
                                    <div className="p-2 bg-red-900/30 rounded border border-red-800/40">
                                        <div className="text-red-400 font-bold">🔴 Berisiko</div>
                                        <div className="text-gray-400">Skor &lt; 25</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── SAVE BUTTON ── */}
                    <div className="flex gap-3 pt-2">
                        <button onClick={onClose}
                            className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white py-3 rounded-xl text-sm font-medium transition-all">
                            Batal
                        </button>
                        <button onClick={() => onSave(settings)}
                            className="flex-1 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white py-3 rounded-xl text-sm font-bold transition-all">
                            💾 Simpan Pengaturan
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Modal100k;
