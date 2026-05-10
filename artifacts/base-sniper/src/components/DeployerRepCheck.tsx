import React, { useState, useCallback } from 'react';
import { authFetch } from '../lib/authFetch';

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

interface Props { apiUrl: string; }

function ScoreBadge({ label, score }: { label: ReputationResult['label']; score: number | null }) {
    const cfg = {
        trusted: { bg: 'bg-emerald-900/40',  border: 'border-emerald-600/60',  text: 'text-emerald-400',  icon: '✅', labelText: 'TRUSTED'  },
        neutral: { bg: 'bg-yellow-900/30',   border: 'border-yellow-600/50',   text: 'text-yellow-400',   icon: '⚠️', labelText: 'NEUTRAL'  },
        risky:   { bg: 'bg-red-900/30',      border: 'border-red-600/50',      text: 'text-red-400',      icon: '🚨', labelText: 'RISKY'    },
        unknown: { bg: 'bg-gray-800/40',     border: 'border-gray-700/50',     text: 'text-gray-400',     icon: '❓', labelText: 'UNKNOWN'  },
    }[label];
    return (
        <div className={`flex items-center gap-3 rounded-xl border p-4 ${cfg.bg} ${cfg.border}`}>
            <span className="text-3xl">{cfg.icon}</span>
            <div>
                <p className={`text-xl font-bold ${cfg.text}`}>{cfg.labelText}</p>
                <p className="text-xs text-gray-400">
                    {score !== null ? `Skor: ${score}/100` : 'Tidak cukup data'}
                </p>
            </div>
        </div>
    );
}

