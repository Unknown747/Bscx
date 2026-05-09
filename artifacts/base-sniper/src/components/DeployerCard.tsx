import React, { useEffect, useState } from 'react';

interface TokenCheck {
    address:      string;
    alive:        boolean | null;
    liquidityUsd: number;
    tokenName?:   string;
    tokenSymbol?: string;
    pairUrl?:     string;
}

interface ReputationResult {
    score:       number | null;
    label:       'trusted' | 'neutral' | 'risky' | 'unknown';
    totalTokens: number;
    aliveTokens: number;
    deadTokens:  number;
    deployer:    string;
    skipped:     boolean;
    checkedAt:   number;
    tokenChecks: TokenCheck[];
}

interface DeployerCardProps {
    address: string;
    apiUrl:  string;
    onClose: () => void;
}

function shortAddr(a: string) {
    return `${a.slice(0, 8)}...${a.slice(-6)}`;
}

function fmtLiquidity(usd: number): string {
    if (usd === 0) return '$0';
    if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
    if (usd >= 1_000)     return `$${(usd / 1_000).toFixed(1)}K`;
    return `$${usd}`;
}

const LABEL_CONFIG = {
    trusted: { color: 'text-green-400',  bar: 'bg-green-500',  border: 'border-green-800/60', bg: 'bg-green-900/20', emoji: '⭐', text: 'Tepercaya' },
    neutral: { color: 'text-yellow-400', bar: 'bg-yellow-500', border: 'border-yellow-800/60', bg: 'bg-yellow-900/20', emoji: '🟡', text: 'Netral' },
    risky:   { color: 'text-red-400',    bar: 'bg-red-500',    border: 'border-red-800/60',   bg: 'bg-red-900/20',   emoji: '🔴', text: 'Berisiko' },
    unknown: { color: 'text-gray-400',   bar: 'bg-gray-600',   border: 'border-gray-700',      bg: 'bg-gray-800/40',  emoji: '❓', text: 'Tidak Diketahui' }
};

