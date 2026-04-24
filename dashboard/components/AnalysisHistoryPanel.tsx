'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import { History, ChevronDown, ChevronRight, Loader2, AlertCircle, CheckCircle2, Clock } from 'lucide-react';

type HistoryItem = {
  id: string;
  lead_id: string;
  triggered_by: string;
  status: string;
  model_used: string | null;
  // Postgres DECIMAL → string en JSON con FastAPI default. Aceptamos
  // ambos para no romper si el endpoint cambia.
  cost_usd: number | string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  diff_summary: string | null;
  raw_output: Record<string, unknown> | null;
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-CO', {
      hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short', year: 'numeric'
    });
  } catch { return iso; }
}

function statusBadge(status: string) {
  const map: Record<string, { color: string; icon: any }> = {
    completed:  { color: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
    failed:     { color: 'bg-rose-100 text-rose-800',       icon: AlertCircle },
    pending:    { color: 'bg-amber-100 text-amber-800',     icon: Clock },
    processing: { color: 'bg-sky-100 text-sky-800',         icon: Loader2 },
  };
  const cfg = map[status] || { color: 'bg-slate-100 text-slate-700', icon: Clock };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${cfg.color}`}>
      <Icon className={`w-3 h-3 ${status === 'processing' ? 'animate-spin' : ''}`} /> {status}
    </span>
  );
}

// Pequeño helper para extraer "lo importante" del raw_output, en formato corto.
function summarizeAnalysis(raw: Record<string, unknown> | null | undefined): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const out: string[] = [];
  const intent = (raw as any).intent;
  const outcome = (raw as any).outcome;
  const interest = (raw as any).interest;
  const lead = (raw as any).lead;
  if (intent?.intent_score) out.push(`Intent ${intent.intent_score}/10`);
  if (outcome?.final_status) out.push(`Estado: ${String(outcome.final_status).replace(/_/g, ' ')}`);
  if (outcome?.perdido_por && outcome.perdido_por !== 'no_aplica') {
    out.push(`Perdido por: ${String(outcome.perdido_por).replace(/_/g, ' ')}`);
  }
  if (outcome?.is_recoverable !== undefined) {
    out.push(`Recuperable: ${outcome.is_recoverable ? 'sí' : 'no'}`);
  }
  if (interest?.project_name) out.push(`Proyecto: ${interest.project_name}`);
  if (lead?.real_name) out.push(`Nombre: ${lead.real_name}`);
  return out;
}

export default function AnalysisHistoryPanel({ leadId, refreshKey }: { leadId: string; refreshKey?: number }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const res = await fetchApi<{ items: HistoryItem[] }>(`/api/leads/${leadId}/analysis-history`);
        if (active) {
          setItems(res.items || []);
          setError(null);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Error');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [leadId, refreshKey]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center">
          <History className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Historial de análisis</h3>
          <p className="text-xs text-slate-500">
            Todas las versiones del análisis IA. Útil para comparar cuando cambiás el prompt.
          </p>
        </div>
      </div>

      {loading && <div className="text-xs text-slate-500">Cargando…</div>}
      {error && <div className="text-xs text-rose-600">{error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="text-xs text-slate-500">Sin historial aún.</div>
      )}

      <ul className="space-y-2">
        {items.map((it, idx) => {
          const isExpanded = expanded.has(it.id);
          const isLatest = idx === 0;
          const summary = summarizeAnalysis(it.raw_output);
          return (
            <li
              key={it.id}
              className={`rounded-lg border ${isLatest ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200 bg-white'}`}
            >
              <button
                onClick={() => toggle(it.id)}
                className="w-full text-left px-3 py-2 flex items-start gap-2"
              >
                {isExpanded ? <ChevronDown className="w-4 h-4 mt-0.5 text-slate-400" /> : <ChevronRight className="w-4 h-4 mt-0.5 text-slate-400" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    {statusBadge(it.status)}
                    <span className="text-xs text-slate-700 font-medium">
                      {it.triggered_by === 'manual' ? '👤 Manual' : '🤖 Auto'}
                    </span>
                    {it.model_used && <span className="text-[11px] text-slate-500">{it.model_used}</span>}
                    {it.cost_usd !== null && it.cost_usd !== undefined && (
                      <span className="text-[11px] text-slate-500">${Number(it.cost_usd).toFixed(4)}</span>
                    )}
                    {isLatest && (
                      <span className="ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-wide bg-emerald-100 text-emerald-700 rounded px-1.5 py-0.5 font-semibold">
                        actual
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {formatDateTime(it.started_at)}
                    {it.completed_at && it.completed_at !== it.started_at && (
                      <> · listo {formatDateTime(it.completed_at)}</>
                    )}
                  </div>
                  {!isExpanded && summary.length > 0 && (
                    <div className="text-[11px] text-slate-600 mt-1 truncate">
                      {summary.slice(0, 4).join(' · ')}
                    </div>
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-slate-200 bg-slate-50/40">
                  {it.error_message && (
                    <div className="mb-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
                      <strong>Error:</strong> {it.error_message}
                    </div>
                  )}
                  {summary.length > 0 && (
                    <div className="mb-2">
                      <div className="text-[11px] font-medium text-slate-600 mb-1">Resumen</div>
                      <ul className="text-xs text-slate-700 space-y-0.5">
                        {summary.map((s, i) => <li key={i}>• {s}</li>)}
                      </ul>
                    </div>
                  )}
                  {it.diff_summary && (
                    <div className="mb-2">
                      <div className="text-[11px] font-medium text-slate-600 mb-1">Cambios respecto al anterior</div>
                      <p className="text-xs text-slate-700">{it.diff_summary}</p>
                    </div>
                  )}
                  {it.raw_output && (
                    <details className="mt-2">
                      <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-800">
                        Ver JSON completo
                      </summary>
                      <pre className="text-[10px] text-slate-700 bg-white border border-slate-200 rounded p-2 mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words">
                        {JSON.stringify(it.raw_output, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
