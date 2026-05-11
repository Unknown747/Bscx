import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../lib/authFetch';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface BotSettings {
    // Capital
    totalCapital: number;
    maxTradeAmount: number;
    minLiquidity: number;
    maxSlippage: number;
    // Exit
    tp1Multiplier: number;
    tp1Percentage: number;
    tp2Multiplier: number;
    tp2Percentage: number;
    stopLoss: number;
    // Gas
    maxPriorityFee: number;
    maxFeePerGas: number;
    gasMode: string;
    // AI
    aiEnabled: boolean;
    minAiConfidence: number;
    // Scanner
    enableFlashblocks: boolean;
    geckoScannerEnabled: boolean;
    dcaEnabled: boolean;
    dynamicSizingEnabled: boolean;
    tradeBalancePct: number;
    // Safety
    blockHoneypot: boolean;
    blockHighTax: boolean;
    maxTaxPercent: number;
    minSafetyScore: number;
    maxPoolAgeSeconds: number;
    // Deployer
    serialRuggerEnabled: boolean;
    serialRuggerMaxDeploys: number;
    serialRuggerWindowHours: number;
    reputationEnabled: boolean;
    reputationMinScore: number;
    // Circuit Breaker
    maxDailyLossEth: number;
    maxConsecutiveLosses: number;
    cooldownAfterProfitMinutes: number;
    dailyLossCooldownHours: number;
    // Trading Schedule (WIB)
    tradingScheduleEnabled: boolean;
    tradingStartHour: number;
    tradingEndHour: number;
    // Auto-compound
    autoCompoundEnabled: boolean;
    // Smart Screener
    smartScreenerEnabled: boolean;
}

interface KeyStatus {
    privateKey: boolean;
    groqKey: boolean;
    geminiKey: boolean;
    huggingfaceKey: boolean;
    appPassword: boolean;
    telegramToken: boolean;
    telegramChatId: boolean;
    backupHttpUrl?: boolean;
    backupWssUrl?: boolean;
    basescanApiKey?: boolean;
}

interface FieldState { value: string; show: boolean }
const EMPTY: FieldState = { value: '', show: false };

interface Props {
    apiUrl: string;
    onClose: () => void;
    currentConfig?: Record<string, any>;
}

type Tab = 'trading' | 'ai' | 'risk' | 'keys';

