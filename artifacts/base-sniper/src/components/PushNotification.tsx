import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../lib/authFetch';

interface Props {
    apiUrl: string;
}

type PushState = 'unsupported' | 'checking' | 'denied' | 'subscribed' | 'unsubscribed' | 'loading';

const SW_PATH = '/sw.js';

async function registerSW(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) return null;
    try {
        const reg = await navigator.serviceWorker.register(SW_PATH);
        await navigator.serviceWorker.ready;
        return reg;
    } catch {
        return null;
    }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw     = window.atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const PushNotification: React.FC<Props> = ({ apiUrl }) => {
    const [state, setState] = useState<PushState>('checking');
    const [error, setError] = useState('');

    const checkStatus = useCallback(async () => {
        if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
            setState('unsupported');
            return;
        }
        if (Notification.permission === 'denied') {
            setState('denied');
            return;
        }
        try {
            const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
            if (!reg) { setState('unsubscribed'); return; }
            const sub = await reg.pushManager.getSubscription();
            setState(sub ? 'subscribed' : 'unsubscribed');
        } catch {
            setState('unsubscribed');
        }
    }, []);

    useEffect(() => { checkStatus(); }, [checkStatus]);

    const subscribe = useCallback(async () => {
        setState('loading');
        setError('');
        try {
            // Get public VAPID key
            const keyRes = await authFetch(`${apiUrl}/api/push/vapid-key`);
            const { publicKey } = await keyRes.json();

            // Request notification permission
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                setState('denied');
                return;
            }

            // Register service worker & subscribe
            const reg = await registerSW();
            if (!reg) throw new Error('Service Worker gagal terdaftar');

            const sub = await reg.pushManager.subscribe({
                userVisibleOnly:      true,
                applicationServerKey: urlBase64ToUint8Array(publicKey),
            });

            // Send subscription to server
            const saveRes = await authFetch(`${apiUrl}/api/push/subscribe`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(sub.toJSON()),
            });
            if (!saveRes.ok) throw new Error('Gagal menyimpan subscription di server');

            setState('subscribed');
        } catch (e: any) {
            setError(e.message || 'Gagal aktifkan notifikasi');
            setState('unsubscribed');
        }
    }, [apiUrl]);

    const unsubscribe = useCallback(async () => {
        setState('loading');
        setError('');
        try {
            const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
            if (reg) {
                const sub = await reg.pushManager.getSubscription();
                if (sub) {
                    // Notify server first
                    await authFetch(`${apiUrl}/api/push/unsubscribe`, {
                        method:  'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ endpoint: sub.endpoint }),
                    }).catch(() => {});
                    await sub.unsubscribe();
                }
            }
            setState('unsubscribed');
        } catch (e: any) {
            setError(e.message || 'Gagal nonaktifkan notifikasi');
            setState('subscribed');
        }
    }, [apiUrl]);

    if (state === 'unsupported') return null;

    const isLoading = state === 'loading' || state === 'checking';

    return (
        <div className="relative">
            <button
                onClick={state === 'subscribed' ? unsubscribe : subscribe}
                disabled={isLoading || state === 'denied'}
                title={
                    state === 'subscribed'  ? 'Klik untuk matikan notifikasi push'    :
                    state === 'denied'      ? 'Izin notifikasi ditolak di browser'    :
                    state === 'unsubscribed'? 'Klik untuk aktifkan notifikasi push'   : 'Memuat...'
                }
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all border
                    ${state === 'subscribed'
                        ? 'bg-purple-900/60 border-purple-700 text-purple-300 hover:bg-purple-900 hover:text-white'
                        : state === 'denied'
                        ? 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed'
                        : 'bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300 hover:text-white'
                    }`}
            >
                {isLoading ? (
                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                ) : (
                    <span>{state === 'subscribed' ? '🔔' : state === 'denied' ? '🔕' : '🔕'}</span>
                )}
                <span className="hidden sm:inline">
                    {state === 'subscribed'   ? 'Notif ON'  :
                     state === 'denied'       ? 'Diblokir'  :
                     state === 'unsubscribed' ? 'Notif OFF' : '...'}
                </span>
            </button>
            {error && (
                <div className="absolute top-full right-0 mt-1 z-50 bg-red-900 border border-red-700 rounded-lg px-3 py-2 text-xs text-red-300 whitespace-nowrap shadow-lg">
                    {error}
                </div>
            )}
        </div>
    );
};

export default PushNotification;
