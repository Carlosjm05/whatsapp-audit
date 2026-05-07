const TOKEN_KEY = 'wa_audit_jwt';
const USER_KEY = 'wa_audit_user';
const ROLE_KEY = 'wa_audit_role';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string, username?: string, role?: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, token);
  if (username) window.localStorage.setItem(USER_KEY, username);
  if (role) window.localStorage.setItem(ROLE_KEY, role);
}

export function getUsername(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(USER_KEY);
}

export function getRole(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ROLE_KEY);
}

export function isAdmin(): boolean {
  return getRole() === 'admin';
}

export function logout() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  window.localStorage.removeItem(ROLE_KEY);
  window.location.href = '/login';
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
