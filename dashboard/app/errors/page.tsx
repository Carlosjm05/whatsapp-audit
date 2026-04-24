'use client';

import { useEffect, useState } from 'react';
import { fetchApi, safeArray } from '@/lib/api';
import type { ErrorsOverview } from '@/types/api';
import PageHeader from '@/components/PageHeader';
import KpiCard from '@/components/KpiCard';
import { ChartCard, ChartBar } from '@/components/Charts';
import { ErrorState } from '@/components/LoadingState';
import { formatNumber } from '@/lib/format';
import { AlertTriangle, Clock, Flame, Users, CalendarDays, Info } from 'lucide-react';
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
          {/* Banner explicativo del horario laboral */}
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 mb-4 flex items-start gap-3 text-sm text-sky-900">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <strong>Horario de medición:</strong> los tiempos se calculan solo en horario laboral
              <strong> (Lun–Sáb 7:00–19:00)</strong>. Mensajes recibidos fuera de ese rango no penalizan
              al asesor. Domingos se reportan en una métrica separada abajo.
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <KpiCard
              label="1ra resp. promedio"
              value={
                rt.avg_first_response_minutes != null
                  ? `${Math.round(toNum(rt.avg_first_response_minutes))} min`
                  : '—'
              }
              sub="Solo horario laboral"
              icon={<Clock className="w-5 h-5" />}
            />
            <KpiCard
              label="1ra resp. P95"
              value={
                rt.p95_first_response_minutes != null
                  ? `${Math.round(toNum(rt.p95_first_response_minutes))} min`
                  : '—'
              }
              sub="95% bajo este tiempo"
              icon={<AlertTriangle className="w-5 h-5" />}
              tone="warning"
            />
            <KpiCard
              label="% sin seguimiento"
              value={
                pctNoFollowup != null ? `${toNum(pctNoFollowup).toFixed(1)}%` : '—'
              }
              sub="Leads sin mensaje de seguimiento"
              icon={<Flame className="w-5 h-5" />}
              tone={pctNoFollowup != null && toNum(pctNoFollowup) > 30 ? 'danger' : 'warning'}
            />
            <KpiCard
              label="Brecha máxima prom."
              value={
                rt.avg_longest_gap_hours != null
                  ? `${toNum(rt.avg_longest_gap_hours).toFixed(1)}h`
                  : '—'
              }
              sub="Silencio más largo"
              icon={<Users className="w-5 h-5" />}
            />
          </div>

          {/* Card específica de domingo (separada del SLA) */}
          {(rt.sunday_total_responses != null && toNum(rt.sunday_total_responses) > 0) && (
            <div className="card p-5 mb-6 bg-violet-50/50 ring-1 ring-violet-200">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center">
                  <CalendarDays className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Actividad de domingo</h3>
                  <p className="text-xs text-slate-600">
                    Métrica separada — no entra al SLA, es solo para ver si el asesor atiende fuera de horario.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-white ring-1 ring-violet-200 p-3">
                  <div className="text-[11px] uppercase text-slate-500 mb-1">Tiempo prom. domingo</div>
                  <div className="text-2xl font-bold text-violet-700">
                    {rt.sunday_avg_minutes != null
                      ? `${Math.round(toNum(rt.sunday_avg_minutes))} min`
                      : '—'}
                  </div>
                </div>
                <div className="rounded-lg bg-white ring-1 ring-violet-200 p-3">
                  <div className="text-[11px] uppercase text-slate-500 mb-1">Respuestas en domingo</div>
                  <div className="text-2xl font-bold text-slate-800">
                    {formatNumber(toNum(rt.sunday_total_responses))}
                  </div>
                </div>
                <div className="rounded-lg bg-white ring-1 ring-violet-200 p-3">
                  <div className="text-[11px] uppercase text-slate-500 mb-1">Leads activos en domingo</div>
                  <div className="text-2xl font-bold text-slate-800">
                    {formatNumber(toNum(rt.leads_with_sunday_activity))}
                  </div>
                </div>
              </div>
            </div>
          )}

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
