import React, { useEffect, useState, useCallback } from 'react';
import { authFetch } from '../lib/authFetch';

interface ClosedTrade {
    id: string;
    tokenSymbol: string;
    entryEth: number;
    profitPct: number | null;
    percentSold: number;
    closedAt: number;
    reason: string;
}

interface ChartPoint {
    ts: number;
    cumEth: number;
    tradeEth: number;
    symbol: string;
    reason: string;
}

interface Props {
    apiUrl: string;
    compact?: boolean;
}

function fmtEth(v: number): string {
    const sign = v >= 0 ? '+' : '';
    if (Math.abs(v) >= 0.001) return `${sign}${v.toFixed(4)} ETH`;
    return `${sign}${v.toFixed(6)} ETH`;
}

function fmtTime(ts: number): string {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

const PnLChart: React.FC<Props> = ({ apiUrl, compact = false }) => {
    const [points, setPoints]     = useState<ChartPoint[]>([]);
    const [loading, setLoading]   = useState(true);
    const [hovered, setHovered]   = useState<ChartPoint | null>(null);
    const [mouseX, setMouseX]     = useState(0);

    const load = useCallback(async () => {
        try {
            const res  = await authFetch(`${apiUrl}/api/history`);
            const json = await res.json();
            const trades: ClosedTrade[] = (json.trades ?? [])
                .slice()
                .sort((a: ClosedTrade, b: ClosedTrade) => a.closedAt - b.closedAt);

            let cum = 0;
            const pts: ChartPoint[] = trades.map(t => {
                const tradeEth = t.profitPct !== null
                    ? t.entryEth * (t.percentSold / 100) * (t.profitPct / 100)
                    : 0;
                cum += tradeEth;
                return { ts: t.closedAt, cumEth: cum, tradeEth, symbol: t.tokenSymbol, reason: t.reason };
            });

            setPoints(pts);
        } catch { }
        setLoading(false);
    }, [apiUrl]);

    useEffect(() => {
        load();
        const iv = setInterval(load, 10000);
        return () => clearInterval(iv);
    }, [load]);

    if (loading) {
        return (
            <div className="flex items-center justify-center gap-2 text-xs text-gray-600 py-8">
                <span className="w-3 h-3 border border-gray-600 border-t-gray-400 rounded-full animate-spin" />
                Memuat chart P&L...
            </div>
        );
    }

    if (points.length === 0) {
        return (
            <div className={`bg-gray-900 border border-gray-800 rounded-xl flex flex-col items-center justify-center text-center ${compact ? 'p-4' : 'p-8'}`}>
                <p className="text-2xl mb-2">📈</p>
                <p className="text-xs text-gray-500">Chart P&L akan muncul setelah ada trade selesai</p>
            </div>
        );
    }

    const HEIGHT   = compact ? 80 : 140;
    const WIDTH    = 320;
    const PAD_L    = 8;
    const PAD_R    = 8;
    const PAD_T    = compact ? 10 : 16;
    const PAD_B    = compact ? 16 : 24;
    const chartW   = WIDTH - PAD_L - PAD_R;
    const chartH   = HEIGHT - PAD_T - PAD_B;

    const allVals  = [0, ...points.map(p => p.cumEth)];
    const minY     = Math.min(...allVals);
    const maxY     = Math.max(...allVals);
    const rangeY   = maxY - minY || 0.00001;

    const n = points.length;
    const xStep = n > 1 ? chartW / (n) : chartW;

    function px(i: number) { return PAD_L + (i + 0.5) * (chartW / n); }
    function py(v: number)  { return PAD_T + chartH - ((v - minY) / rangeY) * chartH; }

    const zeroY = py(0);

    const allPts  = [{ ts: 0, cumEth: 0 }, ...points];
    const linePts = allPts.map((p, i) => {
        const x = i === 0 ? PAD_L : px(i - 1);
        const y = py(p.cumEth);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const linePath = `M ${linePts.join(' L ')}`;

    const lastVal  = points[points.length - 1]?.cumEth ?? 0;
    const isProfit = lastVal >= 0;
    const lineColor = isProfit ? '#22c55e' : '#ef4444';
    const fillId    = 'pnl_fill';

    const lastX = px(n - 1);
    const lastY = py(lastVal);

    const areaPath = `M ${PAD_L},${zeroY.toFixed(1)} ` +
        allPts.map((p, i) => {
            const x = i === 0 ? PAD_L : px(i - 1);
            const y = py(p.cumEth);
            return `L ${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ') +
        ` L ${px(n - 1).toFixed(1)},${zeroY.toFixed(1)} Z`;

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const relX = e.clientX - rect.left - PAD_L;
        const idx  = Math.max(0, Math.min(n - 1, Math.round(relX / (chartW / n) - 0.5)));
        setHovered(points[idx] ?? null);
        setMouseX(px(idx));
    };

    return (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-300">Cumulative P&L</span>
                    <span className="text-xs text-gray-600">{n} trade</span>
                </div>
                <span className={`text-xs font-bold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                    {fmtEth(lastVal)}
                </span>
            </div>

            {/* Tooltip */}
            {hovered && (
                <div className="px-3 py-1.5 border-b border-gray-800/60 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white">{hovered.symbol}</span>
                        <span className="text-xs text-gray-500">{fmtTime(hovered.ts)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                        <span className={hovered.tradeEth >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {fmtEth(hovered.tradeEth)}
                        </span>
                        <span className="text-gray-600">→</span>
                        <span className={hovered.cumEth >= 0 ? 'text-green-300' : 'text-red-300'}>
                            {fmtEth(hovered.cumEth)} total
                        </span>
                    </div>
                </div>
            )}

            {/* SVG Chart */}
            <div className="px-1 pt-1 pb-0.5">
                <svg
                    width="100%"
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    className="block w-full"
                    onMouseMove={handleMouseMove}
                    onMouseLeave={() => setHovered(null)}
                >
                    <defs>
                        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%"   stopColor={lineColor} stopOpacity="0.30" />
                            <stop offset="100%" stopColor={lineColor} stopOpacity="0.03" />
                        </linearGradient>
                        <clipPath id="pnl_clip">
                            <rect x={PAD_L} y={PAD_T} width={chartW} height={chartH} />
                        </clipPath>
                    </defs>

                    {/* Grid lines */}
                    {[0.25, 0.5, 0.75].map((f, i) => (
                        <line key={i}
                            x1={PAD_L} y1={PAD_T + chartH * f}
                            x2={PAD_L + chartW} y2={PAD_T + chartH * f}
                            stroke="#1f2937" strokeWidth="1" strokeDasharray="3 3"
                        />
                    ))}

                    {/* Zero baseline */}
                    {zeroY >= PAD_T && zeroY <= PAD_T + chartH && (
                        <line
                            x1={PAD_L} y1={zeroY} x2={PAD_L + chartW} y2={zeroY}
                            stroke="#374151" strokeWidth="1" strokeDasharray="4 3"
                        />
                    )}

                    {/* Area fill */}
                    <path d={areaPath} fill={`url(#${fillId})`} clipPath="url(#pnl_clip)" />

                    {/* Line */}
                    <path
                        d={linePath}
                        fill="none"
                        stroke={lineColor}
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        clipPath="url(#pnl_clip)"
                    />

                    {/* Trade dots */}
                    {points.map((p, i) => {
                        const dotColor = p.tradeEth >= 0 ? '#22c55e' : '#ef4444';
                        return (
                            <circle key={p.ts}
                                cx={px(i)} cy={py(p.cumEth)}
                                r={hovered?.ts === p.ts ? 4 : 2}
                                fill={dotColor}
                                stroke="#111827"
                                strokeWidth="1"
                                clipPath="url(#pnl_clip)"
                            />
                        );
                    })}

                    {/* Hover crosshair */}
                    {hovered && (
                        <line
                            x1={mouseX} y1={PAD_T}
                            x2={mouseX} y2={PAD_T + chartH}
                            stroke="#6b7280" strokeWidth="1" strokeDasharray="3 3"
                            opacity="0.6"
                        />
                    )}

                    {/* Last value dot */}
                    <circle
                        cx={lastX} cy={lastY}
                        r="3"
                        fill={lineColor}
                        stroke="#111827"
                        strokeWidth="1.5"
                    />

                    {/* Time labels */}
                    {!compact && n > 0 && [0, Math.floor(n / 2), n - 1].map(i => (
                        <text key={i}
                            x={px(i)} y={HEIGHT - 3}
                            textAnchor="middle" fill="#4b5563" fontSize="7"
                        >
                            {fmtTime(points[i].ts)}
                        </text>
                    ))}

                    {/* Y axis: min / max labels */}
                    {!compact && (
                        <>
                            <text x={PAD_L + 2} y={PAD_T + 8} fill="#4b5563" fontSize="7">{fmtEth(maxY)}</text>
                            <text x={PAD_L + 2} y={PAD_T + chartH - 2} fill="#4b5563" fontSize="7">{fmtEth(minY)}</text>
                        </>
                    )}
                </svg>
            </div>

            {/* Stats footer */}
            {!compact && (
                <div className="grid grid-cols-3 divide-x divide-gray-800 border-t border-gray-800">
                    {[
                        { label: 'Total P&L', value: fmtEth(lastVal), color: isProfit ? 'text-green-400' : 'text-red-400' },
                        { label: 'Best', value: fmtEth(Math.max(...points.map(p => p.tradeEth))), color: 'text-green-400' },
                        { label: 'Worst', value: fmtEth(Math.min(...points.map(p => p.tradeEth))), color: 'text-red-400' },
                    ].map(({ label, value, color }) => (
                        <div key={label} className="px-3 py-2 text-center">
                            <p className="text-xs text-gray-500">{label}</p>
                            <p className={`text-xs font-bold mt-0.5 ${color}`}>{value}</p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default PnLChart;
