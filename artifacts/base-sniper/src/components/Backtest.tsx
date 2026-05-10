import React, { useState, useCallback } from 'react';
import { authFetch } from '../lib/authFetch';

interface BacktestConfig {
    tp1Multiplier:       number;
    tp1Percentage:       number;
    tp2Multiplier:       number;
    tp2Percentage:       number;
    stopLossPct:         number;
    trailingActivatePct: number;
    trailingFromPeakPct: number;
    maxHoldCandles:      number;
}

interface BacktestTrade {
    entryIndex:  number;
    entryPrice:  number;
    exitPrice:   number;
    profitPct:   number;
    holdCandles: number;
    exitReason:  'TP1' | 'TP2' | 'TrailingTP3' | 'StopLoss' | 'Timeout';
    tp1Hit:      boolean;
    tp2Hit:      boolean;
}

interface BacktestResult {
    tokenAddress: string;
    poolAddress:  string;
    timeframe:    string;
    totalTrades:  number;
    wins:         number;
    losses:       number;
    winRate:      number;
    avgProfit:    number;
    totalReturn:  number;
    maxDrawdown:  number;
    bestTrade:    number;
    worstTrade:   number;
    sharpe:       number;
    trades:       BacktestTrade[];
    config:       BacktestConfig;
    candleCount:  number;
    note:         string;
}

const EXIT_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
    TP1:          { icon: '🎯', color: 'text-green-400',  label: 'TP1' },
    TP2:          { icon: '🚀', color: 'text-blue-400',   label: 'TP2' },
    TrailingTP3:  { icon: '🏆', color: 'text-purple-400', label: 'TP3 Trail' },
    StopLoss:     { icon: '🛑', color: 'text-red-400',    label: 'Stop Loss' },
    Timeout:      { icon: '⏱️', color: 'text-yellow-400', label: 'Timeout' },
};

interface Props { apiUrl: string; }

