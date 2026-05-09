import React, { useEffect, useState, useCallback } from 'react';

interface Position {
    tokenAddress: string;
    tokenSymbol: string;
    amountIn: string;
    amountOut: string;
    entryPrice: number;
    openedAt: number;
    txHash: string;
    takeProfit1Hit: boolean;
    takeProfit2Hit: boolean;
}

interface PositionsData {
    positions: Position[];
    wallet: string | null;
    timestamp: number;
}

interface PositionCardProps {
    apiUrl: string;
}

function holdTime(openedAt: number): string {
    const secs = Math.floor((Date.now() - openedAt) / 1000);
    if (secs < 60)   return `${secs}d`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m`;
    return `${Math.floor(secs / 3600)}j ${Math.floor((secs % 3600) / 60)}m`;
}

function shortAddr(addr: string): string {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const TP_MULTIPLIERS = [1.5, 2.5];

const PositionCard: React.FC<PositionCardProps> = ({ apiUrl }) => {
    const [data, setData]           = useState<PositionsData | null>(null);
    const [error, setError]         = useState('');
    const [, setTick]               = useState(0); // force re-render every second for hold timer

    const fetchPositions = useCallback(async () => {
        try {
            const res = await fetch(`${apiUrl}/api/positions`);
            const json = await res.json();
            setData(json);
            setError('');
        } catch {
            setError('Gagal memuat posisi');
        }
    }, [apiUrl]);

    // Refresh positions every 5 seconds
    useEffect(() => {
        fetchPositions();
        const interval = setInterval(fetchPositions, 5000);
        return () => clearInterval(interval);
    }, [fetchPositions]);

    // Tick every second to update hold timers
    useEffect(() => {
        const t = setInterval(() => setTick(n => n + 1), 1000);
        return () => clearInterval(t);
    }, []);

    const positions = data?.positions ?? [];

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-300">
                    Posisi Terbuka
                    {positions.length > 0 && (
                        <span className="ml-2 bg-green-500/20 text-green-400 text-xs px-2 py-0.5 rounded-full">
                            {positions.length}
                        </span>
                    )}
                </h2>
                {data?.wallet && (
                    <span className="text-xs text-gray-600">{shortAddr(data.wallet)}</span>
                )}
            </div>

            {error && (
                <div className="bg-red-900/30 border border-red-800 rounded-xl p-3 text-xs text-red-400">
                    {error}
                </div>
            )}

            {/* Empty state */}
            {!error && positions.length === 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
                    <p className="text-2xl mb-2">📭</p>
                    <p className="text-sm text-gray-500">Belum ada posisi terbuka</p>
                    <p className="text-xs text-gray-700 mt-1">Bot sedang memantau peluang...</p>
                </div>
            )}

            {/* Position list */}
            {positions.map((pos) => {
                const tp1Done = pos.takeProfit1Hit;
                const tp2Done = pos.takeProfit2Hit;

                return (
                    <div
                        key={pos.tokenAddress}
                        className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3"
                    >
                        {/* Top row */}
                        <div className="flex items-start justify-between">
                            <div>
                                <span className="text-white font-bold">{pos.tokenSymbol}</span>
                                <span className="ml-2 text-xs text-gray-500">{shortAddr(pos.tokenAddress)}</span>
                            </div>
                            <div className="text-right">
                                <span className="text-xs text-gray-500">⏱ {holdTime(pos.openedAt)}</span>
                            </div>
                        </div>

                        {/* Entry info */}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-gray-800 rounded-lg p-2">
                                <p className="text-gray-500 mb-0.5">Entry</p>
                                <p className="text-white font-medium">{pos.entryPrice.toFixed(4)} ETH</p>
                            </div>
                            <div className="bg-gray-800 rounded-lg p-2">
                                <p className="text-gray-500 mb-0.5">TX</p>
                                <a
                                    href={`https://basescan.org/tx/${pos.txHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-400 hover:text-blue-300 font-medium"
                                >
                                    {shortAddr(pos.txHash)}
                                </a>
                            </div>
                        </div>

                        {/* Take Profit progress */}
                        <div className="space-y-1.5">
                            <p className="text-xs text-gray-500">Take Profit</p>
                            <div className="flex gap-2">
                                {/* TP1 */}
                                <div className={`flex-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs border
                                    ${tp1Done
                                        ? 'bg-green-900/40 border-green-700 text-green-400'
                                        : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
                                    <span>{tp1Done ? '✅' : '🎯'}</span>
                                    <span>{TP_MULTIPLIERS[0]}x</span>
                                    <span className="text-gray-600">50%</span>
                                </div>
                                {/* TP2 */}
                                <div className={`flex-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs border
                                    ${tp2Done
                                        ? 'bg-green-900/40 border-green-700 text-green-400'
                                        : tp1Done
                                            ? 'bg-yellow-900/20 border-yellow-800 text-yellow-500'
                                            : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
                                    <span>{tp2Done ? '✅' : tp1Done ? '⏳' : '🎯'}</span>
                                    <span>{TP_MULTIPLIERS[1]}x</span>
                                    <span className="text-gray-600">100%</span>
                                </div>
                            </div>
                        </div>

                        {/* Stop loss bar indicator */}
                        <div className="flex items-center gap-2 text-xs text-gray-600">
                            <span className="text-red-800">🛑</span>
                            <span>Stop Loss: -30%</span>
                            <span className="text-gray-700">•</span>
                            <span className="text-gray-600">Auto-monitored</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default PositionCard;
