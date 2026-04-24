'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi } from '@/lib/api';
import type { GhostLead, GhostLeadsResponse } from '@/types/api';
import PageHeader from '@/components/PageHeader';
import { ErrorState } from '@/components/LoadingState';
import { useToast } from '@/components/Toast';
import { formatCOP } from '@/lib/format';
import {
  Ghost,
  Clock,
  AlertTriangle,
  MessageSquare,
  Copy,
  Filter,
  UserX,
  ArrowRight,
} from 'lucide-react';

function displayName(l: GhostLead): string {
  return (l.real_name as string) ||
         (l.whatsapp_name as string) ||
         (l.phone as string) ||
         '—';
}

function humanize(v?: string | null): string {
  return (v || '').replace(/_/g, ' ');
}

function perdidoPorBadge(p?: string | null): {
  label: string;
  cls: string;
} {
  if (!p) return { label: '—', cls: 'bg-slate-100 text-slate-600' };
  if (p.startsWith('asesor_')) {
    return {
      label: humanize(p),
      cls: 'bg-rose-100 text-rose-800 ring-1 ring-rose-200',
    };
  }
  return {
    label: humanize(p),
    cls: 'bg-slate-100 text-slate-700',
  };
}

function priorityBadge(p?: string): string {
  if (p === 'esta_semana') return 'bg-rose-100 text-rose-800';
  if (p === 'este_mes') return 'bg-amber-100 text-amber-800';
  return 'bg-slate-100 text-slate-700';
}

