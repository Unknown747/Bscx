import React, { useState, useEffect } from 'react';
import { setAuthToken, getAuthToken } from '../lib/authFetch';

interface LoginGateProps {
    apiUrl: string;
    children: React.ReactNode;
}

const LoginGate: React.FC<LoginGateProps> = ({ apiUrl, children }) => {
    // If a token is already stored in sessionStorage, start unlocked and verify it
    const [unlocked, setUnlocked] = useState(false);
    const [verifying, setVerifying] = useState(true); // true while checking stored token
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [attempts, setAttempts] = useState(0);
    const [blocked, setBlocked] = useState(false);
    const [blockTimer, setBlockTimer] = useState(0);

    // On mount: verify stored session token against server
    useEffect(() => {
        const storedToken = getAuthToken();
        if (!storedToken) { setVerifying(false); return; }
        // Quick verify — if the token is still valid the server will return 200
        fetch(`${apiUrl}/api/status`, {
            headers: { 'X-Session-Token': storedToken }
        }).then((res) => {
            if (res.ok) {
                setUnlocked(true);
            } else {
                // Token expired — clear it and show login
                setAuthToken('');
            }
        }).catch(() => {
            // Server unreachable — clear token, show login
            setAuthToken('');
        }).finally(() => setVerifying(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Block after 5 wrong attempts for 30 seconds
    useEffect(() => {
        if (attempts >= 5) {
            setBlocked(true);
            setBlockTimer(30);
            const interval = setInterval(() => {
                setBlockTimer((t) => {
                    if (t <= 1) {
                        clearInterval(interval);
                        setBlocked(false);
                        setAttempts(0);
                        return 0;
                    }
                    return t - 1;
                });
            }, 1000);
        }
    }, [attempts]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (blocked || loading || !password) return;

        setLoading(true);
        setError('');

        try {
            const res = await fetch(`${apiUrl}/api/auth/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            const data = await res.json();

            if (data.ok) {
                setAuthToken(data.token || '');
                setUnlocked(true);
            } else {
                setAttempts((a) => a + 1);
                setError(data.error || 'Password salah');
                setPassword('');
            }
        } catch {
            setError('Tidak bisa terhubung ke server. Pastikan bot sedang berjalan.');
        } finally {
            setLoading(false);
        }
    };

    if (unlocked) {
        return <>{children}</>;
    }

    // While verifying stored token, show a minimal spinner
    if (verifying) {
        return (
            <div className="min-h-screen bg-gray-950 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <div className="text-4xl">🔥</div>
                    <svg className="animate-spin h-6 w-6 text-green-500" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    <p className="text-gray-500 text-sm">Menghubungkan...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
            <div className="w-full max-w-sm">

                {/* Logo / Title */}
                <div className="text-center mb-8">
                    <div className="text-5xl mb-3">🔥</div>
                    <h1 className="text-2xl font-bold text-white">Base Sniper</h1>
                    <p className="text-gray-500 text-sm mt-1">Masukkan password untuk melanjutkan</p>
                </div>

                {/* Card */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
                    <form onSubmit={handleLogin} className="space-y-4">

                        <div>
                            <label className="block text-sm text-gray-400 mb-1">Password</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => {
                                    setPassword(e.target.value);
                                    setError('');
                                }}
                                placeholder="Masukkan password..."
                                disabled={blocked || loading}
                                autoFocus
                                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-green-500 transition-colors disabled:opacity-50"
                            />
                        </div>

                        {/* Error message */}
                        {error && (
                            <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-2 text-sm text-red-400">
                                {error}
                            </div>
                        )}

                        {/* Blocked message */}
                        {blocked && (
                            <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg px-4 py-2 text-sm text-yellow-400 text-center">
                                Terlalu banyak percobaan. Coba lagi dalam{' '}
                                <span className="font-bold">{blockTimer}s</span>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={blocked || loading || !password}
                            className="w-full bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all"
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                                    </svg>
                                    Memverifikasi...
                                </span>
                            ) : (
                                '🔓 Masuk'
                            )}
                        </button>
                    </form>
                </div>

                {/* Attempt counter */}
                {attempts > 0 && !blocked && (
                    <p className="text-center text-xs text-gray-600 mt-4">
                        Percobaan gagal: {attempts}/5
                    </p>
                )}

                <p className="text-center text-xs text-gray-700 mt-6">
                    Password diatur melalui APP_PASSWORD di server
                </p>
            </div>
        </div>
    );
};

export default LoginGate;
