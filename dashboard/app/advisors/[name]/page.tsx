'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fetchApi } from '@/lib/api';
import type {
  AdvisorDetail,
  AdvisorErrorsResponse,
  AdvisorErrorGroup,
} from '@/types/api';
import PageHeader from '@/components/PageHeader';
import KpiCard from '@/components/KpiCard';
import { ChartCard, ChartBar, ChartPie } from '@/components/Charts';
import { ErrorState } from '@/components/LoadingState';
import { formatNumber, formatDate } from '@/lib/format';
import {
  ArrowLeft,
  Check,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react';

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Subcomponente: expandido de un error con los leads afectados.
function ExpandedErrorLeads({
  group,
  onClickLead,
}: {
  group: AdvisorErrorGroup;
  onClickLead: (id: string) => void;
}) {
  const leads = group.leads || [];
  if (leads.length === 0) {
    return (
      <div className="text-xs text-slate-500 px-7 pb-2">
        Sin leads asociados.
      </div>
    );
  }
  return (
    <div className="ml-6 mr-1 mb-2 bg-slate-50 rounded border border-slate-200 divide-y divide-slate-200">
      {leads.map((l) => {
        const displayName =
          l.real_name || l.whatsapp_name || l.phone || '—';
        return (
          <button
            key={l.lead_id}
            onClick={(e) => {
              e.stopPropagation();
              onClickLead(l.lead_id);
            }}
            className="w-full text-left px-3 py-2 hover:bg-white flex items-center justify-between gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-900 truncate">
                {displayName}
              </div>
              <div className="text-[11px] text-slate-500 space-x-2">
                {l.phone && <span>{l.phone}</span>}
                {l.final_status && (
                  <span>· {String(l.final_status).replace(/_/g, ' ')}</span>
                )}
                {l.first_response_minutes != null && (
                  <span>
                    · 1ra resp: {Math.round(toNum(l.first_response_minutes))} min
                  </span>
                )}
                {l.last_contact_at && (
                  <span>· {formatDate(l.last_contact_at)}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 shrink-0">
              {l.overall_score != null && (
                <span>{toNum(l.overall_score).toFixed(1)}/10</span>
              )}
              <ExternalLink className="w-3 h-3" />
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default function AdvisorDetailPage() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const name = decodeURIComponent((params?.name as string) || '');
  const [data, setData] = useState<AdvisorDetail | null>(null);
  const [errorsDetail, setErrorsDetail] =
    useState<AdvisorErrorsResponse | null>(null);
  const [expandedError, setExpandedError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Fetch en paralelo: resumen + errores detallados.
        const [res, errRes] = await Promise.all([
          fetchApi<AdvisorDetail>(
            `/api/advisors/${encodeURIComponent(name)}`
          ),
          fetchApi<AdvisorErrorsResponse>(
            `/api/advisors/${encodeURIComponent(name)}/errors`
          ).catch(() => null),
        ]);
        if (active) {
          setData(res);
          setErrorsDetail(errRes);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Error');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [name]);

  return (
    <div>
      <button
        onClick={() => router.push('/advisors')}
        className="mb-4 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="w-4 h-4" /> Volver a asesores
      </button>

      {loading && <div className="skeleton h-32" />}
      {error && <ErrorState message={error} />}

      {!loading && !error && data && (() => {
        const s = data.summary;
        const conversion =
          toNum(s.total_leads) === 0
            ? 0
            : (toNum(s.sold) / toNum(s.total_leads)) * 100;
        const scoreBreakdown = [
          { label: 'Velocidad', value: toNum(s.avg_speed_score) },
          { label: 'Calificación', value: toNum(s.avg_qualification_score) },
          { label: 'Presentación', value: toNum(s.avg_product_presentation_score) },
          { label: 'Objeciones', value: toNum(s.avg_objection_handling_score) },
          { label: 'Cierre', value: toNum(s.avg_closing_attempt_score) },
          { label: 'Seguimiento', value: toNum(s.avg_followup_score) },
        ];
        return (
          <>
            <PageHeader
              title={s.advisor_name}
              subtitle="Desempeño detallado del asesor"
            />

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <KpiCard
                label="Score general"
                value={
                  s.avg_overall_score != null
                    ? `${toNum(s.avg_overall_score).toFixed(1)} / 10`
                    : '—'
                }
              />
              <KpiCard label="Leads" value={formatNumber(s.total_leads)} />
              <KpiCard
                label="Ventas cerradas"
                value={formatNumber(s.sold)}
                tone="positive"
              />
              <KpiCard
                label="Conversión"
                value={`${conversion.toFixed(1)}%`}
                tone={conversion >= 10 ? 'positive' : 'warning'}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <KpiCard
                label="1ra respuesta (min)"
                value={
                  s.avg_first_response_minutes != null
                    ? formatNumber(Math.round(toNum(s.avg_first_response_minutes)))
                    : '—'
                }
              />
              <KpiCard
                label="Respuesta promedio (min)"
                value={
                  s.avg_response_minutes != null
                    ? formatNumber(Math.round(toNum(s.avg_response_minutes)))
                    : '—'
                }
              />
              <KpiCard
                label="Leads recuperables"
                value={formatNumber(s.recoverable)}
                tone="warning"
              />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
              <ChartCard title="Desglose de calificación" subtitle="Por dimensión (1-10)">
                <ChartBar
                  data={scoreBreakdown}
                  xKey="label"
                  yKey="value"
                  horizontal
                  color="#2563eb"
                />
              </ChartCard>
              <ChartCard title="Distribución de resultados" subtitle="Estados finales">
                <ChartPie
                  data={data.outcome_distribution || []}
                  nameKey="final_status"
                  valueKey="count"
                />
              </ChartCard>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-slate-800 mb-3">
                  Fortalezas más comunes
                </h3>
                {(data.common_strengths || []).length === 0 ? (
                  <div className="text-sm text-slate-500">Sin datos.</div>
                ) : (
                  <ul className="space-y-2">
                    {(data.common_strengths || []).map((item, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm text-slate-700"
                      >
                        <Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                        <span className="flex-1">{item.text}</span>
                        <span className="text-xs text-slate-500">×{item.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-slate-800 mb-3">
                  Errores más frecuentes
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    (click para ver leads afectados)
                  </span>
                </h3>
                {(errorsDetail?.errors || []).length === 0 ? (
                  <div className="text-sm text-slate-500">
                    Sin errores registrados.
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {(errorsDetail?.errors || []).map((group) => {
                      const isExpanded = expandedError === group.error_text;
                      return (
                        <li key={group.error_text} className="border-b border-slate-100 last:border-0">
                          <button
                            onClick={() =>
                              setExpandedError(isExpanded ? null : group.error_text)
                            }
                            className="w-full flex items-start gap-2 text-sm text-slate-700 py-2 px-1 hover:bg-slate-50 rounded text-left"
                          >
                            <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                            <span className="flex-1">{group.error_text}</span>
                            <span className="text-xs text-slate-500">
                              ×{group.occurrences}
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-slate-400" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-400" />
                            )}
                          </button>
                          {isExpanded && (
                            <ExpandedErrorLeads group={group} onClickLead={(id) =>
                              router.push(`/leads/${id}`)
                            } />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            {(data.recent_leads || []).length > 0 && (
              <div className="mt-4 card p-5">
                <h3 className="text-sm font-semibold text-slate-800 mb-3">
                  Leads recientes
                </h3>
                <div className="divide-y divide-slate-100">
                  {(data.recent_leads || []).slice(0, 20).map((l) => (
                    <button
                      key={l.id}
                      onClick={() => router.push(`/leads/${l.id}`)}
                      className="w-full text-left py-2 flex items-center justify-between hover:bg-slate-50 px-2 rounded"
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-900">
                          {l.real_name || l.whatsapp_name || l.phone || '—'}
                        </div>
                        <div className="text-xs text-slate-500">
                          {l.final_status ? l.final_status.replace(/_/g, ' ') : '—'}
                        </div>
                      </div>
                      <div className="text-xs text-slate-500">
                        {l.overall_score != null &&
                          `${toNum(l.overall_score).toFixed(1)}/10`}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
