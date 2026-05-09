/**
 * authFetch.ts — singleton auth token + authenticated fetch wrapper.
 *
 * After login, LoginGate calls setAuthToken(token) once.
 * Every other component uses authFetch() instead of raw fetch() so the
 * X-Session-Token header is automatically included on all API requests.
 */

let _token = '';

export function setAuthToken(token: string): void {
    _token = token;
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
