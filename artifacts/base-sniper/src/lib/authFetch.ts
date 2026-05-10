/**
 * authFetch.ts — singleton auth token + authenticated fetch wrapper.
 *
 * After login, LoginGate calls setAuthToken(token) once.
 * Token is persisted in sessionStorage so the user doesn't need to
 * re-login on every page refresh (survives tab refresh, cleared on tab close).
 * Every other component uses authFetch() instead of raw fetch() so the
 * X-Session-Token header is automatically included on all API requests.
 */

const SESSION_KEY = 'base_sniper_token';

// Restore token from sessionStorage on module load
let _token = (() => {
    try { return sessionStorage.getItem(SESSION_KEY) || ''; }
    catch { return ''; }
})();

export function setAuthToken(token: string): void {
    _token = token;
    try {
        if (token) {
            sessionStorage.setItem(SESSION_KEY, token);
        } else {
            sessionStorage.removeItem(SESSION_KEY);
        }
    } catch { /* silent — storage might be unavailable */ }
}

export function getAuthToken(): string {
    return _token;
}

export function clearAuthToken(): void {
    setAuthToken('');
}

export function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
    return fetch(url, {
        ...options,
        headers: {
            ...options.headers,
            ...(_token ? { 'X-Session-Token': _token } : {})
        }
    });
}
