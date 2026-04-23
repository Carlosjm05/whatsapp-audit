'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import PageHeader from '@/components/PageHeader';
import {
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Link2,
  Copy,
  Trash2,
  RefreshCw,
  XCircle,
} from 'lucide-react';

type QRStatus = {
  status: string;
  qr_data_url: string | null;
  qr_emitted_at: string | null;
  connected_at: string | null;
  last_activity: string | null;
  status_changed_at: string | null;
  stats: Record<string, unknown> | null;
};

type ShareToken = {
  token: string;
  note: string | null;
  created_by: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  is_active: boolean;
  public_url_path: string;
};

const POLL_MS = 3000;

const STATUS_LABEL: Record<string, { label: string; tone: 'green' | 'yellow' | 'red' | 'blue' }> = {
  connected:    { label: 'Conectado',          tone: 'green' },
  qr_ready:     { label: 'QR listo para escanear', tone: 'blue' },
  connecting:   { label: 'Conectando…',        tone: 'yellow' },
  reconnecting: { label: 'Reconectando…',      tone: 'yellow' },
  disconnected: { label: 'Desconectado',       tone: 'red' },
  unknown:      { label: 'Sin datos',          tone: 'red' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_LABEL[status] || STATUS_LABEL.unknown;
  const map = {
    green: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
    yellow: 'bg-amber-100 text-amber-800 ring-amber-200',
    red: 'bg-rose-100 text-rose-800 ring-rose-200',
    blue: 'bg-sky-100 text-sky-800 ring-sky-200',
  };
  const Icon = cfg.tone === 'green' ? CheckCircle2 :
               cfg.tone === 'red' ? XCircle :
               cfg.tone === 'yellow' ? Loader2 : Smartphone;
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ring-1 ring-inset ${map[cfg.tone]}`}>
      <Icon className={`w-4 h-4 ${cfg.tone === 'yellow' ? 'animate-spin' : ''}`} />
      {cfg.label}
    </span>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-CO', {
      hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short'
    });
  } catch {
    return iso;
  }
}

function diffSeconds(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

function humanSecs(s: number | null): string {
  if (s === null) return '—';
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

export default function ConexionPage() {
  const [data, setData] = useState<QRStatus | null>(null);
  const [tokens, setTokens] = useState<ShareToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState('');
  const [minutes, setMinutes] = useState(10);
  const [copied, setCopied] = useState<string | null>(null);

  // Poll status
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const res = await fetchApi<QRStatus>('/api/qr');
        if (!cancelled) setData(res);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const refreshTokens = async () => {
    setLoadingTokens(true);
    try {
      const res = await fetchApi<{ items: ShareToken[] }>('/api/qr/share?only_active=false');
      setTokens(res.items || []);
    } finally {
      setLoadingTokens(false);
    }
  };

  useEffect(() => { refreshTokens(); }, []);

  const createToken = async () => {
    setCreating(true);
    try {
      const res = await fetchApi<ShareToken>('/api/qr/share', {
        method: 'POST',
        body: JSON.stringify({ note: note.trim() || null, minutes }),
      });
      setTokens((prev) => [res, ...prev]);
      setNote('');
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : 'No se pudo'));
    } finally {
      setCreating(false);
    }
  };

  const revokeToken = async (token: string) => {
    if (!confirm('¿Revocar este link? El cliente ya no podrá usarlo.')) return;
    try {
      await fetchApi(`/api/qr/share/${token}/revoke`, { method: 'POST' });
      refreshTokens();
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : 'No se pudo'));
    }
  };

  const fullUrl = (path: string): string => {
    if (typeof window === 'undefined') return path;
    return `${window.location.origin}${path}`;
  };

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      alert('No se pudo copiar. Selecciona y copia a mano: ' + text);
    }
  };

  const status = data?.status || 'unknown';
  const showQR = status === 'qr_ready' && data?.qr_data_url;

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Conexión WhatsApp"
        subtitle="Estado del extractor en vivo, código QR y links temporales para que el cliente escanee."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* QR + Status */}
        <div className="card p-6 flex flex-col items-center text-center">
          <div className="w-full flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-slate-800">Estado actual</h3>
            <StatusBadge status={status} />
          </div>

          <div className="w-full aspect-square max-w-[320px] mx-auto rounded-xl bg-slate-50 ring-1 ring-slate-200 flex items-center justify-center overflow-hidden">
            {showQR ? (
              <img
                src={data!.qr_data_url!}
                alt="Código QR de WhatsApp"
                className="w-full h-full object-contain p-3"
              />
            ) : status === 'connected' ? (
              <div className="text-emerald-600 flex flex-col items-center gap-3 p-6">
                <CheckCircle2 className="w-16 h-16" />
                <div className="text-sm font-medium text-slate-800">WhatsApp conectado</div>
                {data?.connected_at && (
                  <div className="text-xs text-slate-500">
                    Desde {formatDateTime(data.connected_at)}
                  </div>
                )}
              </div>
            ) : status === 'connecting' || status === 'reconnecting' ? (
              <div className="flex flex-col items-center gap-3 p-6 text-slate-500">
                <Loader2 className="w-12 h-12 animate-spin text-amber-500" />
                <div className="text-sm">Esperando QR del extractor…</div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 p-6 text-slate-500">
                <AlertCircle className="w-12 h-12 text-rose-400" />
                <div className="text-sm font-medium text-slate-700">Extractor sin sesión</div>
                <div className="text-xs leading-relaxed max-w-[260px]">
                  Si necesitás escanear un nuevo QR: en el servidor borrá el volumen de
                  sesión y reiniciá el extractor.
                </div>
              </div>
            )}
          </div>

          <div className="w-full mt-5 grid grid-cols-2 gap-3 text-left text-xs">
            <div>
              <div className="text-slate-500">Última actividad</div>
              <div className="font-medium text-slate-800">{humanSecs(diffSeconds(data?.last_activity || null))}</div>
            </div>
            <div>
              <div className="text-slate-500">Cambio de estado</div>
              <div className="font-medium text-slate-800">{humanSecs(diffSeconds(data?.status_changed_at || null))}</div>
            </div>
          </div>

          {data?.stats && (
            <div className="w-full mt-5 pt-4 border-t border-slate-200 text-left">
              <div className="text-xs font-medium text-slate-700 mb-2">Progreso de extracción</div>
              <pre className="text-xs text-slate-600 whitespace-pre-wrap break-words bg-slate-50 rounded-md p-3 ring-1 ring-slate-200 max-h-40 overflow-auto">
                {JSON.stringify(data.stats, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Share token */}
        <div className="card p-6">
          <h3 className="text-base font-semibold text-slate-800 mb-1">Link público para el cliente</h3>
          <p className="text-xs text-slate-500 mb-4">
            Generá un link temporal y compartilo con el cliente para que escanee el QR sin loguearse.
            El link se invalida solo una vez escaneado o al expirar.
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-600 mb-1">Nota (opcional)</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Para Óscar — 23 abr"
                className="input text-sm w-full"
                maxLength={120}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Vida del link</label>
              <select
                value={minutes}
                onChange={(e) => setMinutes(parseInt(e.target.value, 10))}
                className="input text-sm w-full"
              >
                <option value={5}>5 minutos</option>
                <option value={10}>10 minutos</option>
                <option value={15}>15 minutos</option>
                <option value={30}>30 minutos</option>
                <option value={60}>60 minutos</option>
              </select>
            </div>
            <button
              onClick={createToken}
              disabled={creating}
              className="btn-primary w-full justify-center"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              Generar link
            </button>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-slate-700">Links generados</h4>
              <button onClick={refreshTokens} className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Refrescar
              </button>
            </div>
            {loadingTokens ? (
              <div className="text-xs text-slate-500">Cargando…</div>
            ) : tokens.length === 0 ? (
              <div className="text-xs text-slate-500">No hay links generados.</div>
            ) : (
              <ul className="space-y-2">
                {tokens.map((t) => {
                  const url = fullUrl(t.public_url_path);
                  return (
                    <li key={t.token} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-800 truncate">{t.note || '(sin nota)'}</div>
                          <div className="text-slate-500">
                            Por {t.created_by} · expira {formatDateTime(t.expires_at)}
                          </div>
                        </div>
                        <span className={`inline-flex shrink-0 items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          t.is_active ? 'bg-emerald-100 text-emerald-800' :
                          t.used_at ? 'bg-slate-200 text-slate-700' :
                          t.revoked_at ? 'bg-rose-100 text-rose-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {t.is_active ? 'activo' :
                           t.used_at ? 'usado' :
                           t.revoked_at ? 'revocado' : 'expirado'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <input
                          readOnly
                          value={url}
                          onFocus={(e) => e.currentTarget.select()}
                          className="flex-1 px-2 py-1 text-[11px] rounded border border-slate-300 bg-white font-mono text-slate-700"
                        />
                        <button
                          onClick={() => copyToClipboard(url, t.token)}
                          className="btn-secondary text-xs"
                          title="Copiar link"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          {copied === t.token ? '¡Copiado!' : 'Copiar'}
                        </button>
                        {t.is_active && (
                          <button
                            onClick={() => revokeToken(t.token)}
                            className="btn-secondary text-xs text-rose-600 hover:bg-rose-50"
                            title="Revocar"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Instrucciones */}
      <div className="card p-5 mt-6 bg-slate-50">
        <h4 className="text-sm font-semibold text-slate-800 mb-2">Cómo usar</h4>
        <ol className="text-sm text-slate-700 space-y-1.5 list-decimal list-inside">
          <li>Esperá a que el extractor entre en estado <strong>"QR listo"</strong>. Si está conectado, primero borrá el volumen de sesión en el servidor.</li>
          <li>Generá un link arriba (5-60 min de vida).</li>
          <li>Copiá el link y mandáselo al cliente por WhatsApp/Telegram.</li>
          <li>Cuando el cliente abra el link, ve el QR sin tener que loguearse.</li>
          <li>Apenas el cliente escanea, el link se invalida automáticamente.</li>
        </ol>
      </div>
    </div>
  );
}
