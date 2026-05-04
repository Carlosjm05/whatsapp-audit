'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Download,
  Eye,
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Database,
  ListOrdered,
  Trash2,
} from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import KpiCard from '@/components/KpiCard';
import { fetchApi, ApiError } from '@/lib/api';

const POLL_MS = 4000;

type HistogramRow = {
  mes: string;
  total: number;
  indexado: number;
  extracted: number;
  failed: number;
};

type Job = {
  id?: string;
  action: string;
  batch?: number;
  requested_by?: string;
  requested_at?: string;
  started_at?: string;
  finished_at?: string;
  status?: string;
  error?: string;
};

type ExtractionState = {
  total_chats: number;
  indexado_pendientes: number;
  extracted_total: number;
  failed_total: number;
  next_priority: number | null;
  max_priority: number | null;
  histogram: HistogramRow[];
  current_job: Job | null;
  last_jobs: Job[];
  extractor_status: string | null;
  extractor_last_activity: string | null;
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const t = new Date(iso).getTime();
    const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (secs < 60) return `hace ${secs}s`;
    if (secs < 3600) return `hace ${Math.floor(secs / 60)}min`;
    if (secs < 86400) return `hace ${Math.floor(secs / 3600)}h`;
    return `hace ${Math.floor(secs / 86400)}d`;
  } catch {
    return '—';
  }
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    preview: 'Vista previa',
    index: 'Indexar (1er escaneo)',
    extract: 'Extraer lote',
  };
  return map[action] || action;
}