const TABS: { id: Tab; icon: string; label: string }[] = [
    { id: 'trading', icon: '💰', label: 'Trading'  },
    { id: 'ai',      icon: '🤖', label: 'AI'       },
    { id: 'risk',    icon: '🛡️', label: 'Risiko'   },
    { id: 'keys',    icon: '🔑', label: 'API Keys' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const pn = (v: any, fb: number) => { const n = parseFloat(v); return isNaN(n) ? fb : n; };
const pb = (v: any, fb: boolean): boolean => {
    if (v === undefined || v === null) return fb;
    if (typeof v === 'boolean') return v;
    return v === 'true';
};

const DEFAULTS: BotSettings = {
    totalCapital: 0.006, maxTradeAmount: 0.0006, minLiquidity: 0.15, maxSlippage: 15,
    tp1Multiplier: 1.5, tp1Percentage: 50, tp2Multiplier: 2.5, tp2Percentage: 50, stopLoss: 30,
    maxPriorityFee: 0.005, maxFeePerGas: 0.05, gasMode: 'auto',
    aiEnabled: true, minAiConfidence: 75,
    enableFlashblocks: false, geckoScannerEnabled: true, dcaEnabled: false,
    dynamicSizingEnabled: true, tradeBalancePct: 10,
    blockHoneypot: true, blockHighTax: true, maxTaxPercent: 10,
    minSafetyScore: 65, maxPoolAgeSeconds: 3600,
    serialRuggerEnabled: true, serialRuggerMaxDeploys: 3, serialRuggerWindowHours: 24,
    reputationEnabled: true, reputationMinScore: 25,
    maxDailyLossEth: 0.0015, maxConsecutiveLosses: 3, cooldownAfterProfitMinutes: 15, dailyLossCooldownHours: 2,
    tradingScheduleEnabled: false, tradingStartHour: 8, tradingEndHour: 23,
    autoCompoundEnabled: false,
    smartScreenerEnabled: false,
};

function fromConfig(c: Record<string, any>): BotSettings {
    return {
        totalCapital:            pn(c.capital, DEFAULTS.totalCapital),
        maxTradeAmount:          pn(c.maxTrade, DEFAULTS.maxTradeAmount),
        minLiquidity:            pn(c.minLiquidity, DEFAULTS.minLiquidity),
        maxSlippage:             pn(c.maxSlippage, DEFAULTS.maxSlippage),
        tp1Multiplier:           pn(c.tp1Multiplier, DEFAULTS.tp1Multiplier),
        tp1Percentage:           pn(c.tp1Percentage, DEFAULTS.tp1Percentage),
        tp2Multiplier:           pn(c.tp2Multiplier, DEFAULTS.tp2Multiplier),
        tp2Percentage:           pn(c.tp2Percentage, DEFAULTS.tp2Percentage),
        stopLoss:                pn(c.stopLoss, DEFAULTS.stopLoss),
        maxPriorityFee:          pn(c.maxPriorityFee, DEFAULTS.maxPriorityFee),
        maxFeePerGas:            pn(c.maxFeePerGas, DEFAULTS.maxFeePerGas),
        gasMode:                 c.gasMode || DEFAULTS.gasMode,
        aiEnabled:               pb(c.aiEnabled, DEFAULTS.aiEnabled),
        minAiConfidence:         pn(c.minAiConfidence, DEFAULTS.minAiConfidence),
        enableFlashblocks:       pb(c.enableFlashblocks, DEFAULTS.enableFlashblocks),
        geckoScannerEnabled:     pb(c.geckoScannerEnabled, DEFAULTS.geckoScannerEnabled),
        dcaEnabled:              pb(c.dcaEnabled, DEFAULTS.dcaEnabled),
        dynamicSizingEnabled:    pb(c.dynamicSizingEnabled, DEFAULTS.dynamicSizingEnabled),
        tradeBalancePct:         pn(c.tradeBalancePct, DEFAULTS.tradeBalancePct),
        blockHoneypot:           pb(c.blockHoneypot, DEFAULTS.blockHoneypot),
        blockHighTax:            pb(c.blockHighTax, DEFAULTS.blockHighTax),
        maxTaxPercent:           pn(c.maxTaxPercent, DEFAULTS.maxTaxPercent),
        minSafetyScore:          pn(c.minSafetyScore, DEFAULTS.minSafetyScore),
        maxPoolAgeSeconds:       pn(c.maxPoolAgeSeconds, DEFAULTS.maxPoolAgeSeconds),
        serialRuggerEnabled:     pb(c.serialRuggerEnabled, DEFAULTS.serialRuggerEnabled),
        serialRuggerMaxDeploys:  pn(c.serialRuggerMaxDeploys, DEFAULTS.serialRuggerMaxDeploys),
        serialRuggerWindowHours: pn(c.serialRuggerWindowHours, DEFAULTS.serialRuggerWindowHours),
        reputationEnabled:          pb(c.reputationEnabled, DEFAULTS.reputationEnabled),
        reputationMinScore:         pn(c.reputationMinScore, DEFAULTS.reputationMinScore),
        maxDailyLossEth:            pn(c.maxDailyLossEth, DEFAULTS.maxDailyLossEth),
        maxConsecutiveLosses:       pn(c.maxConsecutiveLosses, DEFAULTS.maxConsecutiveLosses),
        cooldownAfterProfitMinutes: pn(c.cooldownAfterProfitMinutes, DEFAULTS.cooldownAfterProfitMinutes),
        dailyLossCooldownHours:     pn(c.dailyLossCooldownHours, DEFAULTS.dailyLossCooldownHours),
        tradingScheduleEnabled: pb(c.tradingScheduleEnabled, DEFAULTS.tradingScheduleEnabled),
        tradingStartHour:       pn(c.tradingStartHour, DEFAULTS.tradingStartHour),
        tradingEndHour:         pn(c.tradingEndHour, DEFAULTS.tradingEndHour),
        autoCompoundEnabled:    pb(c.autoCompoundEnabled, DEFAULTS.autoCompoundEnabled),
        smartScreenerEnabled:   pb(c.smartScreenerEnabled, DEFAULTS.smartScreenerEnabled),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, color = 'green' }: { checked: boolean; onChange: (v: boolean) => void; color?: string }) {
    const cls: Record<string, string> = {
        green:  'peer-checked:bg-green-600',
        blue:   'peer-checked:bg-blue-600',
        purple: 'peer-checked:bg-purple-600',
        orange: 'peer-checked:bg-orange-600',
        cyan:   'peer-checked:bg-cyan-600',
        red:    'peer-checked:bg-red-600',
    };
    return (
        <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
            <input type="checkbox" className="sr-only peer" checked={checked} onChange={e => onChange(e.target.checked)} />
            <div className={`w-11 h-6 bg-gray-700 rounded-full peer after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full ${cls[color] ?? cls.green}`} />
        </label>
    );
}

function Row({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-4 py-3 border-b border-gray-800/60 last:border-0">
            <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium leading-tight">{label}</p>
                {sub && <p className="text-xs text-gray-500 mt-0.5 leading-tight">{sub}</p>}
            </div>
            <div className="flex-shrink-0">{children}</div>
        </div>
    );
}

function NumInput({ value, onChange, step, min, max }: {
    value: number; onChange: (v: number) => void;
    step: number; min: number; max?: number;
}) {
    return (
        <input
            type="number" step={step} min={min} max={max} value={value}
            onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }}
            className="w-24 bg-gray-900 border border-gray-700 focus:border-green-500 rounded-lg px-2 py-1.5 text-white text-sm text-right focus:outline-none"
        />
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 mb-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{title}</h3>
            {children}
        </div>
    );
}

