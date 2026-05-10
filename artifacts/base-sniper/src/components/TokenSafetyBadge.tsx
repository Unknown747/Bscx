import React, { useEffect, useState } from 'react';
import { authFetch } from '../lib/authFetch';

interface SafetyDetails {
    isHoneypot:             boolean;
    buyTax:                 number;
    sellTax:                number;
    hasMintFunction:        boolean;
    ownershipRenounced:     boolean;
    ownerBalance:           number;
    isProxy:                boolean;
    cannotSell:             boolean;
    cannotBuy:              boolean;
    liquidityLocked:        boolean;
    topHolderConcentration: number;
    honeypotIs?:            boolean;
}

interface SafetyReport {
    tokenAddress: string;
    safe:         boolean;
    score:        number;
    flags:        string[];
    details:      SafetyDetails;
    checkedAt:    number;
}

interface Props {
    apiUrl:       string;
    tokenAddress: string;
    size?:        'compact' | 'full';
    showFlags?:   boolean;
}

function ScorePill({ score, safe }: { score: number; safe: boolean }) {
    const bg =
        !safe   ? 'bg-red-900/60 border-red-700 text-red-300' :
        score >= 75 ? 'bg-green-900/50 border-green-700 text-green-300' :
        score >= 50 ? 'bg-yellow-900/40 border-yellow-700 text-yellow-300' :
                     'bg-orange-900/40 border-orange-700 text-orange-300';
    const icon = !safe ? '🚨' : score >= 75 ? '✅' : score >= 50 ? '⚠️' : '⚠️';
    return (
        <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border ${bg}`}>
            {icon} {score}/100
        </span>
    );
}

const TokenSafetyBadge: React.FC<Props> = ({ apiUrl, tokenAddress, size = 'compact', showFlags = false }) => {
    const [report, setReport]   = useState<SafetyReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(false);

    useEffect(() => {
        if (!tokenAddress || !tokenAddress.match(/^0x[0-9a-fA-F]{40}$/i)) {
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(false);
        authFetch(`${apiUrl}/api/safety/${tokenAddress}`)
            .then(r => r.json())
            .then(d => { if (!d.error) setReport(d); else setError(true); })
            .catch(() => setError(true))
            .finally(() => setLoading(false));
    }, [apiUrl, tokenAddress]);

    if (loading) {
        return (
            <span className="inline-flex items-center gap-1 text-xs text-gray-600 px-2 py-0.5">
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <span>cek safety...</span>
            </span>
        );
    }

    if (error || !report) {
        return <span className="inline-flex items-center text-xs text-gray-700 px-1">—</span>;
    }

    if (size === 'compact') {
        return (
            <span className="inline-flex items-center gap-1 flex-shrink-0">
                <ScorePill score={report.score} safe={report.safe} />
                {report.details.isHoneypot && (
                    <span className="text-xs bg-red-900/60 border border-red-700 text-red-300 px-1.5 py-0.5 rounded-full font-bold">
                        HONEYPOT
                    </span>
                )}
                {report.details.sellTax > 10 && !report.details.isHoneypot && (
                    <span className="text-xs text-orange-400">tax {report.details.sellTax}%</span>
                )}
            </span>
        );
    }

    // size === 'full'
    const dangerFlags = report.flags.filter(f => f.includes('🚨'));
    const warnFlags   = report.flags.filter(f => f.includes('⚠️'));
    const safeFlags   = report.flags.filter(f => f.includes('✅'));

    return (
        <div className={`rounded-xl border p-3 space-y-2 ${
            !report.safe
                ? 'bg-red-950/30 border-red-800/60'
                : report.score >= 75
                    ? 'bg-green-950/30 border-green-800/40'
                    : 'bg-yellow-950/20 border-yellow-800/40'
        }`}>
            {/* Score row */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <ScorePill score={report.score} safe={report.safe} />
                    <span className="text-xs text-gray-400">
                        {report.safe ? 'Token aman untuk trading' : 'Token BERISIKO TINGGI'}
                    </span>
                </div>
                <a
                    href={`https://app.gopluslabs.io/token-security/8453/${tokenAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                    GoPlus ↗
                </a>
            </div>

            {/* Tax row */}
            {(report.details.buyTax > 0 || report.details.sellTax > 0) && (
                <div className="flex gap-3 text-xs">
                    <span className={`${report.details.buyTax > 10 ? 'text-orange-400' : 'text-gray-400'}`}>
                        Buy tax: <b>{report.details.buyTax}%</b>
                    </span>
                    <span className={`${report.details.sellTax > 10 ? 'text-orange-400' : 'text-gray-400'}`}>
                        Sell tax: <b>{report.details.sellTax}%</b>
                    </span>
                    {report.details.liquidityLocked && (
                        <span className="text-green-400">🔒 LP locked</span>
                    )}
                    {report.details.ownershipRenounced && (
                        <span className="text-green-400">🔓 Renounced</span>
                    )}
                </div>
            )}

            {/* Flags */}
            {(showFlags || !report.safe) && (dangerFlags.length > 0 || warnFlags.length > 0) && (
                <div className="space-y-1">
                    {dangerFlags.map((f, i) => (
                        <p key={i} className="text-xs text-red-300 leading-snug">{f}</p>
                    ))}
                    {warnFlags.slice(0, 3).map((f, i) => (
                        <p key={i} className="text-xs text-yellow-300 leading-snug">{f}</p>
                    ))}
                    {safeFlags.length > 0 && dangerFlags.length === 0 && warnFlags.length === 0 && (
                        <p className="text-xs text-green-400">{safeFlags[0]}</p>
                    )}
                </div>
            )}

            {/* Honeypot.is double-check */}
            {report.details.honeypotIs !== undefined && (
                <p className="text-xs text-gray-600">
                    Honeypot.is: <span className={report.details.honeypotIs ? 'text-red-400 font-bold' : 'text-green-400'}>
                        {report.details.honeypotIs ? '🚨 HONEYPOT' : '✅ Aman'}
                    </span>
                </p>
            )}
        </div>
    );
};

export default TokenSafetyBadge;
