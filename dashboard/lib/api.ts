import { getToken, logout } from './auth';

// Vacío por defecto = URLs relativas. En producción nginx enruta
// /api/* y /auth/* al backend. Solo se necesita NEXT_PUBLIC_API_URL
// en desarrollo local sin nginx (e.g. "http://localhost:8000").
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || '';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type FetchOpts = RequestInit & { skipAuth?: boolean };

export async function fetchApi<T = unknown>(
  path: string,
  opts: FetchOpts = {}
): Promise<T> {
  const { skipAuth, headers, ...rest } = opts;
  const token = skipAuth ? null : getToken();
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string> | undefined)
  };
  if (token) h['Authorization'] = `Bearer ${token}`;

  const url = path.startsWith('http') ? path : `${API_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers: h, cache: 'no-store' });
  } catch (err) {
    throw new ApiError('No se pudo conectar con la API', 0);
  }

  if (res.status === 401 && !skipAuth) {
    if (typeof window !== 'undefined') logout();
    throw new ApiError('Sesión expirada', 401);
  }
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const body = await res.json();
      msg = body.detail || body.message || msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status);
  }
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export async function fetchBlob(path: string): Promise<Blob> {
  const token = getToken();
  const h: Record<string, string> = {};
  if (token) h['Authorization'] = `Bearer ${token}`;
  const url = path.startsWith('http') ? path : `${API_URL}${path}`;
  const res = await fetch(url, { headers: h });
  if (res.status === 401) {
    logout();
    throw new ApiError('Sesión expirada', 401);
  }
  if (!res.ok) throw new ApiError(`Error ${res.status}`, res.status);
  return res.blob();
}

export async function downloadFile(path: string, filename: string) {
  const blob = await fetchBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