function StatusBadge({ status }: { status?: string }) {
  const cfg: Record<string, { bg: string; text: string; icon: typeof Clock }> = {
    running:   { bg: 'bg-amber-100',  text: 'text-amber-800',  icon: Clock },
    completed: { bg: 'bg-emerald-100', text: 'text-emerald-800', icon: CheckCircle2 },
    failed:    { bg: 'bg-rose-100',   text: 'text-rose-800',   icon: XCircle },
  };
  const c = cfg[status || ''] || { bg: 'bg-slate-100', text: 'text-slate-700', icon: AlertCircle };
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${c.bg} ${c.text}`}>
      <Icon className="w-3 h-3" />
      {status || 'desconocido'}
    </span>
  );
}

function ExtractorStatusPill({ status }: { status: string | null }) {
  const cfg: Record<string, { bg: string; text: string; label: string }> = {
    connected:    { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'WhatsApp conectado' },
    daemon_idle:  { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Daemon listo (esperando jobs)' },
    qr_ready:     { bg: 'bg-amber-100',  text: 'text-amber-800',  label: 'QR esperando escaneo' },
    connecting:   { bg: 'bg-blue-100',   text: 'text-blue-800',   label: 'Conectando WhatsApp' },
    reconnecting: { bg: 'bg-blue-100',   text: 'text-blue-800',   label: 'Reconectando' },
    disconnected: { bg: 'bg-rose-100',   text: 'text-rose-800',   label: 'WhatsApp desconectado' },
  };
  const c = cfg[status || ''] || { bg: 'bg-slate-100', text: 'text-slate-700', label: status || 'sin daemon' };
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

export default function ExtraccionPage() {
  const [state, setState] = useState<ExtractionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [batchSize, setBatchSize] = useState<number>(1000);
  const [beforeDate, setBeforeDate] = useState<string>('');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchApi<ExtractionState>('/api/extraction/state');
      setState(data);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const enqueue = async (action: string, batch?: number, before?: string) => {
    setActionInFlight(action);
    setFeedback(null);
    try {
      const payload: Record<string, unknown> = { action };
      if (batch) payload.batch = batch;
      if (before && /^\d{4}-\d{2}-\d{2}$/.test(before)) payload.before = before;
      await fetchApi('/api/extraction/jobs', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setFeedback({
        kind: 'ok',
        msg: `Job ${actionLabel(action)} encolado. El daemon lo va a procesar en breve.`,
      });
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error encolando job';
      setFeedback({ kind: 'err', msg });
    } finally {
      setActionInFlight(null);
    }
  };

  const clearQueue = async () => {
    if (!confirm('¿Vaciar la cola de jobs pendientes? El job en ejecución NO se cancela.')) return;
    try {
      await fetchApi('/api/extraction/jobs/queue', { method: 'DELETE' });
      setFeedback({ kind: 'ok', msg: 'Cola vaciada.' });
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error vaciando cola';
      setFeedback({ kind: 'err', msg });
    }
  };

  const clearCurrentJob = async () => {
    if (!confirm(
      '¿Borrar el job actual de Redis?\n\n' +
      'Solo úsese si el daemon crasheó y el job quedó "running" pero ' +
      'en realidad no se está ejecutando nada. NO cancela procesos reales.'
    )) return;
    try {
      await fetchApi('/api/extraction/jobs/current', { method: 'DELETE' });
      setFeedback({ kind: 'ok', msg: 'Job actual limpiado. Ya podés encolar uno nuevo.' });
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error limpiando job actual';
      setFeedback({ kind: 'err', msg });
    }
  };

  if (loading) {
    return (
      <div className="px-4 sm:px-6 py-6">
        <PageHeader title="Extracción por lotes" subtitle="Cargando estado…" />
      </div>
    );
  }

  if (!state) {
    return (
      <div className="px-4 sm:px-6 py-6">
        <PageHeader title="Extracción por lotes" />
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-sm text-rose-800">
          {error || 'No se pudo cargar el estado.'}
        </div>
      </div>
    );
  }

  const isJobRunning = state.current_job?.status === 'running';
  const maxBarValue = Math.max(1, ...state.histogram.map(h => h.total));

  return (
    <div className="px-4 sm:px-6 py-6 space-y-6">
      <PageHeader
        title="Extracción por lotes"
        subtitle="Indexá todos los chats una sola vez, después procesá lotes de N chats sin perder el orden entre reescaneos del QR. Hora del sistema: Bogotá."
        actions={
          <button
            onClick={load}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-slate-300 rounded hover:bg-slate-50"
          >
            <RefreshCw className="w-4 h-4" />
            Refrescar
          </button>
        }
      />

      {feedback && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            feedback.kind === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Total en DB"
          value={state.total_chats.toLocaleString('es-CO')}
          icon={<Database className="w-5 h-5" />}
        />
        <KpiCard
          label="Indexados pendientes"
          value={state.indexado_pendientes.toLocaleString('es-CO')}
          sub={state.next_priority ? `próx. prioridad #${state.next_priority}` : 'sin pendientes'}
          icon={<ListOrdered className="w-5 h-5" />}
          tone={state.indexado_pendientes > 0 ? 'warning' : 'default'}
        />
        <KpiCard
          label="Extraídos"
          value={state.extracted_total.toLocaleString('es-CO')}
          icon={<CheckCircle2 className="w-5 h-5" />}
          tone="positive"
        />
        <KpiCard
          label="Fallidos"
          value={state.failed_total.toLocaleString('es-CO')}
          icon={<XCircle className="w-5 h-5" />}
          tone={state.failed_total > 0 ? 'danger' : 'default'}
        />
      </div>

      {/* Estado del daemon + acciones */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div>
            <div className="text-xs uppercase text-slate-500 mb-1">Daemon del extractor</div>
            <div className="flex items-center gap-3">
              <ExtractorStatusPill status={state.extractor_status} />
              <span className="text-xs text-slate-500">
                Última actividad: {formatRelative(state.extractor_last_activity)}
              </span>
            </div>
          </div>
        </div>

        {!state.extractor_status && (
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900 mb-4">
            ⚠️ El daemon del extractor no está corriendo (o lleva más de 5 min sin pulsar). En el servidor:
            <code className="block mt-2 bg-amber-100 p-2 rounded text-xs">
              docker compose --profile extraction up -d extractor
            </code>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Preview */}
          <button
            onClick={() => enqueue('preview')}
            disabled={!!actionInFlight}
            className="flex flex-col items-start gap-2 p-4 border border-slate-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition disabled:opacity-50 disabled:cursor-not-allowed text-left"
          >
            <Eye className="w-5 h-5 text-blue-600" />
            <div className="font-medium text-slate-900">Vista previa</div>
            <div className="text-xs text-slate-500">
              Lee la DB y publica histograma. NO abre WhatsApp, no requiere QR.
            </div>
          </button>

          {/* Index */}
          <button
            onClick={() => {
              if (state.indexado_pendientes > 0) {
                if (!confirm(
                  `Ya hay ${state.indexado_pendientes} chats indexados pendientes. ` +
                  `Indexar otra vez NO los duplica (ON CONFLICT DO NOTHING) pero ` +
                  `requiere reescanear QR. ¿Continuar?`
                )) return;
              }
              enqueue('index');
            }}
            disabled={!!actionInFlight || isJobRunning}
            className="flex flex-col items-start gap-2 p-4 border border-slate-200 rounded-lg hover:border-amber-300 hover:bg-amber-50 transition disabled:opacity-50 disabled:cursor-not-allowed text-left"
          >
            <Play className="w-5 h-5 text-amber-600" />
            <div className="font-medium text-slate-900">Indexar (1er escaneo)</div>
            <div className="text-xs text-slate-500">
              Escanea QR + guarda metadatos de TODOS los chats con cutoff aplicado. NO descarga mensajes.
            </div>
          </button>

          {/* Extract batch */}
          <div className="flex flex-col gap-2 p-4 border border-slate-200 rounded-lg">
            <Download className="w-5 h-5 text-emerald-600" />
            <div className="font-medium text-slate-900">Extraer lote</div>
            <div className="text-xs text-slate-500 mb-2">
              Reescanea QR + procesa próximos N chats indexados (mensajes + media).
              El filtro de fecha es opcional: limita a chats con último mensaje ≤ fecha.
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-600 w-16">Cantidad</label>
                <input
                  type="number"
                  min={1}
                  max={5000}
                  step={100}
                  value={batchSize}
                  onChange={e => setBatchSize(parseInt(e.target.value, 10) || 1000)}
                  className="flex-1 px-2 py-1 border border-slate-300 rounded text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-600 w-16">Hasta</label>
                <input
                  type="date"
                  value={beforeDate}
                  onChange={e => setBeforeDate(e.target.value)}
                  placeholder="YYYY-MM-DD"
                  className="flex-1 px-2 py-1 border border-slate-300 rounded text-sm"
                />
                {beforeDate && (
                  <button
                    onClick={() => setBeforeDate('')}
                    className="text-xs text-slate-500 hover:text-slate-700"
                    title="Limpiar filtro"
                  >
                    ✕
                  </button>
                )}
              </div>
              <button
                onClick={() => enqueue('extract', batchSize, beforeDate || undefined)}
                disabled={!!actionInFlight || isJobRunning || state.indexado_pendientes === 0}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                Encolar {beforeDate && `(hasta ${beforeDate})`}
              </button>
            </div>
          </div>
        </div>

        {isJobRunning && (() => {
          const startedAt = state.current_job?.started_at;
          const elapsedMin = startedAt
            ? (Date.now() - new Date(startedAt).getTime()) / 60000
            : 0;
          const looksOrphan = elapsedMin > 30;  // 30+ min sin terminar = sospechoso
          return (
            <div className={`mt-4 rounded p-3 ${looksOrphan ? 'bg-rose-50 border border-rose-200' : 'bg-amber-50 border border-amber-200'}`}>
              <div className={`flex items-center gap-2 text-sm font-medium mb-1 ${looksOrphan ? 'text-rose-900' : 'text-amber-900'}`}>
                <Clock className="w-4 h-4 animate-pulse" />
                Job en ejecución: {actionLabel(state.current_job!.action)}
                {state.current_job!.batch && ` (lote: ${state.current_job!.batch})`}
              </div>
              <div className={`text-xs ${looksOrphan ? 'text-rose-800' : 'text-amber-800'}`}>
                Iniciado {formatRelative(state.current_job!.started_at)} por{' '}
                {state.current_job!.requested_by || '—'}. Los nuevos jobs van a la cola hasta que termine.
              </div>
              {looksOrphan && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-rose-800">
                    Lleva más de 30 min — puede ser huérfano de un crash.
                  </span>
                  <button
                    onClick={clearCurrentJob}
                    className="px-2 py-1 text-xs bg-rose-600 hover:bg-rose-700 text-white rounded"
                  >
                    Marcar como huérfano
                  </button>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Histograma por mes */}
      {state.histogram.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">
            Histograma por mes (last_message_at)
          </h2>
          <div className="space-y-2">
            {state.histogram.map(row => {
              const pctTotal = (row.total / maxBarValue) * 100;
              const pctExtracted = (row.extracted / row.total) * 100;
              return (
                <div key={row.mes} className="text-sm">
                  <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                    <span className="font-medium text-slate-800">{row.mes}</span>
                    <span>
                      {row.total.toLocaleString('es-CO')} total ·{' '}
                      <span className="text-emerald-700">{row.extracted} ext</span> ·{' '}
                      <span className="text-amber-700">{row.indexado} idx</span>
                      {row.failed > 0 && (
                        <> · <span className="text-rose-700">{row.failed} fail</span></>
                      )}
                    </span>
                  </div>
                  <div className="h-3 bg-slate-100 rounded-full overflow-hidden relative">
                    <div
                      className="absolute top-0 left-0 h-full bg-amber-300"
                      style={{ width: `${pctTotal}%` }}
                    />
                    <div
                      className="absolute top-0 left-0 h-full bg-emerald-500"
                      style={{ width: `${(pctTotal * pctExtracted) / 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-xs text-slate-500 flex gap-4">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-emerald-500 rounded-sm inline-block" /> extraído
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-amber-300 rounded-sm inline-block" /> indexado pendiente
            </span>
          </div>
        </div>
      )}

      {/* Historial de jobs */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-800">Últimos jobs ejecutados</h2>
          <button
            onClick={clearQueue}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-slate-300 rounded hover:bg-slate-50 text-slate-600"
            title="Vacía la cola de jobs PENDIENTES (no afecta el job actual)"
          >
            <Trash2 className="w-3 h-3" />
            Vaciar cola
          </button>
        </div>
        {state.last_jobs.length === 0 ? (
          <div className="text-sm text-slate-500 py-4 text-center">
            Sin jobs ejecutados aún.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Acción</th>
                  <th className="px-3 py-2 text-left">Estado</th>
                  <th className="px-3 py-2 text-left">Inicio</th>
                  <th className="px-3 py-2 text-left">Fin</th>
                  <th className="px-3 py-2 text-left">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.last_jobs.map((j, i) => (
                  <tr key={j.id || i}>
                    <td className="px-3 py-2 text-slate-800">
                      {actionLabel(j.action)}
                      {j.batch && <span className="text-xs text-slate-500"> (lote {j.batch})</span>}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={j.status} />
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {formatDateTime(j.started_at)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {formatDateTime(j.finished_at)}
                    </td>
                    <td className="px-3 py-2 text-xs text-rose-700">
                      {j.error || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
