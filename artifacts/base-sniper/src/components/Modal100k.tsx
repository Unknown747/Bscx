import React, { useState, useEffect } from 'react';

interface Modal100kProps {
    onSave: (settings: ModalSettings) => void;
    onClose: () => void;
    currentBalance?: number;
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
    
    // Copy Trading
    copyEnabled: boolean;
    copyAmount: number;
    copyDelay: number;

    // DCA
    dcaEnabled: boolean;

    // Dynamic Sizing
    dynamicSizingEnabled: boolean;
    tradeBalancePct: number;

    // GeckoTerminal Token Scanner
    geckoScannerEnabled: boolean;

    // Whale Validation & Auto-Scan
    whaleValidationEnabled: boolean;
    whaleAutoScanEnabled: boolean;

    // Serial Rugger Detection
    serialRuggerEnabled:    boolean;
    serialRuggerMaxDeploys: number;
    serialRuggerWindowHours: number;

    // Deployer Reputation
    reputationEnabled:  boolean;
    reputationMinScore: number;
}

// FIX: Uniswap V3 swap uses ~150,000 gas units, not 21,000 (ETH transfer)
const SWAP_GAS_UNITS = 150000;

const Modal100k: React.FC<Modal100kProps> = ({ onSave, onClose, currentBalance = 0.006 }) => {
    const [settings, setSettings] = useState<ModalSettings>({
        totalCapital: currentBalance,
        maxTradeAmount: 0.0006,
        minLiquidity: 0.15,
        maxSlippage: 15,
        tp1Multiplier: 1.5,
        tp1Percentage: 50,
        tp2Multiplier: 2.5,
        tp2Percentage: 50,
        stopLoss: 30,
        maxPriorityFee: 0.5,
        maxFeePerGas: 1.5,
        copyEnabled: true,
        copyAmount: 0.0003,
        copyDelay: 2,
        dcaEnabled: true,
        dynamicSizingEnabled: true,
        tradeBalancePct: 10,
        geckoScannerEnabled: true,
        whaleValidationEnabled: true,
        whaleAutoScanEnabled: false,
        serialRuggerEnabled:    true,
        serialRuggerMaxDeploys: 3,
        serialRuggerWindowHours: 24,
        reputationEnabled:  true,
        reputationMinScore: 25
    });
    
    const [estimatedGasCost, setEstimatedGasCost] = useState(0.00015);
    const [recommendedTrades, setRecommendedTrades] = useState(0);
    
    useEffect(() => {
        // FIX: use SWAP_GAS_UNITS (150,000) instead of 21,000
        const gasCost = (settings.maxFeePerGas * SWAP_GAS_UNITS) / 1e9;
        setEstimatedGasCost(gasCost);
        
        // FIX: guard against division by zero when totalCapital is 0 or NaN
        const capital = settings.totalCapital > 0 ? settings.totalCapital : 0.006;
        const tradeAmount = settings.maxTradeAmount > 0 ? settings.maxTradeAmount : 0.0006;
        const availableForTrades = capital * 0.7;
        const trades = Math.floor(availableForTrades / (tradeAmount + gasCost));
        setRecommendedTrades(Math.min(trades, 15));
    }, [settings]);
    
    // FIX: guard against NaN in display calculations
    const capital = settings.totalCapital > 0 ? settings.totalCapital : 0;
    const tradeAmount = settings.maxTradeAmount > 0 ? settings.maxTradeAmount : 0;
    const rupiahEquivalent = capital * 3000 * 18000;
    const tradePercent = capital > 0 ? Math.floor(tradeAmount / capital * 100) : 0;
    
    return (
        <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto border border-gray-700 shadow-2xl">
                
                {/* Header with Modal Info */}
                <div className="sticky top-0 bg-gradient-to-r from-green-900/50 to-blue-900/50 p-6 border-b border-gray-700 backdrop-blur">
                    <div className="flex justify-between items-start">
                        <div>
                            <h2 className="text-2xl font-bold text-white">💎 Modal Kecil Sniper</h2>
                            <p className="text-gray-400 text-sm mt-1">Optimized untuk Rp100.000 - Rp200.000</p>
                        </div>
                        <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">&times;</button>
                    </div>
                    
                    {/* Balance Card */}
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
                    
                    {/* Warning Card */}
                    <div className="bg-yellow-900/30 border border-yellow-600 rounded-xl p-4">
                        <div className="flex gap-3">
                            <span className="text-yellow-500 text-xl">⚠️</span>
                            <div className="text-sm text-yellow-300">
                                <p className="font-bold">Peringatan Modal Kecil:</p>
                                <p className="text-yellow-200/80 mt-1">
                                    Dengan modal {capital.toFixed(3)} ETH, Anda hanya bisa melakukan ~{recommendedTrades} kali snipe.
                                    <strong className="block mt-1">FOKUS ke COPY TRADING</strong> - jangan snipe langsung!
                                </p>
                            </div>
                        </div>
                    </div>
                    
                    {/* ========== MANAJEMEN MODAL ========== */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
                        <h3 className="text-lg font-semibold text-white mb-4">💰 Manajemen Modal (100rb)</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Total Modal (ETH)</label>
                                <input
                                    type="number"
                                    step="0.001"
                                    min="0.001"
                                    value={settings.totalCapital}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        if (!isNaN(val)) setSettings({...settings, totalCapital: val});
                                    }}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white"
                                />
                                <p className="text-xs text-gray-500 mt-1">0.006 ETH = ~Rp100.000</p>
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Max Trade per Snipe (ETH)</label>
                                <input
                                    type="number"
                                    step="0.0001"
                                    min="0.0001"
                                    value={settings.maxTradeAmount}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        if (!isNaN(val)) setSettings({...settings, maxTradeAmount: val});
                                    }}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white"
                                />
                                <p className="text-xs text-green-400 mt-1">✅ Rekomendasi: 10-15% dari modal</p>
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Min Liquidity (ETH)</label>
                                <input
                                    type="number"
                                    step="0.05"
                                    min="0"
                                    value={settings.minLiquidity}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        if (!isNaN(val)) setSettings({...settings, minLiquidity: val});
                                    }}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white"
                                />
                                <p className="text-xs text-gray-500 mt-1">Rekomendasi: 0.15 - 0.5 ETH</p>
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Max Slippage (%)</label>
                                <input
                                    type="number"
                                    step="1"
                                    min="1"
                                    max="50"
                                    value={settings.maxSlippage}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        if (!isNaN(val)) setSettings({...settings, maxSlippage: val});
                                    }}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white"
                                />
                                <p className="text-xs text-yellow-400 mt-1">⚠️ Modal kecil bisa lebih tinggi (10-20%)</p>
                            </div>
                        </div>
                    </div>
                    
                    {/* ========== EXIT STRATEGY ========== */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
                        <h3 className="text-lg font-semibold text-white mb-4">📈 Exit Strategy (Ambil Untung Cepat)</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="bg-gray-900 rounded-lg p-3">
                                <div className="text-gray-400 text-sm mb-2">Take Profit 1</div>
                                <div className="flex items-center gap-3 mb-2">
                                    <input
                                        type="number"
                                        step="0.5"
                                        min="1"
                                        value={settings.tp1Multiplier}
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value);
                                            if (!isNaN(val)) setSettings({...settings, tp1Multiplier: val});
                                        }}
                                        className="w-24 bg-gray-800 border border-gray-700 rounded p-1 text-white"
                                    />
                                    <span className="text-green-400">x</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-400">Jual</span>
                                    <input
                                        type="number"
                                        step="10"
                                        min="1"
                                        max="100"
                                        value={settings.tp1Percentage}
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value);
                                            if (!isNaN(val)) setSettings({...settings, tp1Percentage: val});
                                        }}
                                        className="w-20 bg-gray-800 border border-gray-700 rounded p-1 text-white text-sm"
                                    />
                                    <span className="text-xs text-gray-400">% posisi</span>
                                </div>
                            </div>
                            <div className="bg-gray-900 rounded-lg p-3">
                                <div className="text-gray-400 text-sm mb-2">Take Profit 2</div>
                                <div className="flex items-center gap-3 mb-2">
                                    <input
                                        type="number"
                                        step="0.5"
                                        min="1"
                                        value={settings.tp2Multiplier}
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value);
                                            if (!isNaN(val)) setSettings({...settings, tp2Multiplier: val});
                                        }}
                                        className="w-24 bg-gray-800 border border-gray-700 rounded p-1 text-white"
                                    />
                                    <span className="text-green-400">x</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-400">Jual</span>
                                    <input
                                        type="number"
                                        step="10"
                                        min="1"
                                        max="100"
                                        value={settings.tp2Percentage}
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value);
                                            if (!isNaN(val)) setSettings({...settings, tp2Percentage: val});
                                        }}
                                        className="w-20 bg-gray-800 border border-gray-700 rounded p-1 text-white text-sm"
                                    />
                                    <span className="text-xs text-gray-400">% posisi</span>
                                </div>
                            </div>
                            <div className="bg-gray-900 rounded-lg p-3">
                                <div className="text-gray-400 text-sm">Stop Loss</div>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="number"
                                        step="5"
                                        min="1"
                                        max="99"
                                        value={settings.stopLoss}
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value);
                                            if (!isNaN(val)) setSettings({...settings, stopLoss: val});
                                        }}
                                        className="w-24 bg-gray-800 border border-gray-700 rounded p-1 text-white"
                                    />
                                    <span className="text-red-400">%</span>
                                    <span className="text-sm text-gray-400">jual SEMUA</span>
                                </div>
                                <p className="text-xs text-red-400 mt-1">Potong rugi di -{settings.stopLoss}%</p>
                            </div>
                        </div>
                    </div>
                    
                    {/* ========== GAS SETTINGS ========== */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
                        <h3 className="text-lg font-semibold text-white mb-4">⛽ Gas Settings (Modal Kecil)</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Max Priority Fee (Gwei)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    value={settings.maxPriorityFee}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        if (!isNaN(val)) setSettings({...settings, maxPriorityFee: val});
                                    }}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white"
                                />
                                <p className="text-xs text-blue-400 mt-1">⚡ Super rendah, jangan ikut gas war!</p>
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Max Fee per Gas (Gwei)</label>
                                <input
                                    type="number"
                                    step="0.5"
                                    min="0"
                                    value={settings.maxFeePerGas}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        if (!isNaN(val)) setSettings({...settings, maxFeePerGas: val});
                                    }}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white"
                                />
                            </div>
                        </div>
                        <div className="mt-3 p-3 bg-blue-900/30 rounded">
                            <p className="text-sm text-blue-300">💡 Tips: Dengan gas {settings.maxFeePerGas} Gwei, transaksi akan lebih lambat tapi lebih murah. Cukup untuk copy trading!</p>
                        </div>
                    </div>
                    
                    {/* ========== COPY TRADING ========== */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-green-500/30">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold text-white">🐋 Copy Trading (WAJIB untuk modal kecil)</h3>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={settings.copyEnabled}
                                    onChange={(e) => setSettings({...settings, copyEnabled: e.target.checked})}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                            </label>
                        </div>
                        
                        {settings.copyEnabled && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">Copy Amount (ETH)</label>
                                    <input
                                        type="number"
                                        step="0.0001"
                                        min="0.0001"
                                        value={settings.copyAmount}
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value);
                                            if (!isNaN(val)) setSettings({...settings, copyAmount: val});
                                        }}
                                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">50% dari max trade ({(settings.maxTradeAmount * 0.5).toFixed(4)} ETH)</p>
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">Copy Delay (detik)</label>
                                    <input
                                        type="number"
                                        step="0.5"
                                        min="0"
                                        value={settings.copyDelay}
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value);
                                            if (!isNaN(val)) setSettings({...settings, copyDelay: val});
                                        }}
                                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Delay setelah whale buy</p>
                                </div>
                            </div>
                        )}
                        
                        {!settings.copyEnabled && (
                            <div className="p-3 bg-yellow-900/30 rounded">
                                <p className="text-sm text-yellow-400">⚠️ Copy trading dimatikan! Dengan modal kecil, sangat tidak disarankan snipe langsung.</p>
                            </div>
                        )}
                    </div>
                    
                    {/* ========== DCA SETTINGS ========== */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-gray-700">
                        <div className="flex justify-between items-center">
                            <div>
                                <h3 className="text-lg font-semibold text-white">📉 DCA on Dip</h3>
                                <p className="text-xs text-gray-400 mt-0.5">Beli lagi saat harga turun setelah TP1 (tidak direkomendasikan modal kecil &lt; 0.003 ETH)</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer ml-4 flex-shrink-0">
                                <input
                                    type="checkbox"
                                    checked={settings.dcaEnabled}
                                    onChange={(e) => setSettings({...settings, dcaEnabled: e.target.checked})}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                            </label>
                        </div>
                        {settings.dcaEnabled && (
                            <div className="mt-3 p-3 bg-blue-900/20 rounded-lg border border-blue-800/40">
                                <p className="text-xs text-blue-300">💡 DCA aktif: Bot akan beli 50% dari posisi awal saat harga turun ke 98% dari entry setelah TP1 tercapai.</p>
                            </div>
                        )}
                        {!settings.dcaEnabled && (
                            <div className="mt-3 p-3 bg-yellow-900/20 rounded-lg border border-yellow-800/40">
                                <p className="text-xs text-yellow-300">⚠️ DCA dimatikan. Direkomendasikan untuk modal &lt; 0.003 ETH agar tidak kehabisan modal.</p>
                            </div>
                        )}
                    </div>

                    {/* ========== DYNAMIC SIZING ========== */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-cyan-900/40">
                        <div className="flex justify-between items-center mb-3">
                            <div>
                                <h3 className="text-lg font-semibold text-white">📊 Dynamic Position Sizing</h3>
                                <p className="text-xs text-gray-400 mt-0.5">Ukuran trade menyesuaikan saldo WETH otomatis — makin besar saldo, makin besar posisi</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer ml-4 flex-shrink-0">
                                <input
                                    type="checkbox"
                                    checked={settings.dynamicSizingEnabled}
                                    onChange={(e) => setSettings({...settings, dynamicSizingEnabled: e.target.checked})}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                            </label>
                        </div>
                        {settings.dynamicSizingEnabled && (
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">% Saldo per Trade</label>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="range"
                                            min="3"
                                            max="25"
                                            step="1"
                                            value={settings.tradeBalancePct}
                                            onChange={(e) => setSettings({...settings, tradeBalancePct: parseInt(e.target.value)})}
                                            className="flex-1 accent-cyan-500"
                                        />
                                        <span className="text-cyan-400 font-bold w-12 text-right">{settings.tradeBalancePct}%</span>
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                    <div className="p-2 bg-cyan-900/20 rounded border border-cyan-800/40">
                                        <div className="text-gray-400">Modal $6 (~0.002 ETH)</div>
                                        <div className="text-cyan-300 font-bold mt-1">≈ ${(6 * settings.tradeBalancePct / 100).toFixed(2)} per trade</div>
                                    </div>
                                    <div className="p-2 bg-cyan-900/20 rounded border border-cyan-800/40">
                                        <div className="text-gray-400">Jika tumbuh ke $30</div>
                                        <div className="text-cyan-300 font-bold mt-1">≈ ${(30 * settings.tradeBalancePct / 100).toFixed(2)} per trade</div>
                                    </div>
                                    <div className="p-2 bg-cyan-900/20 rounded border border-cyan-800/40">
                                        <div className="text-gray-400">Jika tumbuh ke $100</div>
                                        <div className="text-cyan-300 font-bold mt-1">≈ ${(100 * settings.tradeBalancePct / 100).toFixed(2)} per trade</div>
                                    </div>
                                </div>
                                <div className="p-3 bg-cyan-900/20 rounded-lg border border-cyan-800/40">
                                    <p className="text-xs text-cyan-300">💡 AI confidence multiplier diterapkan: kepercayaan tinggi (≥90%) = 1.5x, rendah = 0.6x. Maks 30% saldo, min 0.001 ETH.</p>
                                </div>
                            </div>
                        )}
                        {!settings.dynamicSizingEnabled && (
                            <div className="p-3 bg-yellow-900/20 rounded-lg border border-yellow-800/40">
                                <p className="text-xs text-yellow-300">⚠️ Dynamic sizing dinonaktifkan. Bot akan pakai nilai <strong>Max Trade per Snipe</strong> yang tetap.</p>
                            </div>
                        )}
                    </div>

                    {/* ========== GECKOTERMINAL SCANNER ========== */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-emerald-900/40">
                        <div className="flex justify-between items-center mb-3">
                            <div>
                                <h3 className="text-lg font-semibold text-white">🦎 GeckoTerminal Token Scanner</h3>
                                <p className="text-xs text-gray-400 mt-0.5">Pindai token baru & trending di Base secara independen dari copy trading</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer ml-4 flex-shrink-0">
                                <input
                                    type="checkbox"
                                    checked={settings.geckoScannerEnabled}
                                    onChange={(e) => setSettings({...settings, geckoScannerEnabled: e.target.checked})}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                            </label>
                        </div>
                        {settings.geckoScannerEnabled ? (
                            <div className="space-y-2">
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className="p-2 bg-emerald-900/20 rounded border border-emerald-800/40">
                                        <div className="text-emerald-400 font-semibold">🔄 Pool Baru</div>
                                        <div className="text-gray-400 mt-0.5">Scan setiap 30 detik</div>
                                    </div>
                                    <div className="p-2 bg-emerald-900/20 rounded border border-emerald-800/40">
                                        <div className="text-emerald-400 font-semibold">📈 Trending</div>
                                        <div className="text-gray-400 mt-0.5">Scan setiap 2 menit</div>
                                    </div>
                                    <div className="p-2 bg-emerald-900/20 rounded border border-emerald-800/40">
                                        <div className="text-emerald-400 font-semibold">🛡️ GoPlus Safety</div>
                                        <div className="text-gray-400 mt-0.5">Cek honeypot & rug</div>
                                    </div>
                                    <div className="p-2 bg-emerald-900/20 rounded border border-emerald-800/40">
                                        <div className="text-emerald-400 font-semibold">🤖 AI Seleksi</div>
                                        <div className="text-gray-400 mt-0.5">Min score {settings.geckoScannerEnabled ? '75' : '—'}/100</div>
                                    </div>
                                </div>
                                <div className="p-3 bg-emerald-900/20 rounded-lg border border-emerald-800/40">
                                    <p className="text-xs text-emerald-300">✅ Scanner aktif: bot tidak hanya bergantung pada copy trade. Token yang ditemukan dianalisis AI sebelum dibeli. Tidak serakah — ambil untung di target, stop loss ketat.</p>
                                </div>
                            </div>
                        ) : (
                            <div className="p-3 bg-yellow-900/20 rounded-lg border border-yellow-800/40">
                                <p className="text-xs text-yellow-300">⚠️ Scanner dinonaktifkan. Bot hanya akan trading melalui copy trade whale.</p>
                            </div>
                        )}
                    </div>

                    {/* ========== WHALE VALIDATION & AUTO-SCAN ========== */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-purple-900/40">
                        <h3 className="text-lg font-semibold text-white mb-4">🐋 Whale Finder & Validasi</h3>
                        <div className="space-y-4">
                            {/* Validation Gate */}
                            <div className="flex justify-between items-center">
                                <div>
                                    <p className="text-sm text-white font-medium">🔒 Gate Validasi Manual</p>
                                    <p className="text-xs text-gray-400 mt-0.5">Wallet whale harus disetujui oleh kamu sebelum di-copy</p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer ml-4 flex-shrink-0">
                                    <input
                                        type="checkbox"
                                        checked={settings.whaleValidationEnabled}
                                        onChange={(e) => setSettings({...settings, whaleValidationEnabled: e.target.checked})}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                                </label>
                            </div>
                            {/* Auto-Scan */}
                            <div className="flex justify-between items-center">
                                <div>
                                    <p className="text-sm text-white font-medium">🔍 Auto Whale Scan</p>
                                    <p className="text-xs text-gray-400 mt-0.5">Cari wallet whale otomatis via GeckoTerminal (cooldown 15 menit)</p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer ml-4 flex-shrink-0">
                                    <input
                                        type="checkbox"
                                        checked={settings.whaleAutoScanEnabled}
                                        onChange={(e) => setSettings({...settings, whaleAutoScanEnabled: e.target.checked})}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                                </label>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                <div className="p-2 bg-purple-900/20 rounded border border-purple-800/40">
                                    <div className="text-purple-400 font-semibold">Win Rate</div>
                                    <div className="text-gray-300 mt-0.5">≥ 55%</div>
                                </div>
                                <div className="p-2 bg-purple-900/20 rounded border border-purple-800/40">
                                    <div className="text-purple-400 font-semibold">Min Trades</div>
                                    <div className="text-gray-300 mt-0.5">≥ 8 trade</div>
                                </div>
                                <div className="p-2 bg-purple-900/20 rounded border border-purple-800/40">
                                    <div className="text-purple-400 font-semibold">Min Score</div>
                                    <div className="text-gray-300 mt-0.5">≥ 60/100</div>
                                </div>
                            </div>
                            <div className="p-3 bg-purple-900/20 rounded-lg border border-purple-800/40">
                                <p className="text-xs text-purple-300">🐋 Kelola wallet whale di tombol <strong>Whale</strong> di header — tab Auto Finder untuk approve/reject kandidat yang ditemukan bot.</p>
                            </div>
                        </div>
                    </div>

                    {/* ========== SERIAL RUGGER DETECTION ========== */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-red-900/40">
                        <div className="flex justify-between items-center mb-4">
                            <div>
                                <h3 className="text-lg font-semibold text-white">🚨 Serial Rugger Detection</h3>
                                <p className="text-xs text-gray-400 mt-0.5">
                                    Blokir otomatis token dari wallet yang baru deploy banyak kontrak (serial rugger)
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer ml-4 flex-shrink-0">
                                <input
                                    type="checkbox"
                                    checked={settings.serialRuggerEnabled}
                                    onChange={(e) => setSettings({...settings, serialRuggerEnabled: e.target.checked})}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
                            </label>
                        </div>

                        {settings.serialRuggerEnabled && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">
                                        Max Deploy dalam Window
                                    </label>
                                    <input
                                        type="number"
                                        step="1"
                                        min="1"
                                        max="20"
                                        value={settings.serialRuggerMaxDeploys}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            if (!isNaN(val)) setSettings({...settings, serialRuggerMaxDeploys: val});
                                        }}
                                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        Blokir jika deployer &gt; {settings.serialRuggerMaxDeploys} kontrak
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">
                                        Window Waktu (jam)
                                    </label>
                                    <input
                                        type="number"
                                        step="1"
                                        min="1"
                                        max="168"
                                        value={settings.serialRuggerWindowHours}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            if (!isNaN(val)) setSettings({...settings, serialRuggerWindowHours: val});
                                        }}
                                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        Periksa {settings.serialRuggerWindowHours}j terakhir
                                    </p>
                                </div>
                                <div className="md:col-span-2 p-3 bg-red-900/20 rounded-lg border border-red-800/40">
                                    <p className="text-xs text-red-300">
                                        🚨 Jika deployer token membuat lebih dari <strong>{settings.serialRuggerMaxDeploys} kontrak</strong> dalam <strong>{settings.serialRuggerWindowHours} jam</strong> terakhir, token otomatis diblacklist dan masuk ke daftar Blokir.
                                    </p>
                                </div>
                            </div>
                        )}

                        {!settings.serialRuggerEnabled && (
                            <div className="p-3 bg-yellow-900/20 rounded-lg border border-yellow-800/40">
                                <p className="text-xs text-yellow-300">⚠️ Serial rugger detection dinonaktifkan. Bot tidak akan memeriksa riwayat deploy kontrak.</p>
                            </div>
                        )}
                    </div>

                    {/* ── Deployer Reputation ── */}
                    <div className="bg-gray-800/50 rounded-xl p-5 border border-purple-900/40">
                        <div className="flex justify-between items-center mb-4">
                            <div>
                                <h3 className="text-lg font-semibold text-white">⭐ Skor Reputasi Deployer</h3>
                                <p className="text-xs text-gray-400 mt-0.5">
                                    Cek riwayat token deployer via GeckoTerminal — token mati = rug → skor rendah → tolak
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer ml-4 flex-shrink-0">
                                <input
                                    type="checkbox"
                                    checked={settings.reputationEnabled}
                                    onChange={(e) => setSettings({...settings, reputationEnabled: e.target.checked})}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                            </label>
                        </div>

                        {settings.reputationEnabled && (
                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">
                                        Skor Minimum (0–100)
                                    </label>
                                    <input
                                        type="number"
                                        step="5"
                                        min="0"
                                        max="100"
                                        value={settings.reputationMinScore}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            if (!isNaN(val)) setSettings({...settings, reputationMinScore: val});
                                        }}
                                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        Tolak token jika skor deployer di bawah {settings.reputationMinScore}/100
                                    </p>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                    <div className="p-2 bg-green-900/30 rounded border border-green-800/40">
                                        <div className="text-green-400 font-bold">⭐ Tepercaya</div>
                                        <div className="text-gray-400">Skor ≥ 65</div>
                                        <div className="text-gray-500 mt-0.5">Token-token sebelumnya masih aktif</div>
                                    </div>
                                    <div className="p-2 bg-yellow-900/30 rounded border border-yellow-800/40">
                                        <div className="text-yellow-400 font-bold">🟡 Netral</div>
                                        <div className="text-gray-400">Skor 35–64</div>
                                        <div className="text-gray-500 mt-0.5">Campuran hidup dan mati</div>
                                    </div>
                                    <div className="p-2 bg-red-900/30 rounded border border-red-800/40">
                                        <div className="text-red-400 font-bold">🔴 Berisiko</div>
                                        <div className="text-gray-400">Skor &lt; 35</div>
                                        <div className="text-gray-500 mt-0.5">Sebagian besar token mati</div>
                                    </div>
                                </div>
                                <div className="p-3 bg-purple-900/20 rounded-lg border border-purple-800/40">
                                    <p className="text-xs text-purple-300">
                                        ⭐ Bot memeriksa hingga 5 token terakhir deployer di GeckoTerminal. Token dengan likuiditas &gt; $500 = hidup. Token tanpa likuiditas = mati (kemungkinan rug). Skor = 50 + (hidup × 15) − (mati × 20). Jika data kurang dari 2 token, cek dilewati (fail-open).
                                    </p>
                                </div>
                            </div>
                        )}

                        {!settings.reputationEnabled && (
                            <div className="p-3 bg-yellow-900/20 rounded-lg border border-yellow-800/40">
                                <p className="text-xs text-yellow-300">⚠️ Skor reputasi dinonaktifkan. Bot tidak akan memeriksa riwayat token deployer.</p>
                            </div>
                        )}
                    </div>

                    {/* ========== STRATEGY CARD ========== */}
                    <div className="bg-gradient-to-r from-green-900/20 to-blue-900/20 rounded-xl p-5 border border-green-500/20">
                        <h4 className="font-bold text-white mb-3">🎯 Strategi Modal di Bawah $10 (Base Network)</h4>
                        <div className="text-sm text-gray-300 space-y-2">
                            <p>✅ 1. <strong>COPY TRADING + GECKO SCANNER</strong> — Dua sumber peluang, bukan satu</p>
                            <p>✅ 2. <strong>Dynamic sizing</strong> — Modal $6 beli kecil, tumbuh ke $30 beli lebih besar otomatis</p>
                            <p>✅ 3. <strong>Ambil untung di TP1 ({settings.tp1Multiplier}x) - TP2 ({settings.tp2Multiplier}x)</strong> — Jangan serakah</p>
                            <p>✅ 4. <strong>Stop loss ketat -{settings.stopLoss}%</strong> — Lindungi modal utama</p>
                            <p>✅ 5. <strong>Validasi whale manual</strong> — Kamu yang putuskan, bot tidak sembarangan copy</p>
                            <p>✅ 6. <strong>Gas Base sangat murah</strong> — ~$0.01 per swap, jauh lebih hemat dari Ethereum</p>
                            <p>✅ 7. <strong>Simulasi sebelum copy</strong> — Estimasi profit/loss ditampilkan sebelum eksekusi</p>
                        </div>
                        <div className="mt-3 p-3 bg-green-900/30 rounded-lg border border-green-700/40">
                            <p className="text-xs text-green-300">💡 Semua data harga dari <strong>GeckoTerminal</strong> (Base network). Uniswap V3 Router Base: gas ~150,000 units ≈ $0.01 per trade.</p>
                        </div>
                    </div>
                    
                </div>
                
                {/* Footer */}
                <div className="sticky bottom-0 bg-gray-900 p-6 border-t border-gray-700 flex gap-3">
                    <button
                        onClick={() => onSave(settings)}
                        className="flex-1 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 py-3 rounded-xl font-semibold transition-all"
                    >
                        💾 Apply Settings untuk Modal {capital.toFixed(3)} ETH
                    </button>
                    <button
                        onClick={onClose}
                        className="px-6 bg-gray-700 hover:bg-gray-600 py-3 rounded-xl font-semibold transition-all"
                    >
                        Close
                    </button>
                </div>
                
            </div>
        </div>
    );
};

export default Modal100k;
