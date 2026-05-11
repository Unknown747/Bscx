import React, { useEffect, useState, useCallback } from 'react';
import { authFetch } from '../lib/authFetch';

interface ConnectionData {
    wsConnected: boolean;
    rpcUrl:      string;
    wssUrl:      string;
    lastTradeAt: number | null;
    timestamp:   number;
}

interface Props {
    apiUrl:    string;
    connected: boolean | undefined;
}

export const RpcStatusBadge: React.FC<Props> = ({ apiUrl, connected }) => {
    const [data, setData] = useState<ConnectionData | null>(null);
    const [showDetail, setShowDetail] = useState(false);

    const load = useCallback(async () => {
        try {
            const res  = await authFetch(`${apiUrl}/api/connection-status`);
            const json = await res.json();
            if (!json.error) setData(json);
        } catch { /* silent */ }
    }, [apiUrl]);

    useEffect(() => {
        load();
        const iv = setInterval(load, 5000);
        return () => clearInterval(iv);
    }, [load]);

    const wsOk   = data?.wsConnected ?? connected ?? false;
    const rpcUrl = data?.rpcUrl ?? '...';

    const providerLabel = (() => {
        if (rpcUrl.includes('drpc'))     return 'dRPC';
        if (rpcUrl.includes('alchemy'))  return 'Alchemy';
        if (rpcUrl.includes('infura'))   return 'Infura';
        if (rpcUrl.includes('quicknode'))return 'QuickNode';
        if (rpcUrl.includes('base.org')) return 'Base Public';
        return rpcUrl.split('/')[0];
    })();

    return (
        <div className="relative">
            <button
                onClick={() => setShowDetail(v => !v)}
                className="flex items-center gap-1.5 focus:outline-none"
            >
                <span className="relative flex h-2 w-2">
                    {wsOk && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
                    )}
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${wsOk ? 'bg-green-500' : 'bg-red-500'}`} />
                </span>
                <span className={`text-xs font-medium ${wsOk ? 'text-green-400' : 'text-red-400'}`}>
                    {wsOk ? 'Live' : 'Offline'}
                </span>
            </button>

            {showDetail && (
                <div className="absolute right-0 top-6 z-50 bg-gray-900 border border-gray-700 rounded-xl p-3 min-w-[220px] shadow-xl space-y-2">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-gray-300">Koneksi Network</p>
                        <button onClick={() => setShowDetail(false)} className="text-gray-600 hover:text-gray-400 text-sm leading-none">✕</button>
                    </div>
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-500">WebSocket</span>
                            <span className={`text-xs font-medium ${wsOk ? 'text-green-400' : 'text-red-400'}`}>
                                {wsOk ? '✓ Terhubung' : '✗ Terputus'}
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-500">RPC</span>
                            <span className="text-xs text-blue-400 font-mono truncate max-w-[120px]">{providerLabel}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-500">WSS</span>
                            <span className="text-xs text-gray-400 font-mono truncate max-w-[120px]">{data?.wssUrl ?? '...'}</span>
                        </div>
                        {data?.lastTradeAt && (
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-gray-500">Trade terakhir</span>
                                <span className="text-xs text-gray-400">
                                    {new Date(data.lastTradeAt).toLocaleTimeString('id-ID')}
                                </span>
                            </div>
                        )}
                    </div>
                    <div className={`text-[10px] text-center rounded-lg py-1 px-2 ${
                        wsOk
                            ? 'bg-green-950/40 text-green-600'
                            : 'bg-red-950/40 text-red-600'
                    }`}>
                        Base Network {wsOk ? '— scanning aktif' : '— mencoba reconnect...'}
                    </div>
                </div>
            )}
        </div>
    );
};

export default RpcStatusBadge;