function StatusBadge({ set }: { set: boolean }) {
    return (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${set
            ? 'bg-green-900/50 text-green-400 border border-green-800'
            : 'bg-gray-800 text-gray-500 border border-gray-700'}`}>
            {set ? '✓ Set' : '✗ Kosong'}
        </span>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
// Format IDR — handles any size without rounding to zero
function fmtIdr(eth: number, ethUsd: number): string {
    const idr = eth * ethUsd * 16000;
    if (idr >= 1_000_000) return `Rp${(idr / 1_000_000).toFixed(2)}jt`;
    if (idr >= 1_000)     return `Rp${(idr / 1_000).toFixed(1)}rb`;
    return `Rp${Math.round(idr)}`;
}

const SettingsModal: React.FC<Props> = ({ apiUrl, onClose, currentConfig }) => {
    const [tab, setTab]         = useState<Tab>('trading');
    const [s, setS]             = useState<BotSettings>(currentConfig ? fromConfig(currentConfig) : DEFAULTS);
    const [saveState, setSave]  = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [saveMsg, setSaveMsg] = useState('');
    const upd = (patch: Partial<BotSettings>) => setS(prev => ({ ...prev, ...patch }));

    // Inisialisasi form SEKALI saja dari config (tidak di-reset saat config berubah dari polling)
    const initializedRef = React.useRef(false);
    useEffect(() => {
        if (!initializedRef.current && currentConfig) {
            setS(fromConfig(currentConfig));
            initializedRef.current = true;
        }
    }, [currentConfig]);

    // Live ETH price
    const [ethPrice, setEthPrice] = useState<number>(3500);
    useEffect(() => {
        authFetch(`${apiUrl}/api/eth-price`)
            .then(r => r.json())
            .then(d => { if (d?.usd && d.usd > 0) setEthPrice(d.usd); })
            .catch(() => {});
    }, [apiUrl]);

    // Keys state
    const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
    const [privateKey,     setPk]   = useState<FieldState>(EMPTY);
    const [groqKey,        setGk]   = useState<FieldState>(EMPTY);
    const [geminiKey,      setGem]  = useState<FieldState>(EMPTY);
    const [hfKey,          setHf]   = useState<FieldState>(EMPTY);
    const [appPw,          setApw]  = useState<FieldState>(EMPTY);
    const [tgToken,        setTgt]  = useState<FieldState>(EMPTY);
    const [tgChat,         setTgc]  = useState<FieldState>(EMPTY);
    const [tgTest, setTgTest]       = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
    // RPC & BaseScan
    const [backupHttpRpc,  setBhr]  = useState<FieldState>(EMPTY);
    const [backupWssRpc,   setBwr]  = useState<FieldState>(EMPTY);
    const [basescanKey,    setBsk]  = useState<FieldState>(EMPTY);

    // Gas calc
    const gasCost = ((s.maxFeePerGas * 150000) / 1e9);
    const maxSnipes = s.totalCapital > 0
        ? Math.min(Math.floor((s.totalCapital * 0.7) / (s.maxTradeAmount + gasCost)), 20)
        : 0;

    useEffect(() => {
        authFetch(`${apiUrl}/api/keys`).then(r => r.json()).then(setKeyStatus).catch(() => {});
    }, [apiUrl]);

    const saveSettings = useCallback(async () => {
        setSave('saving');
        try {
            const payload = {
                totalCapital: s.totalCapital, maxTradeAmount: s.maxTradeAmount,
                minLiquidity: s.minLiquidity, maxSlippage: s.maxSlippage,
                tp1Multiplier: s.tp1Multiplier, tp1Percentage: s.tp1Percentage,
                tp2Multiplier: s.tp2Multiplier, tp2Percentage: s.tp2Percentage,
                stopLoss: s.stopLoss, maxPriorityFee: s.maxPriorityFee,
                maxFeePerGas: s.maxFeePerGas, gasMode: s.gasMode,
                aiEnabled: s.aiEnabled, minAiConfidence: s.minAiConfidence,
                enableFlashblocks: s.enableFlashblocks, geckoScannerEnabled: s.geckoScannerEnabled,
                dcaEnabled: s.dcaEnabled, dynamicSizingEnabled: s.dynamicSizingEnabled,
                tradeBalancePct: s.tradeBalancePct, blockHoneypot: s.blockHoneypot,
                blockHighTax: s.blockHighTax, maxTaxPercent: s.maxTaxPercent,
                minSafetyScore: s.minSafetyScore, maxPoolAgeSeconds: s.maxPoolAgeSeconds,
                serialRuggerEnabled: s.serialRuggerEnabled,
                serialRuggerMaxDeploys: s.serialRuggerMaxDeploys,
                serialRuggerWindowHours: s.serialRuggerWindowHours,
                reputationEnabled: s.reputationEnabled, reputationMinScore: s.reputationMinScore,
                maxDailyLossEth: s.maxDailyLossEth,
                maxConsecutiveLosses: s.maxConsecutiveLosses,
                cooldownAfterProfitMinutes: s.cooldownAfterProfitMinutes,
                dailyLossCooldownHours: s.dailyLossCooldownHours,
                tradingScheduleEnabled: s.tradingScheduleEnabled,
                tradingStartHour: s.tradingStartHour,
                tradingEndHour: s.tradingEndHour,
                autoCompoundEnabled:  s.autoCompoundEnabled,
                smartScreenerEnabled: s.smartScreenerEnabled,
            };
            const res = await authFetch(`${apiUrl}/api/settings`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('Server error');
            setSave('saved'); setSaveMsg('Pengaturan disimpan');
            setTimeout(() => setSave('idle'), 2500);
        } catch (e: any) {
            setSave('error'); setSaveMsg(e.message || 'Gagal menyimpan');
            setTimeout(() => setSave('idle'), 3000);
        }
    }, [apiUrl, s]);

    const saveKeys = useCallback(async () => {
        const payload: Record<string, string> = {};
        if (privateKey.value.trim())     payload.privateKey     = privateKey.value.trim();
        if (groqKey.value.trim())        payload.groqKey        = groqKey.value.trim();
        if (geminiKey.value.trim())      payload.geminiKey      = geminiKey.value.trim();
        if (hfKey.value.trim())          payload.huggingfaceKey = hfKey.value.trim();
        if (appPw.value.trim())          payload.appPassword    = appPw.value.trim();
        if (tgToken.value.trim())        payload.telegramToken  = tgToken.value.trim();
        if (tgChat.value.trim())         payload.telegramChatId = tgChat.value.trim();
        if (backupHttpRpc.value.trim())  payload.backupHttpUrl  = backupHttpRpc.value.trim();
        if (backupWssRpc.value.trim())   payload.backupWssUrl   = backupWssRpc.value.trim();
        if (basescanKey.value.trim())    payload.basescanApiKey = basescanKey.value.trim();
        if (!Object.keys(payload).length) return;
        setSave('saving');
        try {
            const res = await authFetch(`${apiUrl}/api/keys`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('Server error');
            setSave('saved'); setSaveMsg('Disimpan');
            [setPk, setGk, setGem, setHf, setApw, setTgt, setTgc, setBhr, setBwr, setBsk].forEach(fn => fn(EMPTY));
            const updated = await authFetch(`${apiUrl}/api/keys`).then(r => r.json());
            setKeyStatus(updated);
            setTimeout(() => setSave('idle'), 2500);
        } catch (e: any) {
            setSave('error'); setSaveMsg(e.message || 'Gagal');
            setTimeout(() => setSave('idle'), 3000);
        }
    }, [apiUrl, privateKey, groqKey, geminiKey, hfKey, appPw, tgToken, tgChat, backupHttpRpc, backupWssRpc, basescanKey]);

    const handleSave = tab === 'keys' ? saveKeys : saveSettings;

    function KeyField({ label, hint, ph, state, setState, isSet, mono = true }: {
        label: string; hint: string; ph: string;
        state: FieldState; setState: React.Dispatch<React.SetStateAction<FieldState>>;
        isSet?: boolean; mono?: boolean;
    }) {
        return (
            <div className="mb-4 last:mb-0">
                <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm text-gray-300 font-medium">{label}</label>
                    {isSet !== undefined && <StatusBadge set={isSet} />}
                </div>
                <div className="relative">
                    <input
                        type={state.show ? 'text' : 'password'}
                        value={state.value}
                        onChange={e => setState(p => ({ ...p, value: e.target.value }))}
                        placeholder={ph}
                        className={`w-full bg-gray-950 border border-gray-700 focus:border-green-500 rounded-xl px-4 py-2.5 pr-12 text-white placeholder-gray-600 text-sm focus:outline-none transition-colors ${mono ? 'font-mono' : ''}`}
                    />
                    <button
                        type="button"
                        onClick={() => setState(p => ({ ...p, show: !p.show }))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-base"
                    >{state.show ? '🙈' : '👁️'}</button>
                </div>
                <p className="text-xs text-gray-600 mt-1">{hint}</p>
            </div>
        );
    }

    // ─── Tab: Trading ─────────────────────────────────────────────────────────
    const TabTrading = () => (
        <div>
            {/* Summary strip */}
            <div className="grid grid-cols-3 gap-2 mb-4">
                {[
                    { label: 'Modal', value: `${s.totalCapital.toFixed(4)} ETH`, sub: `≈ ${fmtIdr(s.totalCapital, ethPrice)}` },
                    { label: 'Per Trade', value: `${s.maxTradeAmount.toFixed(4)} ETH`, sub: `${s.totalCapital > 0 ? Math.round(s.maxTradeAmount / s.totalCapital * 100) : 0}% modal` },
                    { label: 'Max Snipe', value: `${maxSnipes}x`, sub: 'per hari' },
                ].map(({ label, value, sub }) => (
                    <div key={label} className="bg-gray-950 border border-gray-800 rounded-xl p-3 text-center">
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className="text-sm font-bold text-white mt-0.5">{value}</p>
                        <p className="text-xs text-gray-600">{sub}</p>
                    </div>
                ))}
            </div>

            <Section title="💰 Modal & Likuiditas">
                <Row label="Total Modal (ETH)" sub="Keseluruhan modal trading">
                    <NumInput value={s.totalCapital} onChange={v => upd({ totalCapital: v })} step={0.001} min={0.001} />
                </Row>
                <Row label="Max per Trade (ETH)" sub="Batas per transaksi snipe">
                    <NumInput value={s.maxTradeAmount} onChange={v => upd({ maxTradeAmount: v })} step={0.0001} min={0.0001} />
                </Row>
                <Row label="Min Likuiditas Pool (ETH)" sub="Abaikan pool dengan likuiditas kecil">
                    <NumInput value={s.minLiquidity} onChange={v => upd({ minLiquidity: v })} step={0.05} min={0} />
                </Row>
                <Row label="Max Slippage (%)" sub="Toleransi harga saat eksekusi">
                    <NumInput value={s.maxSlippage} onChange={v => upd({ maxSlippage: v })} step={1} min={1} max={50} />
                </Row>
            </Section>

            <Section title="📈 Exit Strategy">
                <Row label="Take Profit 1" sub={`Jual ${s.tp1Percentage}% posisi saat harga ${s.tp1Multiplier}x`}>
                    <div className="flex items-center gap-1.5">
                        <NumInput value={s.tp1Multiplier} onChange={v => upd({ tp1Multiplier: v })} step={0.5} min={1} />
                        <span className="text-xs text-gray-500">x</span>
                        <NumInput value={s.tp1Percentage} onChange={v => upd({ tp1Percentage: v })} step={10} min={1} max={100} />
                        <span className="text-xs text-gray-500">%</span>
                    </div>
                </Row>
                <Row label="Take Profit 2" sub={`Jual ${s.tp2Percentage}% posisi saat harga ${s.tp2Multiplier}x`}>
                    <div className="flex items-center gap-1.5">
                        <NumInput value={s.tp2Multiplier} onChange={v => upd({ tp2Multiplier: v })} step={0.5} min={1} />
                        <span className="text-xs text-gray-500">x</span>
                        <NumInput value={s.tp2Percentage} onChange={v => upd({ tp2Percentage: v })} step={10} min={1} max={100} />
                        <span className="text-xs text-gray-500">%</span>
                    </div>
                </Row>
                <Row label="Stop Loss (%)" sub="Jual semua saat rugi sebesar ini">
                    <div className="flex items-center gap-1.5">
                        <NumInput value={s.stopLoss} onChange={v => upd({ stopLoss: v })} step={5} min={1} max={99} />
                        <span className="text-xs text-red-400">%</span>
                    </div>
                </Row>
            </Section>

            <Section title="⛽ Gas">
                <Row label="Mode Gas" sub="auto = baca base fee aktual Base">
                    <select value={s.gasMode} onChange={e => upd({ gasMode: e.target.value })}
                        className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none">
                        <option value="auto">auto</option>
                        <option value="fast">fast</option>
                        <option value="slow">slow</option>
                    </select>
                </Row>
                <Row label="Max Priority Fee (Gwei)" sub="Rekomendasi 0.005 di Base">
                    <NumInput value={s.maxPriorityFee} onChange={v => upd({ maxPriorityFee: v })} step={0.001} min={0} />
                </Row>
                <Row label="Max Fee per Gas (Gwei)" sub="Rekomendasi 0.05 di Base">
                    <NumInput value={s.maxFeePerGas} onChange={v => upd({ maxFeePerGas: v })} step={0.01} min={0} />
                </Row>
                <div className="mt-2 px-2 py-2 bg-blue-950/40 rounded-lg">
                    <p className="text-xs text-blue-400">💡 Estimasi gas: {gasCost.toFixed(5)} ETH ≈ {fmtIdr(gasCost, ethPrice)} per tx <span className="text-gray-600">(ETH ≈ ${ethPrice.toLocaleString()})</span></p>
                </div>
            </Section>

            <Section title="♻️ Auto-Compound Profit">
                <Row label="Auto-Compound Aktif" sub="Profit TP2 otomatis ditambah ke modal">
                    <Toggle checked={s.autoCompoundEnabled} onChange={v => upd({ autoCompoundEnabled: v })} color="green" />
                </Row>
                {s.autoCompoundEnabled && (
                    <div className="mt-1 px-2 py-2 bg-green-950/30 rounded-lg border border-green-900/40">
                        <p className="text-xs text-green-400">💡 Setiap TP2 tercapai, profit ETH langsung ditambahkan ke Total Modal — modal tumbuh otomatis tanpa perlu setting ulang.</p>
                    </div>
                )}
            </Section>

            <Section title="📊 Dynamic Sizing">
                <Row label="Dynamic Sizing" sub={`${s.tradeBalancePct}% balance per trade`}>
                    <Toggle checked={s.dynamicSizingEnabled} onChange={v => upd({ dynamicSizingEnabled: v })} color="cyan" />
                </Row>
                {s.dynamicSizingEnabled && (
                    <Row label="% Balance per Trade" sub="Otomatis sesuai saldo">
                        <NumInput value={s.tradeBalancePct} onChange={v => upd({ tradeBalancePct: v })} step={5} min={1} max={50} />
                    </Row>
                )}
            </Section>
        </div>
    );

    // ─── Tab: AI & Scanner ────────────────────────────────────────────────────
    const TabAI = () => (
        <div>
            <Section title="🤖 Analisis AI">
                <Row label="AI Trading Aktif" sub="Filter keputusan beli dengan multi-AI">
                    <Toggle checked={s.aiEnabled} onChange={v => upd({ aiEnabled: v })} color="blue" />
                </Row>
                {s.aiEnabled && (
                    <div className="pt-2 px-1">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-gray-300">Min Confidence AI</p>
                            <span className="text-blue-400 font-bold text-sm">{s.minAiConfidence}%</span>
                        </div>
                        <input type="range" min={50} max={95} step={5} value={s.minAiConfidence}
                            onChange={e => upd({ minAiConfidence: parseInt(e.target.value) })}
                            className="w-full accent-blue-500 mb-3" />
                        <div className="grid grid-cols-3 gap-2 text-center">
                            {[
                                { label: 'Agresif', range: '50-65%', color: 'yellow', active: s.minAiConfidence <= 65 },
                                { label: 'Balanced', range: '70-80%', color: 'blue', active: s.minAiConfidence > 65 && s.minAiConfidence <= 80 },
                                { label: 'Konservatif', range: '85-95%', color: 'green', active: s.minAiConfidence > 80 },
                            ].map(({ label, range, color, active }) => (
                                <div key={label} className={`p-2 rounded-lg border text-xs ${active
                                    ? `bg-${color}-900/30 border-${color}-700 text-${color}-400`
                                    : 'bg-gray-900/40 border-gray-800 text-gray-600'}`}>
                                    <div className="font-semibold">{label}</div>
                                    <div className="text-gray-500">{range}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {!s.aiEnabled && (
                    <p className="text-xs text-yellow-400 bg-yellow-900/20 rounded-lg p-3 mt-1">
                        ⚠️ AI dimatikan — bot beli semua token yang lolos safety check tanpa filter tambahan.
                    </p>
                )}
            </Section>

            <Section title="🔍 Scanner">
                <Row label="GeckoTerminal Scanner" sub="Scan token peluang via GeckoTerminal API">
                    <Toggle checked={s.geckoScannerEnabled} onChange={v => upd({ geckoScannerEnabled: v })} color="green" />
                </Row>
                <Row label="Smart Screener" sub="Skor 0–100 per token, auto-beli STRONG_BUY (independen dari GeckoTerminal)">
                    <Toggle checked={s.smartScreenerEnabled} onChange={v => upd({ smartScreenerEnabled: v })} color="purple" />
                </Row>
                <Row label="Flashblocks Scanner" sub="WebSocket ke Base Flashblocks (pool baru)">
                    <Toggle checked={s.enableFlashblocks} onChange={v => upd({ enableFlashblocks: v })} color="orange" />
                </Row>
                <Row label="DCA (Dollar Cost Average)" sub="Beli bertahap saat harga turun">
                    <Toggle checked={s.dcaEnabled} onChange={v => upd({ dcaEnabled: v })} color="cyan" />
                </Row>
            </Section>

        </div>
    );

    // ─── Tab: Risk ────────────────────────────────────────────────────────────
    const TabRisk = () => (
        <div>
            <Section title="🕐 Jadwal Trading Otomatis (WIB)">
                <Row label="Jadwal Aktif" sub="Batasi jam operasional bot (WIB = UTC+7)">
                    <Toggle checked={s.tradingScheduleEnabled} onChange={v => upd({ tradingScheduleEnabled: v })} color="orange" />
                </Row>
                {s.tradingScheduleEnabled && (
                    <>
                        <Row label="Jam Mulai (WIB)" sub="Bot mulai eksekusi dari jam ini">
                            <div className="flex items-center gap-1.5">
                                <NumInput value={s.tradingStartHour} onChange={v => upd({ tradingStartHour: Math.round(v) })} step={1} min={0} max={23} />
                                <span className="text-xs text-gray-500">:00</span>
                            </div>
                        </Row>
                        <Row label="Jam Selesai (WIB)" sub="Bot berhenti eksekusi dari jam ini">
                            <div className="flex items-center gap-1.5">
                                <NumInput value={s.tradingEndHour} onChange={v => upd({ tradingEndHour: Math.round(v) })} step={1} min={0} max={23} />
                                <span className="text-xs text-gray-500">:00</span>
                            </div>
                        </Row>
                        <div className="mt-1 px-2 py-2 bg-orange-950/30 rounded-lg border border-orange-900/40">
                            <p className="text-xs text-orange-400">
                                ⏰ Bot aktif {s.tradingStartHour.toString().padStart(2,'0')}:00 – {s.tradingEndHour.toString().padStart(2,'0')}:00 WIB
                                {s.tradingStartHour > s.tradingEndHour ? ' (overnight — melewati tengah malam)' : ''}
                                . Di luar jam ini semua sinyal diabaikan.
                            </p>
                        </div>
                    </>
                )}
            </Section>

            <Section title="⏳ Auto Cooldown (Circuit Breaker)">
                <Row label="Max Rugi Harian (ETH)" sub="Picu cooldown otomatis jika rugi melebihi ini">
                    <NumInput value={s.maxDailyLossEth} onChange={v => upd({ maxDailyLossEth: v })} step={0.0005} min={0.0001} />
                </Row>
                <Row label="Durasi Cooldown Rugi Harian (jam)" sub="Bot jeda X jam lalu lanjut otomatis — tanpa perlu restart">
                    <NumInput value={s.dailyLossCooldownHours} onChange={v => upd({ dailyLossCooldownHours: v })} step={0.5} min={0.5} max={24} />
                </Row>
                <Row label="Max Kalah Berturut-turut" sub="Cooldown 30 menit jika kalah sebanyak ini berurutan">
                    <NumInput value={s.maxConsecutiveLosses} onChange={v => upd({ maxConsecutiveLosses: v })} step={1} min={1} max={20} />
                </Row>
                <Row label="Cooldown Setelah Profit Besar (menit)" sub="Jeda setelah profit > 50% modal (biarkan profit aman dulu)">
                    <NumInput value={s.cooldownAfterProfitMinutes} onChange={v => upd({ cooldownAfterProfitMinutes: v })} step={5} min={0} max={120} />
                </Row>
                <div className="mt-2 px-2 py-2 bg-blue-950/30 rounded-lg border border-blue-900/40">
                    <p className="text-xs text-blue-400">✅ Bot lanjut otomatis setelah cooldown — tidak perlu restart atau ubah settings. Emergency Stop tetap tersedia di header untuk stop manual.</p>
                </div>
            </Section>

            <Section title="🛡️ Keamanan Token">
                <Row label="Blokir Honeypot" sub="Tolak token yang tidak bisa dijual">
                    <Toggle checked={s.blockHoneypot} onChange={v => upd({ blockHoneypot: v })} color="orange" />
                </Row>
                <Row label="Blokir Pajak Tinggi" sub="Tolak token dengan buy/sell tax tinggi">
                    <Toggle checked={s.blockHighTax} onChange={v => upd({ blockHighTax: v })} color="orange" />
                </Row>
                {s.blockHighTax && (
                    <Row label="Batas Max Tax (%)" sub="Tolak jika buy atau sell tax di atas ini">
                        <NumInput value={s.maxTaxPercent} onChange={v => upd({ maxTaxPercent: v })} step={1} min={1} max={50} />
                    </Row>
                )}
                <Row label="Min Safety Score" sub="Skor minimum GoPlus + Honeypot.is (0-100)">
                    <div className="flex items-center gap-2">
                        <NumInput value={s.minSafetyScore} onChange={v => upd({ minSafetyScore: v })} step={5} min={0} max={100} />
                        <span className="text-xs text-gray-500">/100</span>
                    </div>
                </Row>
                <Row label="Max Usia Pool (detik)" sub="Abaikan pool yang sudah terlalu lama">
                    <NumInput value={s.maxPoolAgeSeconds} onChange={v => upd({ maxPoolAgeSeconds: v })} step={60} min={0} />
                </Row>
            </Section>

            <Section title="🕵️ Anti-Rugger">
                <Row label="Deteksi Serial Rugger" sub="Blokir deployer yang sering rug">
                    <Toggle checked={s.serialRuggerEnabled} onChange={v => upd({ serialRuggerEnabled: v })} color="red" />
                </Row>
                {s.serialRuggerEnabled && <>
                    <Row label="Max Deploy dalam Window" sub="Berapa kali boleh deploy token gagal">
                        <NumInput value={s.serialRuggerMaxDeploys} onChange={v => upd({ serialRuggerMaxDeploys: v })} step={1} min={1} />
                    </Row>
                    <Row label="Window Jam" sub="Periode analisis riwayat (jam)">
                        <NumInput value={s.serialRuggerWindowHours} onChange={v => upd({ serialRuggerWindowHours: v })} step={6} min={1} />
                    </Row>
                </>}
            </Section>

            <Section title="⭐ Reputasi Deployer">
                <Row label="Filter Reputasi Deployer" sub="Hanya beli token dari deployer bereputasi">
                    <Toggle checked={s.reputationEnabled} onChange={v => upd({ reputationEnabled: v })} color="green" />
                </Row>
                {s.reputationEnabled && (
                    <Row label="Min Skor Reputasi" sub="0 = tolak semua baru, 100 = hanya proven">
                        <div className="flex items-center gap-2">
                            <NumInput value={s.reputationMinScore} onChange={v => upd({ reputationMinScore: v })} step={5} min={0} max={100} />
                            <span className="text-xs text-gray-500">/100</span>
                        </div>
                    </Row>
                )}
            </Section>
        </div>
    );

    // ─── Tab: API Keys ────────────────────────────────────────────────────────
    const TabKeys = () => (
        <div>
            <div className="bg-blue-900/20 border border-blue-800/40 rounded-xl p-3 mb-4 flex gap-2.5">
                <span>🛡️</span>
                <p className="text-xs text-blue-300 leading-relaxed">
                    Kunci disimpan di server dan tidak pernah dikirim ke browser. Kosongkan field jika tidak ingin mengubah nilai yang sudah ada.
                </p>
            </div>

            <Section title="💼 Wallet Trading">
                <KeyField label="Private Key" hint="Private key wallet Base Network (diawali 0x...)"
                    ph="0x..." state={privateKey} setState={setPk} isSet={keyStatus?.privateKey} />
                {privateKey.value && !privateKey.value.startsWith('0x') && (
                    <p className="text-xs text-yellow-400 mb-2">⚠️ Private key harus diawali dengan 0x</p>
                )}
            </Section>

            <Section title="🤖 AI Provider">
                <KeyField label="Groq API Key" hint="console.groq.com — gratis, latency ~88ms"
                    ph="gsk_..." state={groqKey} setState={setGk} isSet={keyStatus?.groqKey} />
                <KeyField label="Gemini API Key" hint="aistudio.google.com — 1M context window"
                    ph="AIza..." state={geminiKey} setState={setGem} isSet={keyStatus?.geminiKey} />
                <KeyField label="HuggingFace API Key" hint="huggingface.co/settings/tokens — fallback terakhir"
                    ph="hf_..." state={hfKey} setState={setHf} isSet={keyStatus?.huggingfaceKey} />
            </Section>

            <Section title="📱 Notifikasi Telegram">
                <div className="mb-3 bg-gray-900/60 rounded-lg p-3 text-xs text-gray-400 space-y-1">
                    <p className="font-medium text-gray-300">Setup:</p>
                    <p>1. Buka <span className="text-blue-400">@BotFather</span> → <code>/newbot</code> → salin token</p>
                    <p>2. Chat bot kamu → buka <span className="text-blue-400">@userinfobot</span> untuk dapat Chat ID</p>
                </div>
                {keyStatus?.telegramToken && keyStatus?.telegramChatId && (
                    <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs bg-green-900/40 text-green-400 border border-green-800 px-2 py-0.5 rounded-full">Aktif</span>
                        <button
                            onClick={async () => {
                                setTgTest('sending');
                                try {
                                    const res = await authFetch(`${apiUrl}/api/telegram/test`, { method: 'POST' });
                                    const d = await res.json();
                                    setTgTest(d.ok ? 'ok' : 'error');
                                    setTimeout(() => setTgTest('idle'), 4000);
                                } catch { setTgTest('error'); }
                            }}
                            disabled={tgTest === 'sending'}
                            className="text-xs px-3 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/40 border border-blue-600/40 text-blue-400 disabled:opacity-50"
                        >
                            {tgTest === 'sending' ? '⏳ Mengirim...' : tgTest === 'ok' ? '✅ Terkirim!' : tgTest === 'error' ? '❌ Gagal' : '📤 Test Kirim'}
                        </button>
                    </div>
                )}
                <KeyField label="Bot Token" hint="Format: 123456789:ABC-DEF... dari @BotFather"
                    ph="123456789:ABC-DEF..." state={tgToken} setState={setTgt} isSet={keyStatus?.telegramToken} />
                <KeyField label="Chat ID" hint="ID numerik chat kamu (bisa negatif untuk grup)"
                    ph="123456789" state={tgChat} setState={setTgc} isSet={keyStatus?.telegramChatId} mono={false} />
            </Section>

            <Section title="🔐 Keamanan Dashboard">
                <KeyField label="Password Dashboard" hint="Password login ke dashboard ini"
                    ph="Password baru..." state={appPw} setState={setApw} isSet={keyStatus?.appPassword} mono={false} />
            </Section>

            <Section title="🔗 Backup RPC">
                <p className="text-xs text-gray-500 mb-3">RPC bawaan sistem tetap diutamakan. Backup hanya dipakai jika primary gagal. Infura/Alchemy punya limit harian.</p>
                <KeyField label="Backup HTTP RPC" hint="https://mainnet.base.org / https://...infura.io/v3/KEY"
                    ph="https://..." state={backupHttpRpc} setState={setBhr} isSet={keyStatus?.backupHttpUrl} />
                <KeyField label="Backup WSS RPC" hint="wss://... (untuk scanner Flashblocks)"
                    ph="wss://..." state={backupWssRpc} setState={setBwr} isSet={keyStatus?.backupWssUrl} />
            </Section>

            <Section title="🔍 BaseScan API">
                <p className="text-xs text-gray-500 mb-3">Opsional. Daftar gratis di basescan.org/myapikey. Sistem sudah pakai Blockscout (gratis, tanpa key).</p>
                <KeyField label="BaseScan API Key" hint="basescan.org/myapikey"
                    ph="YourBaseScanApiKey..." state={basescanKey} setState={setBsk} isSet={keyStatus?.basescanApiKey} />
            </Section>
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black/85 flex items-end sm:items-center justify-center z-50">
            <div className="bg-gray-950 border border-gray-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg flex flex-col"
                style={{ maxHeight: '92dvh' }}>

                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-800 flex-shrink-0">
                    <div>
                        <h2 className="text-base font-bold text-white">⚙️ Pengaturan</h2>
                        <p className="text-xs text-gray-500 mt-0.5">Semua konfigurasi bot dalam satu tempat</p>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center">×</button>
                </div>

                {/* Tab bar */}
                <div className="flex gap-1 px-4 pt-3 pb-0 flex-shrink-0">
                    {TABS.map(t => (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            className={`flex-1 flex flex-col items-center py-2 rounded-xl text-xs font-medium transition-all
                                ${tab === t.id ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                        >
                            <span className="text-base leading-none mb-0.5">{t.icon}</span>
                            <span className="text-[10px]">{t.label}</span>
                        </button>
                    ))}
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
                    {tab === 'trading' && <TabTrading />}
                    {tab === 'ai'      && <TabAI />}
                    {tab === 'risk'    && <TabRisk />}
                    {tab === 'keys'    && <TabKeys />}
                </div>

                {/* Footer */}
                <div className="flex-shrink-0 border-t border-gray-800 px-4 py-3 space-y-2">
                    {saveState === 'saved' && (
                        <p className="text-xs text-green-400 text-center">✅ {saveMsg}</p>
                    )}
                    {saveState === 'error' && (
                        <p className="text-xs text-red-400 text-center">❌ {saveMsg}</p>
                    )}
                    <div className="flex gap-2">
                        <button onClick={onClose}
                            className="flex-1 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition-colors">
                            Tutup
                        </button>
                        <button onClick={handleSave} disabled={saveState === 'saving'}
                            className="flex-2 flex-grow-[2] py-3 rounded-xl bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                            {saveState === 'saving' ? (
                                <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                                </svg>Menyimpan...</>
                            ) : '💾 Simpan'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
