'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fetchApi } from '@/lib/api';
import type { AdvisorDetail } from '@/types/api';
import PageHeader from '@/components/PageHeader';
import KpiCard from '@/components/KpiCard';
import { ChartCard, ChartBar, ChartLine } from '@/components/Charts';
import { ErrorState } from '@/components/LoadingState';
import { formatCOP, formatNumber, formatPct } from '@/lib/format';
import { ArrowLeft, Check, AlertCircle } from 'lucide-react';

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

      {!loading && !error && data && (
        <>
          <PageHeader
            title={data.name}
            subtitle="Desempeño detallado del asesor"
          />

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <KpiCard label="Score" value={formatPct(data.overallScore, 0)} />
            <KpiCard label="Leads" value={formatNumber(data.leads)} />
            <KpiCard
              label="Conversión"
              value={formatPct(data.conversionRate, 1)}
              tone="positive"
            />
            <KpiCard
              label="Ingreso atribuido"
              value={formatCOP(data.revenueAttributed)}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
            <ChartCard title="Evolución mensual" subtitle="Leads y conversiones">
              <ChartLine
                data={data.monthly || []}
                xKey="month"
                yKey="leads"
                color="#2563eb"
              />
            </ChartCard>
            <ChartCard title="Top proyectos trabajados" subtitle="Por leads">
              <ChartBar
                data={data.topProjects || []}
                xKey="project"
                yKey="leads"
                horizontal
                color="#10b981"
              />
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Fortalezas</h3>
              {(data.strengths || []).length === 0 ? (
                <div className="text-sm text-slate-500">Sin datos.</div>
              ) : (
                <ul className="space-y-2">
                  {(data.strengths || []).map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                      <Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">
                Áreas de mejora
              </h3>
              {(data.weaknesses || []).length === 0 ? (
                <div className="text-sm text-slate-500">Sin datos.</div>
              ) : (
                <ul className="space-y-2">
                  {(data.weaknesses || []).map((w, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                      <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {data.errorsByType && data.errorsByType.length > 0 && (
            <div className="mt-4">
              <ChartCard title="Errores más frecuentes" subtitle="Por tipo">
                <ChartBar
                  data={data.errorsByType}
                  xKey="type"
                  yKey="count"
                  color="#ef4444"
                />
              </ChartCard>
            </div>
          )}
        </>
      )}
    </div>
  );
}
