import { getToken, logout } from './auth';

// La API puede devolver null, undefined o un tipo inesperado para
// campos que el dashboard espera como array. Garantiza siempre [].
export function safeArray<T>(val: unknown): T[] {
  return Array.isArray(val) ? val : [];
}

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

// Guard contra múltiples llamadas a logout() simultáneas. Sidebar +
// StatusIndicator + ConexionPage pueden pollear en paralelo y disparar
// 401 al mismo tiempo cuando expira el JWT. Sin este guard el browser
// hace múltiples redirects y borra el token en race.
let _logoutInFlight = false;

function _handle401() {
  if (_logoutInFlight) return;
  if (typeof window === 'undefined') return;
  _logoutInFlight = true;
  // logout() llama router.replace('/login') — pequeño delay para que las
  // promises pendientes resuelvan/rechacen sin generar warnings de setState
  // sobre componentes desmontados.
  setTimeout(() => {
    try { logout(); } finally { _logoutInFlight = false; }
  }, 0);
}

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
    _handle401();
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
