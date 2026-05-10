import React, { useEffect, useState, useCallback } from 'react';
import { authFetch } from '../lib/authFetch';

interface MempoolData {
    size:      number;
    status:    'quiet' | 'normal' | 'congested';
    timestamp: number;
}

interface Props { apiUrl: string; }

export const MempoolGauge: React.FC<Props> = ({ apiUrl }) => {
    const [data,    setData]    = useState<MempoolData | null>(null);
    const [history, setHistory] = useState<number[]>([]);

    const load = useCallback(async () => {
        try {
            const res  = await authFetch(`${apiUrl}/api/mempool`);
            const json = await res.json() as MempoolData;
            setData(json);
            setHistory(prev => [...prev.slice(-29), json.size]);
        } catch { /* silent */ }
    }, [apiUrl]);

    useEffect(() => {
        load();
        const iv = setInterval(load, 8_000);
        return () => clearInterval(iv);
    }, [load]);

    if (!data) return null;

    const STATUS_CFG = {
        quiet:     { color: 'text-emerald-400', bg: 'bg-emerald-500', border: 'border-emerald-800/60', label: 'Quiet',     icon: '🟢' },
        normal:    { color: 'text-yellow-400',  bg: 'bg-yellow-500',  border: 'border-yellow-800/60',  label: 'Normal',    icon: '🟡' },
        congested: { color: 'text-red-400',     bg: 'bg-red-500',     border: 'border-red-800/60',     label: 'Congested', icon: '🔴' },
    };
    const cfg  = STATUS_CFG[data.status];
    const pct  = Math.min(100, (data.size / 600) * 100);
    const max  = Math.max(...history, 1);
    const bars = history;

    return (
        <div className={`bg-gray-900 border ${cfg.border} rounded-xl p-4`}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-sm">⛽</span>
                    <div>
                        <p className="text-xs font-semibold text-white">Mempool Pressure</p>
                        <p className="text-xs text-gray-500">Base Network pending txs</p>
                    </div>
                </div>
                <div className="text-right">
                    <p className={`text-lg font-bold ${cfg.color}`}>{data.size}</p>
                    <p className={`text-xs font-medium ${cfg.color}`}>{cfg.icon} {cfg.label}</p>
                </div>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden mb-2">
                <div
                    className={`h-full rounded-full ${cfg.bg} transition-all duration-500`}
                    style={{ width: `${pct}%` }}
                />
            </div>

            {/* Mini sparkline */}
            {bars.length > 2 && (
                <div className="flex items-end gap-0.5 h-6">
                    {bars.map((v, i) => (
                        <div
                            key={i}
                            className={`flex-1 rounded-sm ${cfg.bg} opacity-60`}
                            style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
                        />
                    ))}
                </div>
            )}

            <div className="flex justify-between mt-1">
                <span className="text-xs text-gray-700">0</span>
                <span className="text-xs text-gray-700">Batas: ~600 = Congested</span>
            </div>
        </div>
    );
};

export default MempoolGauge;
