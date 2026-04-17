'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fetchApi } from '@/lib/api';
import type { AdvisorDetail } from '@/types/api';
import PageHeader from '@/components/PageHeader';
import KpiCard from '@/components/KpiCard';
import { ChartCard, ChartBar, ChartPie } from '@/components/Charts';
import { ErrorState } from '@/components/LoadingState';
import { formatNumber } from '@/lib/format';
import { ArrowLeft, Check, AlertCircle } from 'lucide-react';

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function AdvisorDetailPage() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const name = decodeURIComponent((params?.name as string) || '');
  const [data, setData] = useState<AdvisorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetchApi<AdvisorDetail>(
          `/api/advisors/${encodeURIComponent(name)}`
        );
        if (active) setData(res);
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
                </h3>
                {(data.common_errors || []).length === 0 ? (
                  <div className="text-sm text-slate-500">Sin datos.</div>
                ) : (
                  <ul className="space-y-2">
                    {(data.common_errors || []).map((item, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm text-slate-700"
                      >
                        <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                        <span className="flex-1">{item.text}</span>
                        <span className="text-xs text-slate-500">×{item.count}</span>
                      </li>
                    ))}
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