const DeployerRepCheck: React.FC<Props> = ({ apiUrl }) => {
    const [input,   setInput]   = useState('');
    const [loading, setLoading] = useState(false);
    const [result,  setResult]  = useState<ReputationResult | null>(null);
    const [error,   setError]   = useState('');

    const check = useCallback(async () => {
        const addr = input.trim();
        if (!addr.match(/^0x[0-9a-fA-F]{40}$/)) {
            setError('Masukkan alamat Ethereum valid (0x + 40 hex)');
            return;
        }
        setLoading(true);
        setError('');
        setResult(null);
        try {
            const res  = await authFetch(`${apiUrl}/api/reputation/${addr}`);
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            setResult(data);
        } catch (e: any) {
            setError(e.message || 'Gagal memeriksa reputasi');
        } finally {
            setLoading(false);
        }
    }, [apiUrl, input]);

    const handleKey = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') check();
    };

    return (
        <div className="space-y-4 pb-6">
            {/* Header */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">🕵️</span>
                    <h2 className="text-sm font-semibold text-white">Deployer Reputation Checker</h2>
                </div>
                <p className="text-xs text-gray-500">
                    Masukkan alamat token atau deployer untuk melihat skor reputasi berdasarkan survival rate token sebelumnya.
                </p>
            </div>

            {/* Input */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <label className="text-xs text-gray-400 block mb-2">Alamat Token atau Deployer</label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKey}
                        placeholder="0x..."
                        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-600 font-mono"
                    />
                    <button
                        onClick={check}
                        disabled={loading || !input.trim()}
                        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                    >
                        {loading ? (
                            <span className="inline-flex items-center gap-1.5">
                                <span className="w-3.5 h-3.5 border border-white border-t-transparent rounded-full animate-spin" />
                                Cek…
                            </span>
                        ) : 'Cek'}
                    </button>
                </div>
                {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
                <p className="text-xs text-gray-600 mt-2">
                    Jika alamat token: sistem otomatis cari deployernya terlebih dahulu.
                </p>
            </div>

            {/* Result */}
            {result && (
                <div className="space-y-3">
                    {/* Score badge */}
                    <ScoreBadge label={result.label} score={result.score} />

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-2">
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
                            <p className="text-xs text-gray-500 mb-1">Total Token</p>
                            <p className="text-lg font-bold text-white">{result.totalTokens}</p>
                        </div>
                        <div className="bg-emerald-900/20 border border-emerald-800/40 rounded-xl p-3 text-center">
                            <p className="text-xs text-gray-500 mb-1">Masih Hidup</p>
                            <p className="text-lg font-bold text-emerald-400">{result.aliveTokens}</p>
                        </div>
                        <div className="bg-red-900/20 border border-red-800/40 rounded-xl p-3 text-center">
                            <p className="text-xs text-gray-500 mb-1">Rug/Mati</p>
                            <p className="text-lg font-bold text-red-400">{result.deadTokens}</p>
                        </div>
                    </div>

                    {/* Deployer address */}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                        <p className="text-xs text-gray-500 mb-1">Deployer</p>
                        <div className="flex items-center gap-2">
                            <code className="text-xs text-gray-300 font-mono flex-1 truncate">{result.deployer}</code>
                            <a
                                href={`https://basescan.org/address/${result.deployer}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-500 hover:text-blue-400 shrink-0"
                            >
                                BaseScan ↗
                            </a>
                        </div>
                    </div>

                    {/* Token checks */}
                    {result.tokenChecks.length > 0 && (
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                            <p className="text-xs text-gray-400 font-semibold mb-3">
                                Token yang diperiksa ({result.tokenChecks.length})
                            </p>
                            <div className="space-y-2">
                                {result.tokenChecks.map(tc => (
                                    <div
                                        key={tc.address}
                                        className={`flex items-center justify-between rounded-lg px-3 py-2 border ${
                                            tc.alive === true
                                                ? 'bg-emerald-900/20 border-emerald-800/40'
                                                : tc.alive === false
                                                    ? 'bg-red-900/20 border-red-800/40'
                                                    : 'bg-gray-800/40 border-gray-700/40'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm">
                                                {tc.alive === true ? '✅' : tc.alive === false ? '💀' : '❓'}
                                            </span>
                                            <div>
                                                <p className="text-xs font-semibold text-white">
                                                    {tc.tokenSymbol || tc.tokenName || 'Unknown'}
                                                </p>
                                                <a
                                                    href={`https://basescan.org/token/${tc.address}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-xs text-gray-600 hover:text-blue-400 font-mono"
                                                >
                                                    {`${tc.address.slice(0, 8)}…${tc.address.slice(-6)}`}
                                                </a>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            {tc.liquidityUsd > 0 && (
                                                <p className="text-xs text-gray-400">
                                                    ${tc.liquidityUsd >= 1000
                                                        ? `${(tc.liquidityUsd / 1000).toFixed(1)}k`
                                                        : tc.liquidityUsd.toFixed(0)} liq
                                                </p>
                                            )}
                                            {tc.pairUrl && (
                                                <a
                                                    href={tc.pairUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-xs text-blue-500 hover:text-blue-400"
                                                >
                                                    Chart ↗
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {result.skipped && (
                        <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 text-center">
                            <p className="text-xs text-gray-500">Tidak cukup data untuk memberi skor — kurang dari 2 token yang bisa diperiksa.</p>
                        </div>
                    )}

                    <p className="text-center text-xs text-gray-700">
                        Dicek: {new Date(result.checkedAt).toLocaleString('id-ID')} · Cache 30 menit
                    </p>
                </div>
            )}

            {/* How it works */}
            {!result && !loading && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <p className="text-xs text-gray-400 font-semibold mb-2">Cara kerja:</p>
                    <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
                        <li>Sistem mencari semua token yang pernah di-deploy oleh deployer ini</li>
                        <li>Setiap token dicek apakah masih trading (likuiditas &gt;$100) atau sudah mati</li>
                        <li>Skor dihitung dari survival rate: lebih banyak yang masih hidup = skor tinggi</li>
                        <li>≥65 = Trusted · 35–64 = Neutral · &lt;35 = Risky</li>
                    </ul>
                </div>
            )}
        </div>
    );
};

export default DeployerRepCheck;
