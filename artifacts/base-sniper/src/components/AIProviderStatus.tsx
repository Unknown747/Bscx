interface ProviderStat {
    hasKey:           boolean;
    onCooldown:       boolean;
    cooldownSecsLeft: number;
    success:          number;
    fail:             number;
    avgLatency:       number;
}

interface AIStats {
    providers: {
        groq:         ProviderStat;
        gemini:       ProviderStat;
        huggingface:  ProviderStat;
    };
    currentProvider: string;
    timestamp:       number;
}

interface Props {
    aiStats: AIStats | null | undefined;
}

const LABELS: Record<string, string> = {
    groq:        'Groq',
    gemini:      'Gemini',
    huggingface: 'HuggingFace',
};

const ICONS: Record<string, string> = {
    groq:        '⚡',
    gemini:      '✨',
    huggingface: '🤗',
};

function formatSecs(secs: number): string {
    if (secs >= 3600) return `${Math.floor(secs / 3600)}j ${Math.floor((secs % 3600) / 60)}m`;
    if (secs >= 60)   return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    return `${secs}s`;
}

export default function AIProviderStatus({ aiStats }: Props) {
    if (!aiStats?.providers) return null;

    const providers = ['groq', 'gemini', 'huggingface'] as const;
    const anyActive = providers.some(p => {
        const s = aiStats.providers[p];
        return s?.hasKey && !s?.onCooldown;
    });

    return (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                    <span>🤖</span>
                    AI Provider
                </h2>
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                    anyActive
                        ? 'bg-green-900/40 text-green-400 border-green-800'
                        : 'bg-yellow-900/40 text-yellow-400 border-yellow-800'
                }`}>
                    {anyActive ? 'Online' : 'Semua Cooldown'}
                </span>
            </div>

            <div className="space-y-2">
                {providers.map(key => {
                    const s = aiStats.providers[key];
                    if (!s) return null;

                    const isActive  = aiStats.currentProvider === key;
                    const total     = s.success + s.fail;
                    const winRate   = total > 0 ? Math.round((s.success / total) * 100) : null;

                    let statusColor = 'text-gray-500';
                    let statusLabel = '—';
                    let bgColor     = 'bg-gray-950 border-gray-800';

                    if (!s.hasKey) {
                        statusColor = 'text-gray-600';
                        statusLabel = 'Tidak ada key';
                    } else if (s.onCooldown) {
                        statusColor = 'text-yellow-400';
                        statusLabel = `Cooldown ${formatSecs(s.cooldownSecsLeft)}`;
                        bgColor     = 'bg-yellow-950/20 border-yellow-900/60';
                    } else if (isActive) {
                        statusColor = 'text-green-400';
                        statusLabel = 'Aktif';
                        bgColor     = 'bg-green-950/20 border-green-900/60';
                    } else {
                        statusColor = 'text-blue-400';
                        statusLabel = 'Siap';
                    }

                    return (
                        <div key={key} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${bgColor}`}>
                            <span className="text-base w-5 text-center leading-none">{ICONS[key]}</span>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-semibold text-white">{LABELS[key]}</span>
                                    {isActive && !s.onCooldown && s.hasKey && (
                                        <span className="text-[9px] bg-green-800 text-green-300 px-1.5 py-0.5 rounded-full font-bold leading-none">
                                            PRIMARY
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                    {winRate !== null && (
                                        <span className="text-[10px] text-gray-500">
                                            {s.success}✓ {s.fail}✗
                                        </span>
                                    )}
                                    {s.avgLatency > 0 && (
                                        <span className="text-[10px] text-gray-600">
                                            ~{Math.round(s.avgLatency)}ms
                                        </span>
                                    )}
                                </div>
                            </div>
                            <span className={`text-xs font-medium flex-shrink-0 ${statusColor}`}>
                                {statusLabel}
                            </span>
                        </div>
                    );
                })}
            </div>

            {!anyActive && (
                <p className="text-[10px] text-yellow-500/70 mt-2 text-center">
                    Semua provider sedang cooldown — bot pakai rule-based fallback
                </p>
            )}
        </div>
    );
}
