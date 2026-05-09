import React, { useState, useEffect } from 'react';

interface KeyStatus {
    privateKey:     boolean;
    groqKey:        boolean;
    geminiKey:      boolean;
    huggingfaceKey: boolean;
    appPassword:    boolean;
    telegramToken:  boolean;
    telegramChatId: boolean;
}

interface WalletConfigModalProps {
    apiUrl:  string;
    onClose: () => void;
}

interface FieldState {
    value: string;
    show:  boolean;
}

const EMPTY: FieldState = { value: '', show: false };

const WalletConfigModal: React.FC<WalletConfigModalProps> = ({ apiUrl, onClose }) => {
    const [keyStatus,    setKeyStatus]   = useState<KeyStatus | null>(null);
    const [saveStatus,   setSaveStatus]  = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [errorMsg,     setErrorMsg]    = useState('');
    const [tgTestStatus, setTgTestStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
    const [tgTestError,  setTgTestError]  = useState('');

    const [privateKey,      setPrivateKey]      = useState<FieldState>(EMPTY);
    const [groqKey,         setGroqKey]         = useState<FieldState>(EMPTY);
    const [geminiKey,       setGeminiKey]       = useState<FieldState>(EMPTY);
    const [huggingfaceKey,  setHuggingfaceKey]  = useState<FieldState>(EMPTY);
    const [appPassword,     setAppPassword]     = useState<FieldState>(EMPTY);
    const [telegramToken,   setTelegramToken]   = useState<FieldState>(EMPTY);
    const [telegramChatId,  setTelegramChatId]  = useState<FieldState>(EMPTY);

    useEffect(() => {
        fetch(`${apiUrl}/api/keys`)
            .then(r => r.json())
            .then(setKeyStatus)
            .catch(() => {});
    }, [apiUrl]);

    const toggle = (setter: React.Dispatch<React.SetStateAction<FieldState>>) =>
        setter(prev => ({ ...prev, show: !prev.show }));

    const handleSave = async () => {
        setSaveStatus('saving');
        setErrorMsg('');

        const payload: Record<string, string> = {};
        if (privateKey.value.trim())     payload.privateKey     = privateKey.value.trim();
        if (groqKey.value.trim())        payload.groqKey        = groqKey.value.trim();
        if (geminiKey.value.trim())      payload.geminiKey      = geminiKey.value.trim();
        if (huggingfaceKey.value.trim()) payload.huggingfaceKey = huggingfaceKey.value.trim();
        if (appPassword.value.trim())    payload.appPassword    = appPassword.value.trim();
        if (telegramToken.value.trim())  payload.telegramToken  = telegramToken.value.trim();
        if (telegramChatId.value.trim()) payload.telegramChatId = telegramChatId.value.trim();

        if (Object.keys(payload).length === 0) {
            setSaveStatus('idle');
            return;
        }

        try {
            const res = await fetch(`${apiUrl}/api/keys`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Server error');

            setSaveStatus('saved');
            setPrivateKey(EMPTY);
            setGroqKey(EMPTY);
            setGeminiKey(EMPTY);
            setHuggingfaceKey(EMPTY);
            setAppPassword(EMPTY);
            setTelegramToken(EMPTY);
            setTelegramChatId(EMPTY);

            const updated = await fetch(`${apiUrl}/api/keys`).then(r => r.json());
            setKeyStatus(updated);
            setTimeout(() => setSaveStatus('idle'), 2500);
        } catch (err: any) {
            setErrorMsg(err.message);
            setSaveStatus('error');
            setTimeout(() => setSaveStatus('idle'), 3000);
        }
    };

    const StatusBadge: React.FC<{ set: boolean }> = ({ set }) => (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${set
            ? 'bg-green-900/50 text-green-400 border border-green-700'
            : 'bg-red-900/30 text-red-400 border border-red-800'}`}>
            {set ? '✓ Terkonfigurasi' : '✗ Belum diset'}
        </span>
    );

    const KeyField: React.FC<{
        label:       string;
        hint:        string;
        placeholder: string;
        state:       FieldState;
        setState:    React.Dispatch<React.SetStateAction<FieldState>>;
        isSet?:      boolean;
        mono?:       boolean;
    }> = ({ label, hint, placeholder, state, setState, isSet, mono = true }) => (
        <div>
            <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-gray-300 font-medium">{label}</label>
                {isSet !== undefined && <StatusBadge set={isSet} />}
            </div>
            <div className="relative">
                <input
                    type={state.show ? 'text' : 'password'}
                    value={state.value}
                    onChange={e => setState(prev => ({ ...prev, value: e.target.value }))}
                    placeholder={placeholder}
                    className={`w-full bg-gray-900 border border-gray-700 focus:border-green-500 rounded-xl px-4 py-2.5 pr-12 text-white placeholder-gray-600 text-sm focus:outline-none transition-colors ${mono ? 'font-mono' : ''}`}
                />
                <button
                    type="button"
                    onClick={() => toggle(setState)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors text-base"
                >
                    {state.show ? '🙈' : '👁️'}
                </button>
            </div>
            <p className="text-xs text-gray-600 mt-1">{hint}</p>
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">

                {/* Header */}
                <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-2xl">
                    <div>
                        <h2 className="text-lg font-bold text-white">🔑 Konfigurasi Wallet & API</h2>
                        <p className="text-xs text-gray-500 mt-0.5">Kunci disimpan di server, aman dari browser</p>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none transition-colors">&times;</button>
                </div>

                <div className="p-6 space-y-6">

                    {/* Security notice */}
                    <div className="bg-blue-900/20 border border-blue-800/50 rounded-xl p-4 flex gap-3">
                        <span className="text-xl">🛡️</span>
                        <p className="text-xs text-blue-300 leading-relaxed">
                            Kunci disimpan di file <code className="bg-blue-900/40 px-1 rounded">.env</code> di server dan tidak pernah dikirim ke browser. Kosongkan field jika tidak ingin mengubah nilai yang sudah ada.
                        </p>
                    </div>

                    {/* Wallet */}
                    <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-5 space-y-4">
                        <h3 className="text-sm font-semibold text-gray-200">💼 Wallet Trading</h3>
                        <KeyField
                            label="Private Key"
                            hint="Private key wallet Base Network kamu (diawali 0x...)"
                            placeholder="0x..."
                            state={privateKey}
                            setState={setPrivateKey}
                            isSet={keyStatus?.privateKey}
                        />
                        {privateKey.value && !privateKey.value.startsWith('0x') && (
                            <p className="text-xs text-yellow-400">⚠️ Private key harus diawali dengan 0x</p>
                        )}
                    </div>

                    {/* AI Keys */}
                    <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-5 space-y-4">
                        <h3 className="text-sm font-semibold text-gray-200">🤖 AI Provider Keys</h3>
                        <KeyField
                            label="Groq API Key (Primary)"
                            hint="Dapatkan di console.groq.com — gratis, ~88ms latency"
                            placeholder="gsk_..."
                            state={groqKey}
                            setState={setGroqKey}
                            isSet={keyStatus?.groqKey}
                        />
                        <KeyField
                            label="Gemini API Key"
                            hint="Dapatkan di aistudio.google.com — 1M context window"
                            placeholder="AIza..."
                            state={geminiKey}
                            setState={setGeminiKey}
                            isSet={keyStatus?.geminiKey}
                        />
                        <KeyField
                            label="HuggingFace API Key (Fallback)"
                            hint="Dapatkan di huggingface.co/settings/tokens"
                            placeholder="hf_..."
                            state={huggingfaceKey}
                            setState={setHuggingfaceKey}
                            isSet={keyStatus?.huggingfaceKey}
                        />
                    </div>

                    {/* Telegram */}
                    <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <h3 className="text-sm font-semibold text-gray-200">📱 Notifikasi Telegram</h3>
                                {keyStatus?.telegramToken && keyStatus?.telegramChatId && (
                                    <span className="text-xs bg-green-900/40 text-green-400 border border-green-700 px-2 py-0.5 rounded-full">Aktif</span>
                                )}
                            </div>
                            {keyStatus?.telegramToken && keyStatus?.telegramChatId && (
                                <button
                                    onClick={async () => {
                                        setTgTestStatus('sending');
                                        setTgTestError('');
                                        try {
                                            const res = await fetch(`${apiUrl}/api/telegram/test`, { method: 'POST' });
                                            const data = await res.json();
                                            if (data.ok) {
                                                setTgTestStatus('ok');
                                                setTimeout(() => setTgTestStatus('idle'), 4000);
                                            } else {
                                                setTgTestStatus('error');
                                                setTgTestError(data.error || 'Gagal');
                                            }
                                        } catch {
                                            setTgTestStatus('error');
                                            setTgTestError('Tidak bisa hubungi server');
                                        }
                                    }}
                                    disabled={tgTestStatus === 'sending'}
                                    className="text-xs px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/40 border border-blue-600/40 text-blue-400 disabled:opacity-50 transition-colors"
                                >
                                    {tgTestStatus === 'sending' ? '⏳ Mengirim...' : tgTestStatus === 'ok' ? '✅ Terkirim!' : '📤 Test'}
                                </button>
                            )}
                        </div>
                        {tgTestStatus === 'error' && (
                            <p className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
                                ❌ {tgTestError}
                            </p>
                        )}
                        <div className="bg-gray-900/60 rounded-lg p-3 text-xs text-gray-400 space-y-1">
                            <p className="font-medium text-gray-300 mb-1">Cara setup:</p>
                            <p>1. Buka <span className="text-blue-400">@BotFather</span> di Telegram → <code>/newbot</code></p>
                            <p>2. Salin Bot Token yang diberikan</p>
                            <p>3. Chat bot kamu, lalu buka <span className="text-blue-400">@userinfobot</span> untuk dapat Chat ID</p>
                        </div>
                        <div className="bg-gray-900/40 rounded-lg p-3 text-xs text-gray-500 space-y-0.5">
                            <p className="text-gray-400 font-medium mb-1">Notifikasi yang dikirim ke HP kamu:</p>
                            <p>✅ BUY berhasil · ❌ BUY gagal</p>
                            <p>🎯 Take Profit TP1 & TP2</p>
                            <p>🛑 Stop Loss · 🚨 Emergency Exit (rug)</p>
                            <p>⏰ Timeout Exit · 📊 Ringkasan 30 menit</p>
                        </div>
                        <KeyField
                            label="Bot Token"
                            hint="Format: 123456789:ABC-DEF... dari @BotFather"
                            placeholder="123456789:ABC-DEF..."
                            state={telegramToken}
                            setState={setTelegramToken}
                            isSet={keyStatus?.telegramToken}
                        />
                        <KeyField
                            label="Chat ID"
                            hint="ID chat / user kamu (angka, bisa negatif untuk grup)"
                            placeholder="-1001234567890 atau 123456789"
                            state={telegramChatId}
                            setState={setTelegramChatId}
                            isSet={keyStatus?.telegramChatId}
                            mono={false}
                        />
                    </div>

                    {/* App Password */}
                    <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-5 space-y-4">
                        <h3 className="text-sm font-semibold text-gray-200">🔐 Keamanan Dashboard</h3>
                        <KeyField
                            label="Password Dashboard"
                            hint="Password yang digunakan untuk login ke dashboard ini"
                            placeholder="Password baru..."
                            state={appPassword}
                            setState={setAppPassword}
                            isSet={keyStatus?.appPassword}
                            mono={false}
                        />
                    </div>

                    {/* Feedback */}
                    {saveStatus === 'saved' && (
                        <div className="bg-green-900/30 border border-green-700 rounded-xl px-4 py-3 text-sm text-green-400 text-center">
                            ✅ Konfigurasi berhasil disimpan & diterapkan
                        </div>
                    )}
                    {saveStatus === 'error' && (
                        <div className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-3 text-sm text-red-400 text-center">
                            ❌ {errorMsg || 'Gagal menyimpan — coba lagi'}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="sticky bottom-0 bg-gray-900 border-t border-gray-800 px-6 py-4 flex gap-3 rounded-b-2xl">
                    <button
                        onClick={onClose}
                        className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white py-2.5 rounded-xl text-sm font-medium transition-all"
                    >
                        Batal
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saveStatus === 'saving'}
                        className="flex-1 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed text-white py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
                    >
                        {saveStatus === 'saving' ? (
                            <>
                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                                </svg>
                                Menyimpan...
                            </>
                        ) : '💾 Simpan Konfigurasi'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WalletConfigModal;
