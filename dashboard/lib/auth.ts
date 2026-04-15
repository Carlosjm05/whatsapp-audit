const TOKEN_KEY = 'wa_audit_jwt';
const USER_KEY = 'wa_audit_user';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string, username?: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, token);
  if (username) window.localStorage.setItem(USER_KEY, username);
}

export function getUsername(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(USER_KEY);
}

export function logout() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  window.location.href = '/login';
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
