'use client';

import { useEffect, useState } from 'react';
import { fetchApi, safeArray } from '@/lib/api';
import type { ErrorsOverview } from '@/types/api';
import PageHeader from '@/components/PageHeader';
import KpiCard from '@/components/KpiCard';
import { ChartCard, ChartBar } from '@/components/Charts';
import { ErrorState } from '@/components/LoadingState';
import { formatNumber } from '@/lib/format';
import { AlertTriangle, Clock, Flame, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function ErrorsPage() {
  const router = useRouter();
  const [data, setData] = useState<ErrorsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetchApi<ErrorsOverview>('/api/errors');
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
  }, []);

  const topErrors = safeArray<{ error_text: string; count: number }>(data?.top_errors);
  const advisorsBad = safeArray<{
    advisor_name: string;
    total_errors: number;
    total_leads: number;
    avg_overall_score: number | string | null;
  }>(data?.advisors_with_most_errors);

  const rt = data?.response_time_stats || {};
  const pctNoFollowup = data?.pct_without_followup;

  const hasAnyData = topErrors.length > 0 || advisorsBad.length > 0 || rt.avg_first_response_minutes != null;

  return (
    <div>
      <PageHeader
        title="Diagnóstico de errores"
        subtitle="Errores operativos detectados en la atención. Patrones que se repiten y asesores con más fallas."
      />

      {loading && <div className="skeleton h-40" />}
      {error && <ErrorState message={error} />}

      {!loading && !error && !hasAnyData && (
        <div className="card p-10 text-center">
          <div className="text-slate-600 mb-2">
            Todavía no hay suficientes datos para el diagnóstico.
          </div>
          <div className="text-xs text-slate-500">
            Esta vista se llena cuando el analyzer detecta errores de asesor
            o mide tiempos de respuesta.
          </div>
        </div>
      )}

      {!loading && !error && hasAnyData && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <KpiCard
              label="1ra resp. promedio"
              value={
                rt.avg_first_response_minutes != null
                  ? `${Math.round(toNum(rt.avg_first_response_minutes))} min`
                  : '—'
              }
              sub="Tiempo en responder primer mensaje"
              icon={<Clock className="w-5 h-5" />}
            />
            <KpiCard
              label="1ra resp. P95"
              value={
                rt.p95_first_response_minutes != null
                  ? `${Math.round(toNum(rt.p95_first_response_minutes))} min`
                  : '—'
              }
              sub="95% de respuestas bajo este tiempo"
              icon={<AlertTriangle className="w-5 h-5" />}
              tone="warning"
            />
            <KpiCard
              label="% sin seguimiento"
              value={
                pctNoFollowup != null ? `${pctNoFollowup.toFixed(1)}%` : '—'
              }
              sub="Leads sin mensaje de seguimiento"
              icon={<Flame className="w-5 h-5" />}
              tone={pctNoFollowup != null && pctNoFollowup > 30 ? 'danger' : 'warning'}
            />
            <KpiCard
              label="Brecha máxima promedio"
              value={
                rt.avg_longest_gap_hours != null
                  ? `${toNum(rt.avg_longest_gap_hours).toFixed(1)}h`
                  : '—'
              }
              sub="Silencio más largo en las conv."
              icon={<Users className="w-5 h-5" />}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
            <ChartCard
              title="Errores más frecuentes"
              subtitle="Patrones detectados en advisor_scores"
            >
              {topErrors.length > 0 ? (
                <ChartBar
                  data={topErrors.slice(0, 15)}
                  xKey="error_text"
                  yKey="count"
                  color="#ef4444"
                  horizontal
                />
              ) : (
                <div className="flex items-center justify-center h-40 text-xs text-slate-400">
                  Sin errores registrados todavía.
                </div>
              )}
            </ChartCard>

            <ChartCard
              title="Asesores con más errores"
              subtitle="Total de errores acumulados"
            >
              {advisorsBad.length > 0 ? (
                <ChartBar
                  data={advisorsBad.slice(0, 10)}
                  xKey="advisor_name"
                  yKey="total_errors"
                  color="#f59e0b"
                  horizontal
                />
              ) : (
                <div className="flex items-center justify-center h-40 text-xs text-slate-400">
                  Sin datos de asesores todavía.
                </div>
              )}
            </ChartCard>
          </div>

          {advisorsBad.length > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">
                Desglose por asesor
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Asesor</th>
                      <th className="px-4 py-2 text-right">Errores totales</th>
                      <th className="px-4 py-2 text-right">Leads atendidos</th>
                      <th className="px-4 py-2 text-right">Score promedio</th>
                      <th className="px-4 py-2 text-right">Errores / lead</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {advisorsBad.map((a) => {
                      const rate =
                        a.total_leads > 0 ? a.total_errors / a.total_leads : 0;
                      return (
                        <tr
                          key={a.advisor_name}
                          className="hover:bg-slate-50 cursor-pointer"
                          onClick={() =>
                            router.push(
                              `/advisors/${encodeURIComponent(a.advisor_name)}`
                            )
                          }
                        >
                          <td className="px-4 py-3 font-medium">{a.advisor_name}</td>
                          <td className="px-4 py-3 text-right">
                            {formatNumber(a.total_errors)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-500">
                            {formatNumber(a.total_leads)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {a.avg_overall_score != null
                              ? `${toNum(a.avg_overall_score).toFixed(1)}/10`
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700">
                            {rate.toFixed(1)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
