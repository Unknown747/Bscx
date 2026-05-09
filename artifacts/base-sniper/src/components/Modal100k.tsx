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
}

const Modal100k: React.FC<Modal100kProps> = ({ onSave, onClose, currentBalance = 0.006 }) => {
    const [settings, setSettings] = useState<ModalSettings>({
        totalCapital: 0.006,
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
        copyDelay: 2
    });
    
    const [estimatedGasCost, setEstimatedGasCost] = useState(0.00015);
    const [recommendedTrades, setRecommendedTrades] = useState(0);
    
    useEffect(() => {
        // Calculate estimated gas cost based on settings
        const gasCost = (settings.maxFeePerGas * 21000) / 1e9;
        setEstimatedGasCost(gasCost);
        
        // Calculate how many trades can be done
        const availableForTrades = settings.totalCapital * 0.7; // 70% for trades, 30% for gas
        const trades = Math.floor(availableForTrades / (settings.maxTradeAmount + gasCost));
        setRecommendedTrades(Math.min(trades, 15));
    }, [settings]);
    
    const rupiahEquivalent = settings.totalCapital * 3000 * 18000; // ETH * USD * IDR approx
    
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
                                <div className="text-2xl font-bold text-white">{settings.totalCapital.toFixed(4)} ETH</div>
                                <div className="text-green-400 text-sm">≈ Rp{(rupiahEquivalent / 1000).toFixed(0)}rb</div>
                            </div>
                            <div>
                                <div className="text-gray-400 text-sm">Per Snipe</div>
                                <div className="text-xl font-bold text-yellow-400">{settings.maxTradeAmount.toFixed(4)} ETH</div>
                                <div className="text-gray-400 text-xs">≈ {Math.floor(settings.maxTradeAmount / settings.totalCapital * 100)}% dari modal</div>
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
                                    Dengan modal {settings.totalCapital.toFixed(3)} ETH, Anda hanya bisa melakukan ~{recommendedTrades} kali snipe.
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
                                    value={settings.totalCapital}
                                    onChange={(e) => setSettings({...settings, totalCapital: parseFloat(e.target.value)})}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white"
                                />
                                <p className="text-xs text-gray-500 mt-1">0.006 ETH = ~Rp100.000</p>
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Max Trade per Snipe (ETH)</label>
                                <input
                                    type="number"
                                    step="0.0001"
                                    value={settings.maxTradeAmount}
                                    onChange={(e) => setSettings({...settings, maxTradeAmount: parseFloat(e.target.value)})}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white"
                                />
                                <p className="text-xs text-green-400 mt-1">✅ Rekomendasi: 10-15% dari modal</p>
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Min Liquidity (ETH)</label>
                                <input
                                    type="number"
                                    step="0.05"
                                    value={settings.minLiquidity}
                                    onChange={(e) => setSettings({...settings, minLiquidity: parseFloat(e.target.value)})}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white"
                                />
                                <p className="text-xs text-gray-500 mt-1">Rekomendasi: 0.15 - 0.5 ETH</p>
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Max Slippage (%)</label>
                                <input
                                    type="number"
                                    step="1"
                                    value={settings.maxSlippage}
                                    onChange={(e) => setSettings({...settings, maxSlippage: parseFloat(e.target.value)})}
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
                                <div className="text-gray-400 text-sm">Take Profit 1</div>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="number"
                                        step="0.5"
                                        value={settings.tp1Multiplier}
                                        onChange={(e) => setSettings({...settings, tp1Multiplier: parseFloat(e.target.value)})}
                                        className="w-24 bg-gray-800 border border-gray-700 rounded p-1 text-white"
                                    />
                                    <span className="text-green-400">x</span>
                                    <span className="text-sm text-gray-400">jual {settings.tp1Percentage}%</span>
                                </div>
                            </div>
                            <div className="bg-gray-900 rounded-lg p-3">
                                <div className="text-gray-400 text-sm">Take Profit 2</div>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="number"
                                        step="0.5"
                                        value={settings.tp2Multiplier}
                                        onChange={(e) => setSettings({...settings, tp2Multiplier: parseFloat(e.target.value)})}
                                        className="w-24 bg-gray-800 border border-gray-700 rounded p-1 text-white"
                                    />
                                    <span className="text-green-400">x</span>
                                    <span className="text-sm text-gray-400">jual {settings.tp2Percentage}%</span>
                                </div>
                            </div>
                            <div className="bg-gray-900 rounded-lg p-3">
                                <div className="text-gray-400 text-sm">Stop Loss</div>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="number"
                                        step="5"
                                        value={settings.stopLoss}
                                        onChange={(e) => setSettings({...settings, stopLoss: parseFloat(e.target.value)})}
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
                                    value={settings.maxPriorityFee}
                                    onChange={(e) => setSettings({...settings, maxPriorityFee: parseFloat(e.target.value)})}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white"
                                />
                                <p className="text-xs text-blue-400 mt-1">⚡ Super rendah, jangan ikut gas war!</p>
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Max Fee per Gas (Gwei)</label>
                                <input
                                    type="number"
                                    step="0.5"
                                    value={settings.maxFeePerGas}
                                    onChange={(e) => setSettings({...settings, maxFeePerGas: parseFloat(e.target.value)})}
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
                                        value={settings.copyAmount}
                                        onChange={(e) => setSettings({...settings, copyAmount: parseFloat(e.target.value)})}
                                        className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">50% dari max trade ({settings.maxTradeAmount * 0.5} ETH)</p>
                                </div>
                                <div>
                                    <label className="block text-sm text-gray-400 mb-1">Copy Delay (detik)</label>
                                    <input
                                        type="number"
                                        step="0.5"
                                        value={settings.copyDelay}
                                        onChange={(e) => setSettings({...settings, copyDelay: parseFloat(e.target.value)})}
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
                    
                    {/* ========== STRATEGY CARD ========== */}
                    <div className="bg-gradient-to-r from-green-900/20 to-blue-900/20 rounded-xl p-5 border border-green-500/20">
                        <h4 className="font-bold text-white mb-2">🎯 Strategi Modal 100rb</h4>
                        <div className="text-sm text-gray-300 space-y-2">
                            <p>✅ 1. <strong>FOKUS COPY TRADING</strong> - Jangan snipe langsung, ikuti whale</p>
                            <p>✅ 2. <strong>Ambil untung di 1.5x - 2x</strong> - Jangan serakah</p>
                            <p>✅ 3. <strong>Potong rugi di -30%</strong> - Lindungi modal</p>
                            <p>✅ 4. <strong>Maksimal 10 kali copy per hari</strong> - Spread risk</p>
                            <p>✅ 5. <strong>Jangan all-in</strong> - Selalu sisakan untuk gas</p>
                        </div>
                    </div>
                    
                </div>
                
                {/* Footer */}
                <div className="sticky bottom-0 bg-gray-900 p-6 border-t border-gray-700 flex gap-3">
                    <button
                        onClick={() => onSave(settings)}
                        className="flex-1 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 py-3 rounded-xl font-semibold transition-all"
                    >
                        💾 Apply Settings untuk Modal {settings.totalCapital.toFixed(3)} ETH
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
