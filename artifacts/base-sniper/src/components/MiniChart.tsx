import React, { useEffect, useState, useRef, useCallback } from 'react';
import { authFetch } from '../lib/authFetch';

interface Candle {
    t: number;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
}

interface ChartData {
    poolAddress: string;
    poolName: string;
    liquidityUsd: number;
    candles: Candle[];
    fetchedAt: number;
}

interface MiniChartProps {
    apiUrl: string;
    tokenAddress: string;
    tokenSymbol: string;
    entryPrice: number; // price in USD at entry
    width?: number;
    height?: number;
}

const REFRESH_MS = 30_000;

function formatPrice(p: number): string {
    if (p === 0) return '—';
    if (p >= 1)       return `$${p.toFixed(4)}`;
    if (p >= 0.0001)  return `$${p.toFixed(6)}`;
    return `$${p.toExponential(3)}`;
}

function formatVol(v: number): string {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
    return `$${v.toFixed(0)}`;
}

function formatTime(ms: number): string {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// ─── Pure SVG sparkline ───────────────────────────────────────────────────────

interface SparklineProps {
    candles: Candle[];
    entryPriceUsd: number;
    width: number;
    height: number;
    chartId: string;
}

const Sparkline: React.FC<SparklineProps> = ({ candles, entryPriceUsd, width, height, chartId }) => {
    if (candles.length < 2) return null;

    const PAD_T = 8;
    const PAD_B = 24; // room for volume bars + time labels
    const PAD_L = 4;
    const PAD_R = 4;
    const chartH = height - PAD_T - PAD_B;
    const chartW = width  - PAD_L - PAD_R;

    const closes = candles.map(c => c.c);
    const highs  = candles.map(c => c.h);
    const lows   = candles.map(c => c.l);
    const vols   = candles.map(c => c.v);

    const allPrices = [...closes, ...highs, ...lows, entryPriceUsd > 0 ? entryPriceUsd : closes[0]];
    const minP = Math.min(...allPrices);
    const maxP = Math.max(...allPrices);
    const priceRange = maxP - minP || maxP * 0.01 || 1;

    const maxVol = Math.max(...vols) || 1;
    const VOL_H  = 14; // max volume bar height in px (sits in PAD_B area)

    const n = candles.length;
    const xStep = chartW / (n - 1);

    function px(i: number) { return PAD_L + i * xStep; }
    function py(price: number) { return PAD_T + chartH - ((price - minP) / priceRange) * chartH; }

    // Line path
    const linePts = closes.map((c, i) => `${px(i).toFixed(1)},${py(c).toFixed(1)}`).join(' ');
    const linePath = `M ${linePts.split(' ').join(' L ')}`;

    // Area fill path
    const areaPath = `M ${px(0).toFixed(1)},${(PAD_T + chartH).toFixed(1)} ` +
        closes.map((c, i) => `L ${px(i).toFixed(1)},${py(c).toFixed(1)}`).join(' ') +
        ` L ${px(n - 1).toFixed(1)},${(PAD_T + chartH).toFixed(1)} Z`;

    // Current price vs entry — determines colour
    const lastPrice  = closes[closes.length - 1];
    const isAbove    = entryPriceUsd <= 0 || lastPrice >= entryPriceUsd;
    const lineColor  = isAbove ? '#22c55e' : '#ef4444';
    const fillId     = `chartFill_${chartId}`;

    // Entry price line Y
    const entryY = entryPriceUsd > 0 ? py(entryPriceUsd) : null;

    // Visible time labels: first, mid, last candle
    const labelIndices = [0, Math.floor(n / 2), n - 1];

    return (
        <svg width={width} height={height} className="block overflow-visible">
            <defs>
                <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={lineColor} stopOpacity="0.35" />
                    <stop offset="100%" stopColor={lineColor} stopOpacity="0.03" />
                </linearGradient>
                <clipPath id={`clip_${fillId}`}>
                    <rect x={PAD_L} y={PAD_T} width={chartW} height={chartH} />
                </clipPath>
            </defs>

            {/* Grid lines (3 horizontal) */}
            {[0.25, 0.5, 0.75].map((frac, i) => {
                const y = PAD_T + chartH * frac;
                return (
                    <line key={i}
                        x1={PAD_L} y1={y} x2={PAD_L + chartW} y2={y}
                        stroke="#1f2937" strokeWidth="1" strokeDasharray="3 3"
                    />
                );
            })}

            {/* Entry price dashed line */}
            {entryY !== null && entryY >= PAD_T && entryY <= PAD_T + chartH && (
                <>
                    <line
                        x1={PAD_L} y1={entryY} x2={PAD_L + chartW} y2={entryY}
                        stroke="#f59e0b" strokeWidth="1" strokeDasharray="4 3"
                        opacity="0.8"
                    />
                    <text
                        x={PAD_L + chartW - 2} y={entryY - 3}
                        textAnchor="end" fill="#f59e0b"
                        fontSize="7" opacity="0.9"
                    >
                        Entry
                    </text>
                </>
            )}

            {/* Area fill */}
            <path d={areaPath} fill={`url(#${fillId})`} clipPath={`url(#clip_${fillId})`} />

            {/* Price line */}
            <path
                d={linePath}
                fill="none"
                stroke={lineColor}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                clipPath={`url(#clip_${fillId})`}
            />

            {/* Last price dot */}
            <circle
                cx={px(n - 1)}
                cy={py(lastPrice)}
                r="2.5"
                fill={lineColor}
                stroke="#111827"
                strokeWidth="1"
            />

            {/* Volume bars */}
            {candles.map((c, i) => {
                const barW  = Math.max(1, xStep - 1);
                const barH  = Math.max(1, (c.v / maxVol) * VOL_H);
                const barX  = px(i) - barW / 2;
                const barY  = height - barH - 1;
                const isBull = c.c >= c.o;
                return (
                    <rect
                        key={i}
                        x={barX} y={barY}
                        width={barW} height={barH}
                        fill={isBull ? '#16a34a' : '#dc2626'}
                        opacity="0.5"
                    />
                );
            })}

            {/* Time axis labels */}
            {labelIndices.map(i => (
                <text
                    key={i}
                    x={px(i)}
                    y={height - VOL_H - 3}
                    textAnchor="middle"
                    fill="#4b5563"
                    fontSize="7"
                >
                    {formatTime(candles[i].t)}
                </text>
            ))}
        </svg>
    );
};

// ─── Main component ───────────────────────────────────────────────────────────

const MiniChart: React.FC<MiniChartProps> = ({
    apiUrl,
    tokenAddress,
    tokenSymbol,
    entryPrice,
    width  = 280,
    height = 110,
}) => {
    const [chartData, setChartData] = useState<ChartData | null>(null);
    const [loading,   setLoading]   = useState(true);
    const [error,     setError]     = useState('');
    const [lastFetch, setLastFetch] = useState(0);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchChart = useCallback(async () => {
        try {
            setError('');
            const res  = await authFetch(`${apiUrl}/api/chart/${tokenAddress}`);
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                throw new Error((j as any).error || `HTTP ${res.status}`);
            }
            const data: ChartData = await res.json();
            setChartData(data);
            setLastFetch(Date.now());
        } catch (e: any) {
            setError(e.message || 'Gagal memuat chart');
        } finally {
            setLoading(false);
        }
    }, [apiUrl, tokenAddress]);

    useEffect(() => {
        setLoading(true);
        fetchChart();
        timerRef.current = setInterval(fetchChart, REFRESH_MS);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [fetchChart]);

    const lastCandle  = chartData?.candles?.length
        ? chartData.candles[chartData.candles.length - 1]
        : null;
    const lastPrice   = lastCandle?.c ?? 0;
    const entryPriceUsd = entryPrice; // already in USD
    const priceDelta  = entryPriceUsd > 0 && lastPrice > 0
        ? ((lastPrice - entryPriceUsd) / entryPriceUsd) * 100
        : null;

    const totalVol = chartData?.candles?.reduce((s, c) => s + c.v, 0) ?? 0;
    const secsAgo  = lastFetch > 0 ? Math.round((Date.now() - lastFetch) / 1000) : null;

    return (
        <div className="rounded-xl bg-gray-950/80 border border-gray-800/60 overflow-hidden">
            {/* Chart header */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800/60">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-300">{tokenSymbol}</span>
                    <span className="text-xs text-gray-600">5m candles · GeckoTerminal</span>
                </div>
                <div className="flex items-center gap-2">
                    {secsAgo !== null && (
                        <span className="text-xs text-gray-700">{secsAgo}s ago</span>
                    )}
                    <button
                        onClick={fetchChart}
                        className="text-gray-600 hover:text-gray-400 transition-colors"
                        title="Refresh chart"
                    >
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M10 6A4 4 0 1 1 6 2" strokeLinecap="round"/>
                            <path d="M10 2v4H6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </button>
                </div>
            </div>

            {/* Price info row */}
            {!loading && !error && lastCandle && (
                <div className="flex items-center justify-between px-3 py-1 border-b border-gray-800/40">
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-white">{formatPrice(lastPrice)}</span>
                        {priceDelta !== null && (
                            <span className={`text-xs font-semibold ${priceDelta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {priceDelta >= 0 ? '+' : ''}{priceDelta.toFixed(2)}% vs entry
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-600">
                        <span>H: {formatPrice(Math.max(...chartData!.candles.map(c => c.h)))}</span>
                        <span>L: {formatPrice(Math.min(...chartData!.candles.map(c => c.l)))}</span>
                        <span>Vol: {formatVol(totalVol)}</span>
                    </div>
                </div>
            )}

            {/* Chart body */}
            <div className="px-1 pt-1 pb-0.5">
                {loading && (
                    <div className="flex items-center justify-center gap-2 text-xs text-gray-600"
                        style={{ height: height }}>
                        <span className="w-3 h-3 border border-gray-600 border-t-gray-400 rounded-full animate-spin" />
                        Memuat chart...
                    </div>
                )}

                {!loading && error && (
                    <div className="flex flex-col items-center justify-center text-center gap-1"
                        style={{ height: height }}>
                        <span className="text-gray-700 text-lg">📊</span>
                        <p className="text-xs text-gray-600">{error}</p>
                        <button
                            onClick={fetchChart}
                            className="text-xs text-blue-600 hover:text-blue-400 underline mt-0.5"
                        >
                            Coba lagi
                        </button>
                    </div>
                )}

                {!loading && !error && chartData && (
                    <Sparkline
                        candles={chartData.candles}
                        entryPriceUsd={entryPriceUsd}
                        width={width}
                        height={height}
                        chartId={tokenAddress.slice(2, 10)}
                    />
                )}
            </div>

            {/* Pool info footer */}
            {!loading && !error && chartData && (
                <div className="flex items-center justify-between px-3 py-1 border-t border-gray-800/40">
                    <a
                        href={`https://www.geckoterminal.com/base/pools/${chartData.poolAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-700 hover:text-blue-500 truncate max-w-[60%]"
                        title={chartData.poolName}
                    >
                        🦎 {chartData.poolName}
                    </a>
                    <span className="text-xs text-gray-700 flex-shrink-0">
                        Liq: {formatVol(chartData.liquidityUsd)}
                    </span>
                </div>
            )}
        </div>
    );
};

export default MiniChart;