const DeployerCard: React.FC<DeployerCardProps> = ({ address, apiUrl, onClose }) => {
    const [data,    setData]    = useState<ReputationResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState('');
    const [copied,  setCopied]  = useState(false);

    useEffect(() => {
        setLoading(true);
        setError('');
        fetch(`${apiUrl}/api/reputation/${address}`)
            .then(r => r.json())
            .then(json => {
                if (json.error) throw new Error(json.error);
                setData(json);
            })
            .catch(e => setError(e.message || 'Gagal memuat data reputasi'))
            .finally(() => setLoading(false));
    }, [address, apiUrl]);

    function copyAddress() {
        const addr = data?.deployer ?? address;
        navigator.clipboard.writeText(addr).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    }

    const cfg = data ? LABEL_CONFIG[data.label] : LABEL_CONFIG.unknown;
    const scoreDisplay = data?.score != null ? data.score : '—';
    const barWidth = data?.score != null ? `${data.score}%` : '0%';

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">

                {/* ── Header ── */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
                    <h2 className="text-base font-semibold text-white">🔍 Profil Deployer</h2>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-white transition-colors text-xl leading-none"
                    >
                        ×
                    </button>
                </div>

                {/* ── Body ── */}
                <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">

                    {/* Address row */}
                    <div className="bg-gray-800/60 rounded-xl p-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-500 mb-0.5">Wallet Deployer</p>
                            <p className="text-sm text-white font-mono truncate">{data?.deployer ?? address}</p>
                        </div>
                        <button
                            onClick={copyAddress}
                            className="text-xs text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded-lg transition-colors flex-shrink-0"
                        >
                            {copied ? '✓ Disalin' : '📋 Salin'}
                        </button>
                        <a
                            href={`https://basescan.org/address/${data?.deployer ?? address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:text-blue-300 bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded-lg transition-colors flex-shrink-0"
                        >
                            BaseScan ↗
                        </a>
                    </div>

                    {/* Loading */}
                    {loading && (
                        <div className="text-center py-8">
                            <div className="inline-block w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mb-3" />
                            <p className="text-sm text-gray-400">Menganalisis riwayat deployer...</p>
                            <p className="text-xs text-gray-600 mt-1">Memeriksa DexScreener untuk token-token sebelumnya</p>
                        </div>
                    )}

                    {/* Error */}
                    {error && !loading && (
                        <div className="bg-red-900/30 border border-red-800 rounded-xl p-3 text-sm text-red-400">
                            ⚠️ {error}
                        </div>
                    )}

                    {/* Reputation result */}
                    {data && !loading && !error && (
                        <>
                            {/* Score section */}
                            <div className={`rounded-xl p-4 border ${cfg.border} ${cfg.bg}`}>
                                <div className="flex items-center justify-between mb-3">
                                    <div>
                                        <p className="text-xs text-gray-400 mb-0.5">Skor Reputasi</p>
                                        <p className={`text-3xl font-bold ${cfg.color}`}>
                                            {scoreDisplay}
                                            {data.score !== null && <span className="text-lg font-normal text-gray-500">/100</span>}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-2xl">{cfg.emoji}</p>
                                        <p className={`text-sm font-semibold ${cfg.color}`}>{cfg.text}</p>
                                    </div>
                                </div>

                                {/* Score bar */}
                                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all duration-700 ${cfg.bar}`}
                                        style={{ width: barWidth }}
                                    />
                                </div>
                                <div className="flex justify-between text-xs text-gray-600 mt-1">
                                    <span>0 (Sangat Berisiko)</span>
                                    <span>100 (Sangat Tepercaya)</span>
                                </div>

                                {data.score === null && (
                                    <p className="text-xs text-gray-500 mt-2">
                                        ℹ️ Data tidak cukup untuk skor — kurang dari 2 token yang dapat diverifikasi. Bot tetap mengizinkan trade (fail-open).
                                    </p>
                                )}
                            </div>

                            {/* Stats row */}
                            <div className="grid grid-cols-3 gap-3">
                                {[
                                    { label: 'Total Token', value: String(data.totalTokens), sub: 'dikontrak', color: 'text-white' },
                                    { label: 'Masih Hidup', value: String(data.aliveTokens), sub: 'likuiditas > $500', color: 'text-green-400' },
                                    { label: 'Mati / Rug',  value: String(data.deadTokens),  sub: 'likuiditas $0',    color: 'text-red-400' }
                                ].map(s => (
                                    <div key={s.label} className="bg-gray-800/60 rounded-xl p-3 text-center">
                                        <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                                        <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
                                        <p className="text-xs text-gray-600">{s.sub}</p>
                                    </div>
                                ))}
                            </div>

                            {/* Token checklist */}
                            {data.tokenChecks.length > 0 && (
                                <div>
                                    <p className="text-xs font-semibold text-gray-400 mb-2">
                                        Token Terakhir yang Dicek ({data.tokenChecks.length})
                                    </p>
                                    <div className="space-y-2">
                                        {data.tokenChecks.map(tc => {
                                            const alive = tc.alive;
                                            const statusColor = alive === true  ? 'text-green-400 bg-green-900/30 border-green-800/40'
                                                              : alive === false ? 'text-red-400 bg-red-900/30 border-red-800/40'
                                                              : 'text-gray-400 bg-gray-800/40 border-gray-700';
                                            const statusText  = alive === true  ? '✓ Hidup'
                                                              : alive === false ? '✗ Mati'
                                                              : '? Tidak ada data';
                                            return (
                                                <div
                                                    key={tc.address}
                                                    className="flex items-center gap-3 bg-gray-800/40 rounded-xl px-3 py-2.5"
                                                >
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs text-white font-mono truncate">
                                                            {tc.tokenSymbol
                                                                ? <><span className="text-purple-300 font-semibold">{tc.tokenSymbol}</span> · </>
                                                                : null}
                                                            {tc.tokenName || shortAddr(tc.address)}
                                                        </p>
                                                        <p className="text-xs text-gray-600 font-mono truncate">{tc.address}</p>
                                                    </div>
                                                    {tc.alive !== null && (
                                                        <span className="text-xs text-gray-500 flex-shrink-0">
                                                            {fmtLiquidity(tc.liquidityUsd)}
                                                        </span>
                                                    )}
                                                    <span className={`text-xs px-2 py-0.5 rounded-full border flex-shrink-0 ${statusColor}`}>
                                                        {statusText}
                                                    </span>
                                                    {tc.pairUrl && (
                                                        <a
                                                            href={tc.pairUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-blue-400 hover:text-blue-300 text-xs flex-shrink-0"
                                                        >
                                                            ↗
                                                        </a>
                                                    )}
                                                    <a
                                                        href={`https://basescan.org/token/${tc.address}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-gray-500 hover:text-gray-300 text-xs flex-shrink-0"
                                                    >
                                                        📄
                                                    </a>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {data.tokenChecks.length === 0 && !data.skipped && (
                                <div className="text-center py-4 text-sm text-gray-500">
                                    Tidak ada token yang dapat diverifikasi dari deployer ini.
                                </div>
                            )}

                            <p className="text-xs text-gray-700 text-center">
                                Data diperbarui {new Date(data.checkedAt).toLocaleTimeString('id-ID')} · Cache 30 menit
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DeployerCard;