const Backtest: React.FC<Props> = ({ apiUrl }) => {
    const [tokenAddress, setTokenAddress] = useState('');
    const [timeframe, setTimeframe]       = useState<'1h' | '15m'>('1h');
    const [loading, setLoading]           = useState(false);
    const [result, setResult]             = useState<BacktestResult | null>(null);
    const [error, setError]               = useState('');
    const [showTrades, setShowTrades]     = useState(false);

    // Custom TP config
    const [tp1Mult, setTp1Mult]   = useState('1.5');
    const [tp1Pct, setTp1Pct]     = useState('30');
    const [tp2Mult, setTp2Mult]   = useState('2.5');
    const [tp2Pct, setTp2Pct]     = useState('30');
    const [slPct, setSlPct]       = useState('20');
    const [showConfig, setShowConfig] = useState(false);

    const runBacktest = useCallback(async () => {
        const addr = tokenAddress.trim();
        if (!addr.match(/^0x[0-9a-fA-F]{40}$/i)) {
            setError('Masukkan alamat token yang valid (0x...)');
            return;
        }
        setLoading(true);
        setError('');
        setResult(null);
        try {
            const res = await authFetch(`${apiUrl}/api/backtest`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    tokenAddress: addr,
                    timeframe,
                    config: {
                        tp1Multiplier:  parseFloat(tp1Mult) || 1.5,
                        tp1Percentage:  parseFloat(tp1Pct)  || 30,
                        tp2Multiplier:  parseFloat(tp2Mult) || 2.5,
                        tp2Percentage:  parseFloat(tp2Pct)  || 30,
                        stopLossPct:    parseFloat(slPct)   || 20,
                    },
                }),
            });
            const json = await res.json();
            if (!res.ok) { setError(json.error || 'Terjadi kesalahan'); return; }
            setResult(json);
            setShowTrades(false);
        } catch {
            setError('Gagal terhubung ke server');
        } finally {
            setLoading(false);
        }
    }, [apiUrl, tokenAddress, timeframe, tp1Mult, tp1Pct, tp2Mult, tp2Pct, slPct]);

    const tp1TargetPct = ((parseFloat(tp1Mult) || 1.5) - 1) * 100;
    const tp2TargetPct = ((parseFloat(tp2Mult) || 2.5) - 1) * 100;

    const tp1Trades = result?.trades.filter(t => t.exitReason === 'TP1').length ?? 0;
    const tp2Trades = result?.trades.filter(t => t.exitReason === 'TP2').length ?? 0;
    const tp3Trades = result?.trades.filter(t => t.exitReason === 'TrailingTP3').length ?? 0;
    const slTrades  = result?.trades.filter(t => t.exitReason === 'StopLoss').length ?? 0;
    const toTrades  = result?.trades.filter(t => t.exitReason === 'Timeout').length ?? 0;

    return (
        <div className="space-y-4 pb-6">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-300">Backtest OHLCV</h2>
                <span className="text-xs text-gray-600">Data historis GeckoTerminal</span>
            </div>

            {/* Input Card */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                <div>
                    <label className="text-xs text-gray-500 mb-1 block">Alamat Token (Base)</label>
                    <input
                        type="text"
                        value={tokenAddress}
                        onChange={e => setTokenAddress(e.target.value)}
                        placeholder="0x..."
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500 transition-colors font-mono"
                    />
                </div>

                <div className="flex gap-2">
                    {/* Timeframe toggle */}
                    <div className="flex bg-gray-800 rounded-lg p-1 gap-1">
                        {(['1h', '15m'] as const).map(tf => (
                            <button
                                key={tf}
                                onClick={() => setTimeframe(tf)}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                    timeframe === tf
                                        ? 'bg-green-600 text-white'
                                        : 'text-gray-500 hover:text-gray-300'
                                }`}
                            >
                                {tf}
                            </button>
                        ))}
                    </div>

                    {/* Config toggle */}
                    <button
                        onClick={() => setShowConfig(v => !v)}
                        className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-white text-xs px-3 py-1.5 rounded-lg transition-all"
                    >
                        <span>⚙️</span>
                        <span>TP/SL</span>
                    </button>

                    {/* Run button */}
                    <button
                        onClick={runBacktest}
                        disabled={loading}
                        className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold py-2 rounded-lg transition-all"
                    >
                        {loading
                            ? <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Memuat...</>
                            : <><span>▶</span> Jalankan Backtest</>
                        }
                    </button>
                </div>

                {/* Collapsible TP/SL config */}
                {showConfig && (
                    <div className="border-t border-gray-800 pt-3 grid grid-cols-2 gap-3">
                        {[
                            { label: `TP1 Target (${tp1TargetPct.toFixed(0)}% profit)`, value: tp1Mult, set: setTp1Mult, placeholder: '1.5x' },
                            { label: `TP1 Jual (%)`,                                      value: tp1Pct,  set: setTp1Pct,  placeholder: '30%' },
                            { label: `TP2 Target (${tp2TargetPct.toFixed(0)}% profit)`, value: tp2Mult, set: setTp2Mult, placeholder: '2.5x' },
                            { label: `TP2 Jual (%)`,                                      value: tp2Pct,  set: setTp2Pct,  placeholder: '30%' },
                            { label: `Stop Loss (%)`,                                      value: slPct,   set: setSlPct,   placeholder: '20%' },
                        ].map(({ label, value, set, placeholder }) => (
                            <div key={label}>
                                <label className="text-xs text-gray-600 mb-1 block">{label}</label>
                                <input
                                    type="number"
                                    value={value}
                                    onChange={e => set(e.target.value)}
                                    placeholder={placeholder}
                                    step="0.1"
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500 transition-colors"
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Error */}
            {error && (
                <div className="bg-red-900/30 border border-red-800 rounded-xl p-3 text-xs text-red-400">{error}</div>
            )}

            {/* Results */}
            {result && (
                <div className="space-y-3">
                    {/* Note / pool info */}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5 flex items-center justify-between">
                        <span className="text-xs text-gray-500">{result.note}</span>
                        {result.poolAddress && (
                            <a
                                href={`https://www.geckoterminal.com/base/pools/${result.poolAddress}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-500 hover:text-blue-400 transition-colors"
                            >
                                Pool ↗
                            </a>
                        )}
                    </div>

                    {result.totalTrades === 0 ? (
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
                            <p className="text-3xl mb-3">📭</p>
                            <p className="text-sm text-gray-500">Tidak ada data cukup untuk simulasi</p>
                            <p className="text-xs text-gray-700 mt-1">{result.note}</p>
                        </div>
                    ) : (
                        <>
                            {/* Stats grid */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                                    <p className="text-xs text-gray-500 mb-1">Win Rate</p>
                                    <p className={`text-2xl font-bold ${result.winRate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                                        {result.winRate.toFixed(1)}%
                                    </p>
                                    <p className="text-xs text-gray-600 mt-0.5">{result.wins}W / {result.losses}L dari {result.totalTrades} trade</p>
                                </div>
                                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                                    <p className="text-xs text-gray-500 mb-1">Total Return</p>
                                    <p className={`text-2xl font-bold ${result.totalReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                        {result.totalReturn >= 0 ? '+' : ''}{result.totalReturn.toFixed(1)}%
                                    </p>
                                    <p className="text-xs text-gray-600 mt-0.5">Rata-rata {result.avgProfit >= 0 ? '+' : ''}{result.avgProfit.toFixed(1)}% / trade</p>
                                </div>
                                <div className="bg-green-900/20 border border-green-800/40 rounded-xl p-4">
                                    <p className="text-xs text-gray-500 mb-1">Best Trade</p>
                                    <p className="text-xl font-bold text-green-400">+{result.bestTrade.toFixed(1)}%</p>
                                    <p className="text-xs text-green-700 mt-0.5">profit tertinggi</p>
                                </div>
                                <div className="bg-red-900/20 border border-red-800/40 rounded-xl p-4">
                                    <p className="text-xs text-gray-500 mb-1">Worst Trade</p>
                                    <p className="text-xl font-bold text-red-400">{result.worstTrade.toFixed(1)}%</p>
                                    <p className="text-xs text-red-700 mt-0.5">loss terbesar</p>
                                </div>
                            </div>

                            {/* Secondary stats */}
                            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
                                <h3 className="text-xs font-semibold text-gray-400 mb-2">Metrik Lanjutan</h3>
                                {[
                                    { label: 'Sharpe Ratio',  value: result.sharpe.toFixed(2),           color: result.sharpe > 1 ? 'text-green-400' : result.sharpe > 0 ? 'text-yellow-400' : 'text-red-400' },
                                    { label: 'Max Drawdown',  value: `-${result.maxDrawdown.toFixed(1)}%`, color: 'text-red-400' },
                                    { label: 'Total Candle',  value: `${result.candleCount} (${result.timeframe})`, color: 'text-white' },
                                    { label: 'TP1 Tercapai', value: `${tp1Trades}x (${tp1TargetPct.toFixed(0)}% profit)`, color: 'text-green-400' },
                                    { label: 'TP2 Tercapai', value: `${tp2Trades}x (${tp2TargetPct.toFixed(0)}% profit)`, color: 'text-blue-400' },
                                    { label: 'TP3 Trail',    value: `${tp3Trades}x`,  color: 'text-purple-400' },
                                    { label: 'Stop Loss',    value: `${slTrades}x`,   color: 'text-red-400' },
                                    { label: 'Timeout',      value: `${toTrades}x`,   color: 'text-yellow-400' },
                                ].map(({ label, value, color }) => (
                                    <div key={label} className="flex justify-between items-center">
                                        <span className="text-xs text-gray-500">{label}</span>
                                        <span className={`text-xs font-medium ${color}`}>{value}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Profit Ladder Visual */}
                            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                                <h3 className="text-xs font-semibold text-gray-400 mb-3">Profit Ladder TP1 → TP2 → TP3</h3>
                                <div className="space-y-2">
                                    {[
                                        {
                                            label:   `TP1 — ${tp1TargetPct.toFixed(0)}% profit`,
                                            sub:     `Jual ${tp1Pct}% posisi`,
                                            count:   tp1Trades + tp2Trades + tp3Trades,
                                            total:   result.totalTrades,
                                            color:   'bg-green-500',
                                            textCol: 'text-green-400',
                                        },
                                        {
                                            label:   `TP2 — ${tp2TargetPct.toFixed(0)}% profit`,
                                            sub:     `Jual ${tp2Pct}% posisi`,
                                            count:   tp2Trades + tp3Trades,
                                            total:   result.totalTrades,
                                            color:   'bg-blue-500',
                                            textCol: 'text-blue-400',
                                        },
                                        {
                                            label:   'TP3 — Trailing Stop',
                                            sub:     'Sisa posisi dengan trailing',
                                            count:   tp3Trades,
                                            total:   result.totalTrades,
                                            color:   'bg-purple-500',
                                            textCol: 'text-purple-400',
                                        },
                                    ].map(({ label, sub, count, total, color, textCol }) => {
                                        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                                        return (
                                            <div key={label}>
                                                <div className="flex justify-between items-baseline mb-1">
                                                    <span className="text-xs text-gray-300">{label}</span>
                                                    <span className={`text-xs font-semibold ${textCol}`}>{count}x ({pct}%)</span>
                                                </div>
                                                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                                                    <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                                                </div>
                                                <p className="text-xs text-gray-700 mt-0.5">{sub}</p>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Trade list toggle */}
                            <button
                                onClick={() => setShowTrades(v => !v)}
                                className="w-full bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-xl px-4 py-3 text-xs text-gray-400 hover:text-gray-200 transition-all flex items-center justify-between"
                            >
                                <span>📋 Rincian {result.trades.length} Trade</span>
                                <span>{showTrades ? '▲' : '▼'}</span>
                            </button>

                            {showTrades && (
                                <div className="space-y-2">
                                    {result.trades.map((t, i) => {
                                        const cfg      = EXIT_CONFIG[t.exitReason] ?? EXIT_CONFIG['Timeout'];
                                        const isProfit = t.profitPct >= 0;
                                        return (
                                            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span>{cfg.icon}</span>
                                                        <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                                                        <span className="text-xs text-gray-600">#{i + 1}</span>
                                                    </div>
                                                    <span className={`text-sm font-bold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                                                        {isProfit ? '+' : ''}{t.profitPct.toFixed(1)}%
                                                    </span>
                                                </div>
                                                <div className="flex justify-between mt-1.5 text-xs text-gray-600">
                                                    <span>Masuk ${t.entryPrice < 0.0001 ? t.entryPrice.toExponential(3) : t.entryPrice.toFixed(6)}</span>
                                                    <span>Keluar ${t.exitPrice < 0.0001 ? t.exitPrice.toExponential(3) : t.exitPrice.toFixed(6)}</span>
                                                    <span>{t.holdCandles} candle</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* Empty state */}
            {!result && !loading && !error && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
                    <p className="text-4xl mb-3">🔬</p>
                    <p className="text-sm text-gray-400 font-medium">Simulasi Profit Ladder</p>
                    <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                        Masukkan alamat token Base, pilih timeframe,<br />
                        lalu klik "Jalankan Backtest" untuk melihat<br />
                        simulasi TP1 / TP2 / TP3 dari data historis.
                    </p>
                </div>
            )}
        </div>
    );
};

export default Backtest;