export default function GhostsPage() {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<GhostLeadsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [minIntent, setMinIntent] = useState('4');
  const [minDays, setMinDays] = useState('7');
  const [onlyAdvisorFault, setOnlyAdvisorFault] = useState(false);
  const [onlyRecoverable, setOnlyRecoverable] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams();
    params.set('min_intent', minIntent);
    params.set('min_days', minDays);
    if (onlyAdvisorFault) params.set('only_advisor_fault', 'true');
    if (onlyRecoverable) params.set('only_recoverable', 'true');
    params.set('limit', '200');

    const timer = setTimeout(() => {
      (async () => {
        try {
          const res = await fetchApi<GhostLeadsResponse>(
            `/api/leads/ghosts?${params.toString()}`
          );
          if (active) {
            setData(res);
            setError(null);
          }
        } catch (err) {
          if (active) setError(err instanceof Error ? err.message : 'Error');
        } finally {
          if (active) setLoading(false);
        }
      })();
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [minIntent, minDays, onlyAdvisorFault, onlyRecoverable]);

  async function copyRecoveryMessage(msg: string | null | undefined) {
    if (!msg) {
      toast.error('Este lead no tiene mensaje de recuperación sugerido');
      return;
    }
    try {
      await navigator.clipboard.writeText(msg);
      toast.success('Mensaje copiado al portapapeles');
    } catch {
      toast.error('No se pudo copiar');
    }
  }

  return (
    <div>
      <PageHeader
        title="Leads fantasma"
        subtitle="Leads con intención alta que se enfriaron por mala atención o por falta de seguimiento. Listos para resucitar."
      />

      <div className="card p-4 mb-4">
        <div className="flex items-center gap-2 text-sm text-slate-600 mb-3">
          <Filter className="w-4 h-4" /> Filtros
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label htmlFor="g-intent" className="label">Intención mínima</label>
            <select
              id="g-intent"
              className="input"
              value={minIntent}
              onChange={(e) => setMinIntent(e.target.value)}
            >
              <option value="1">≥ 1 (todos)</option>
              <option value="4">≥ 4 (default — amplio)</option>
              <option value="6">≥ 6 (interesados)</option>
              <option value="7">≥ 7 (calientes)</option>
              <option value="8">≥ 8 (muy calientes)</option>
            </select>
          </div>
          <div>
            <label htmlFor="g-days" className="label">Días sin contacto mínimo</label>
            <select
              id="g-days"
              className="input"
              value={minDays}
              onChange={(e) => setMinDays(e.target.value)}
            >
              <option value="0">Cualquiera</option>
              <option value="3">3+ días</option>
              <option value="7">7+ días (default)</option>
              <option value="15">15+ días</option>
              <option value="30">30+ días</option>
              <option value="60">60+ días</option>
              <option value="90">90+ días (muy fríos)</option>
            </select>
          </div>
          <div className="md:col-span-2 flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyAdvisorFault}
                onChange={(e) => setOnlyAdvisorFault(e.target.checked)}
              />
              <span>Solo por culpa del asesor</span>
              <span className="text-xs text-slate-500">(más fáciles de recuperar)</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyRecoverable}
                onChange={(e) => setOnlyRecoverable(e.target.checked)}
              />
              <span>Solo marcados como recuperables</span>
              <span className="text-xs text-slate-500">(más restrictivo)</span>
            </label>
          </div>
        </div>
      </div>

      {loading && (
        <div className="card p-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-24" />
          ))}
        </div>
      )}
      {error && <ErrorState message={error} />}

      {!loading && !error && (
        <>
          <div className="mb-3 text-sm text-slate-600">
            <Ghost className="inline w-4 h-4 mr-1" />
            {data?.total ?? 0} leads fantasma recuperables
          </div>

          {(data?.rows?.length ?? 0) === 0 && (
            <div className="card p-10 text-center text-sm text-slate-500">
              No hay leads fantasma con los filtros actuales. Probá reducir
              el umbral de intención o los días.
            </div>
          )}

          <div className="space-y-3">
            {(data?.rows || []).map((l) => {
              const badge = perdidoPorBadge(l.perdido_por);
              return (
                <div key={l.id} className="card p-5">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-slate-900 text-lg">
                          {displayName(l)}
                        </span>
                        {l.ghost_score != null && (
                          <span
                            className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-semibold ${
                              (l.ghost_score as number) >= 70 ? 'bg-emerald-100 text-emerald-800' :
                              (l.ghost_score as number) >= 50 ? 'bg-amber-100 text-amber-800' :
                              'bg-slate-100 text-slate-700'
                            }`}
                            title="Prioridad ponderada: intent × urgencia × presupuesto × recencia × culpa del asesor"
                          >
                            🎯 {l.ghost_score}
                          </span>
                        )}
                        {l.intent_score != null && (
                          <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                            Intent {l.intent_score}/10
                          </span>
                        )}
                        {l.urgency && l.urgency !== 'no_especificado' && (
                          <span className="text-xs text-slate-500">
                            · {humanize(l.urgency)}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 space-x-2">
                        {l.phone && <span>{l.phone}</span>}
                        {l.city && <span>· {l.city}</span>}
                        {l.occupation && <span>· {l.occupation}</span>}
                        {l.age_range && l.age_range !== 'desconocido' &&
                          <span>· {l.age_range} años</span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded ${badge.cls}`}>
                        {badge.label.startsWith('asesor') && (
                          <UserX className="inline w-3 h-3 mr-1" />
                        )}
                        Perdido: {badge.label}
                      </span>
                      {l.recovery_priority && l.recovery_priority !== 'no_aplica' && (
                        <span className={`text-xs px-2 py-1 rounded ${priorityBadge(l.recovery_priority)}`}>
                          {humanize(l.recovery_priority)}
                        </span>
                      )}
                      <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        hace {l.days_since_contact} días
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs mb-3">
                    {l.project_name && (
                      <div>
                        <span className="text-slate-500">Proyecto:</span>{' '}
                        <span className="font-medium">{l.project_name}</span>
                      </div>
                    )}
                    {l.budget_estimated_cop != null && (
                      <div>
                        <span className="text-slate-500">Presupuesto:</span>{' '}
                        <span className="font-medium">
                          {formatCOP(l.budget_estimated_cop as number | string)}
                        </span>
                      </div>
                    )}
                    {l.advisor_name && (
                      <div>
                        <span className="text-slate-500">Asesor que atendió:</span>{' '}
                        <span className="font-medium">{l.advisor_name}</span>
                        {l.speed_compliance === false && (
                          <span className="ml-1 text-rose-600">(lento)</span>
                        )}
                        {l.followup_compliance === false && (
                          <span className="ml-1 text-amber-600">(sin seguimiento)</span>
                        )}
                      </div>
                    )}
                  </div>

                  {l.peak_intent_verbatim && (
                    <div className="mb-2 border-l-4 border-emerald-400 pl-3 py-1 bg-emerald-50 rounded">
                      <div className="text-[10px] uppercase text-emerald-700 font-medium">
                        Momento de máxima intención
                      </div>
                      <blockquote className="text-sm text-slate-800 italic">
                        "{l.peak_intent_verbatim}"
                      </blockquote>
                    </div>
                  )}

                  {l.loss_point_verbatim && (
                    <div className="mb-2 border-l-4 border-rose-400 pl-3 py-1 bg-rose-50 rounded">
                      <div className="text-[10px] uppercase text-rose-700 font-medium">
                        Punto donde se rompió
                      </div>
                      <blockquote className="text-sm text-slate-800 italic">
                        "{l.loss_point_verbatim}"
                      </blockquote>
                    </div>
                  )}

                  {l.next_concrete_action && (
                    <div className="mb-2 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
                      <div>
                        <div className="text-[10px] uppercase text-brand-700 font-medium">
                          Próxima acción
                        </div>
                        <div className="text-sm text-slate-800">
                          {l.next_concrete_action}
                        </div>
                      </div>
                    </div>
                  )}

                  {l.recovery_message_suggestion && (
                    <div className="mb-3 border border-brand-200 bg-brand-50 rounded p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[10px] uppercase text-brand-700 font-medium">
                          Mensaje de recuperación sugerido
                        </div>
                        <button
                          onClick={() =>
                            copyRecoveryMessage(l.recovery_message_suggestion)
                          }
                          className="btn-ghost text-xs py-1 px-2"
                          title="Copiar mensaje"
                        >
                          <Copy className="w-3 h-3" /> Copiar
                        </button>
                      </div>
                      <div className="text-sm text-slate-900 whitespace-pre-wrap">
                        {l.recovery_message_suggestion}
                      </div>
                    </div>
                  )}

                  {l.alternative_product && (
                    <div className="mb-2 text-xs text-slate-600">
                      <span className="font-medium">Alternativa sugerida: </span>
                      {l.alternative_product}
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => router.push(`/leads/${l.id}`)}
                      className="btn-outline text-xs"
                    >
                      <MessageSquare className="w-3 h-3" /> Ver detalle
                    </button>
                    {l.conversation_id && (
                      <button
                        onClick={() =>
                          router.push(`/leads/${l.id}/conversation`)
                        }
                        className="btn-primary text-xs"
                      >
                        Ver conversación <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
