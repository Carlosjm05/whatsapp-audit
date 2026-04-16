'use client';

import { useState, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, ApiError } from '@/lib/api';
import { setToken, getToken } from '@/lib/auth';
import type { LoginResponse } from '@/types/api';
import { Building, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (getToken()) router.replace('/overview');
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetchApi<LoginResponse>('/auth/login', {
        method: 'POST',
        skipAuth: true,
        body: JSON.stringify({ username, password })
      });
      if (!res.access_token) throw new ApiError('Respuesta inválida', 500);
      setToken(res.access_token, username);
      router.replace('/overview');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.status === 401 || err.status === 400
            ? 'Credenciales incorrectas'
            : err.message
          : 'Error inesperado';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-brand-900 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex w-14 h-14 rounded-xl bg-brand-600 items-center justify-center mb-4">
            <Building className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-white">Ortiz Finca Raíz</h1>
          <p className="text-sm text-slate-300 mt-1">
            Panel de auditoría conversacional
          </p>
        </div>
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-1">Iniciar sesión</h2>
          <p className="text-xs text-slate-500 mb-5">
            Acceso restringido al equipo de gerencia.
          </p>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-username" className="label">Usuario</label>
              <input
                id="login-username"
                autoFocus
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label htmlFor="login-password" className="label">Contraseña</label>
              <input
                id="login-password"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {error && (
              <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Ingresando…' : 'Ingresar'}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-slate-400 mt-6">
          © {new Date().getFullYear()} Ortiz Finca Raíz — Uso interno
        </p>
      </div>
    </div>
  );
}
