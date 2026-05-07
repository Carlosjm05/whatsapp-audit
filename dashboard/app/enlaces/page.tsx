'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, safeArray, ApiError } from '@/lib/api';
import { isAdmin } from '@/lib/auth';
import { formatDateTime, formatNumber } from '@/lib/format';
import PageHeader from '@/components/PageHeader';
import { ErrorState } from '@/components/LoadingState';
import { useToast } from '@/components/Toast';
import type { ShareTokenInfo, ShareTokenCreateResponse } from '@/types/api';
import {
  Link2,
  Plus,
  Copy,
  Trash2,
  ShieldOff,
  Check,
  AlertTriangle,
  Eye,
  Clock,
  ShieldCheck,
} from 'lucide-react';

interface ListResponse {
  items: ShareTokenInfo[];
}

function origin(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

function statusBadge(t: ShareTokenInfo): { label: string; cls: string } {
  if (t.revoked_at) return { label: 'Revocado', cls: 'bg-slate-200 text-slate-600' };
  if (t.expires_at && new Date(t.expires_at) <= new Date())
    return { label: 'Expirado', cls: 'bg-amber-100 text-amber-700' };
  return { label: 'Activo', cls: 'bg-emerald-100 text-emerald-700' };
}

export default function EnlacesPage() {
  const router = useRouter();
  const toast = useToast();
  const [tokens, setTokens] = useState<ShareTokenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);

  // Modal de creación
  const [showCreate, setShowCreate] = useState(false);
  const [label, setLabel] = useState('');
  const [expiresInDays, setExpiresInDays] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Modal de "se generó — copia ahora"
  const [justCreated, setJustCreated] = useState<ShareTokenCreateResponse | null>(null);
  const [copiedJustCreated, setCopiedJustCreated] = useState(false);

  // Gateo de admin: si no lo es, redirigir al overview.
  useEffect(() => {
    const ok = isAdmin();
    setAdmin(ok);
    if (!ok) {
      router.replace('/overview');
    }
  }, [router]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchApi<ListResponse>('/api/admin/share-tokens');
      setTokens(safeArray<ShareTokenInfo>(res.items));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        // El JWT del .env tiene rol 'admin' por default; un viewer
        // que llegue acá ve este mensaje.
        setError('No tienes permiso para gestionar enlaces. Necesitas rol de administrador.');
      } else {
        setError(err instanceof Error ? err.message : 'Error al cargar tokens');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (admin) {
      load();
    }
  }, [admin]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const expires = expiresInDays.trim() === '' ? null : Number(expiresInDays);
      const body: Record<string, unknown> = { label: label.trim() };
      if (expires != null && Number.isFinite(expires) && expires > 0) {
        body.expires_in_days = Math.round(expires);
      }
      const res = await fetchApi<ShareTokenCreateResponse>('/api/admin/share-tokens', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setJustCreated(res);
      setCopiedJustCreated(false);
      setShowCreate(false);
      setLabel('');
      setExpiresInDays('');
      // Recargar lista (sin el plaintext, claro)
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'No se pudo crear el enlace');
    } finally {
      setCreating(false);
    }
  }

  async function onRevoke(t: ShareTokenInfo) {
    if (!confirm(`¿Revocar el enlace "${t.label}"? Quien tenga el link dejará de poder verlo.`))
      return;
    try {
      await fetchApi(`/api/admin/share-tokens/${t.id}/revoke`, { method: 'POST' });
      toast.success('Enlace revocado');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al revocar');
    }
  }

  async function onDelete(t: ShareTokenInfo) {
    if (
      !confirm(
        `¿Eliminar definitivamente "${t.label}"? Se pierde el rastro de auditoría. Para deshabilitar conservando el historial usa "Revocar".`,
      )
    )
      return;
    try {
      await fetchApi(`/api/admin/share-tokens/${t.id}`, { method: 'DELETE' });
      toast.success('Enlace eliminado');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar');
    }
  }

  async function copyToClipboard(text: string, onCopy?: () => void) {
    // En sitios HTTP (sin TLS) la API moderna `navigator.clipboard` está
    // bloqueada por el navegador — el panel se sirve por IP sin SSL, así
    // que necesitamos un fallback con el API legacy.
    let ok = false;
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof window !== 'undefined' &&
        window.isSecureContext
      ) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      // Fallback: textarea oculto + execCommand('copy'). Funciona en HTTP.
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      toast.success('Copiado al portapapeles');
      onCopy?.();
    } else {
      toast.error('No se pudo copiar. Selecciona el texto manualmente.');
    }
  }

  if (!admin) {
    return null; // redirigiendo
  }

  return (
    <div>
      <PageHeader
        title="Enlaces compartibles"
        subtitle="Gestiona los links del informe público (`/reporte`) que se comparten con el cliente. Sin login, solo lectura, datos agregados y anónimos."
      />

      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 flex items-start gap-3 max-w-3xl">
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            Los tokens se guardan <strong>hasheados</strong>. El enlace
            completo solo se muestra una vez, en el momento de generarlo.
            Si lo pierdes tienes que generar otro y revocar el anterior.
          </div>
        </div>
        <button
          onClick={() => {
            setShowCreate(true);
            setCreateError(null);
          }}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition"
        >
          <Plus className="w-4 h-4" />
          Generar nuevo enlace
        </button>
      </div>

      {loading && <div className="skeleton h-40" />}
      {error && <ErrorState message={error} />}

      {!loading && !error && (
        <div className="card overflow-hidden">
          {tokens.length === 0 ? (
            <div className="p-10 text-center">
              <Link2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-600">
                Todavía no hay enlaces generados.
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Haz clic en <strong>Generar nuevo enlace</strong> para crear el primero.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left">Etiqueta</th>
                    <th className="px-4 py-2 text-left">Estado</th>
                    <th className="px-4 py-2 text-left">Creado por</th>
                    <th className="px-4 py-2 text-left">Creado</th>
                    <th className="px-4 py-2 text-left">Expira</th>
                    <th className="px-4 py-2 text-left">Último uso</th>
                    <th className="px-4 py-2 text-right">Vistas</th>
                    <th className="px-4 py-2 text-left">ID</th>
                    <th className="px-4 py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tokens.map((t) => {
                    const st = statusBadge(t);
                    return (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">
                          {t.label}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${st.cls}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{t.created_by}</td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                          {formatDateTime(t.created_at)}
                        </td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                          {t.expires_at ? formatDateTime(t.expires_at) : 'Nunca'}
                        </td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                          {t.last_used_at ? (
                            <span className="inline-flex items-center gap-1">
                              <Eye className="w-3 h-3 text-slate-400" />
                              {formatDateTime(t.last_used_at)}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">sin abrir</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatNumber(t.use_count)}
                        </td>
                        <td className="px-4 py-3">
                          <code className="text-xs text-slate-500">{t.fingerprint}…</code>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {!t.revoked_at && (
                            <button
                              onClick={() => onRevoke(t)}
                              className="inline-flex items-center gap-1 text-amber-700 hover:text-amber-900 text-xs font-medium mr-3"
                              title="Revocar (queda en histórico)"
                            >
                              <ShieldOff className="w-3.5 h-3.5" />
                              Revocar
                            </button>
                          )}
                          <button
                            onClick={() => onDelete(t)}
                            className="inline-flex items-center gap-1 text-rose-700 hover:text-rose-900 text-xs font-medium"
                            title="Eliminar definitivamente"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Eliminar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Modal: crear nuevo enlace ────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-1">
              Generar nuevo enlace compartible
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              Crea una URL única para el informe público. Se mostrará solo una vez.
            </p>
            <form onSubmit={onCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 uppercase mb-1">
                  Etiqueta <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  required
                  maxLength={255}
                  placeholder="Ej. Para Oscar — reunión junio"
                  className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Solo para identificarlo en esta lista. No aparece en el enlace.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 uppercase mb-1">
                  Caduca a los (días)
                </label>
                <input
                  type="number"
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(e.target.value)}
                  min={1}
                  max={3650}
                  placeholder="Vacío = no caduca"
                  className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Recomendado: 30–90 días. Puedes revocarlo antes en cualquier momento.
                </p>
              </div>

              {createError && (
                <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                  {createError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-sm rounded-md text-slate-600 hover:bg-slate-100"
                  disabled={creating}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating || !label.trim()}
                  className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? 'Generando…' : 'Generar enlace'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: enlace recién creado ──────────────────────── */}
      {justCreated && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6">
            <div className="flex items-center gap-2 text-emerald-700 mb-2">
              <Check className="w-5 h-5" />
              <h2 className="text-lg font-semibold">Enlace generado</h2>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              Esta es la <strong>única vez</strong> que verás la URL completa.
              Cópiala ahora y envíala al cliente.
            </p>

            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 mb-4 flex items-start gap-2 text-xs text-amber-900">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                Si cierras sin copiarla, el enlace queda activo pero no podrás
                recuperarla. En ese caso revoca este token y genera otro.
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 uppercase mb-1">
                  URL completa
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={`${origin()}${justCreated.url_path}`}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 text-xs border border-slate-300 rounded-md px-3 py-2 font-mono bg-slate-50"
                  />
                  <button
                    onClick={() =>
                      copyToClipboard(`${origin()}${justCreated.url_path}`, () =>
                        setCopiedJustCreated(true),
                      )
                    }
                    className="inline-flex items-center gap-1 text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium px-3 py-2 rounded-md"
                  >
                    {copiedJustCreated ? (
                      <>
                        <Check className="w-4 h-4" /> Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" /> Copiar
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs text-slate-600 pt-2 border-t border-slate-100">
                <div>
                  <div className="text-slate-500 uppercase">Etiqueta</div>
                  <div className="font-medium text-slate-800">{justCreated.label}</div>
                </div>
                <div>
                  <div className="text-slate-500 uppercase">Caduca</div>
                  <div className="font-medium text-slate-800">
                    {justCreated.expires_at ? formatDateTime(justCreated.expires_at) : 'Nunca'}
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 flex items-start gap-2">
                <Clock className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
                <div>
                  Tip: prueba el enlace tú primero abriéndolo en otra pestaña antes
                  de enviárselo al cliente. Si carga el informe, está todo bien.
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-5">
              <button
                onClick={() => {
                  setJustCreated(null);
                  setCopiedJustCreated(false);
                }}
                className="px-4 py-2 text-sm rounded-md bg-slate-800 text-white hover:bg-slate-900"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
