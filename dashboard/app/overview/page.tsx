'use client';

import { useEffect, useState } from 'react';
import { fetchApi, safeArray } from '@/lib/api';
import type { OverviewResponse, FunnelStage, StatusBucket, MonthlyVolume } from '@/types/api';
import KpiCard from '@/components/KpiCard';
import PageHeader from '@/components/PageHeader';
import {
  ChartCard,
  ChartBar,
  ChartLine,
  ChartPie,
  ChartFunnel
} from '@/components/Charts';
import { KpiSkeletonGrid, ErrorState } from '@/components/LoadingState';
import { formatCOP, formatNumber } from '@/lib/format';
import {
  MessageSquare,
  Users,
  Sparkles,
  PiggyBank,
  TrendingUp,
  UserCheck
} from 'lucide-react';

export default function OverviewPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetchApi<OverviewResponse>('/api/overview');
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

  return (
    <div>
      <PageHeader
        title="Vista general"
        subtitle="Resumen ejecutivo de auditoría conversacional y pipeline comercial."
      />

      {loading && <KpiSkeletonGrid count={6} />}
      {error && <ErrorState message={error} />}

      {!loading && !error && data && (() => {
        // El API devuelve funnel como objeto {contactado, calificado,
        // visita, venta}; los Charts esperan array [{stage, count}].
        const funnelRaw = data.funnel;
        const funnel: FunnelStage[] = funnelRaw && typeof funnelRaw === 'object'
          ? Object.entries(funnelRaw)
              .filter(([, v]) => typeof v === 'number')
              .map(([stage, count]) => ({ stage, count: count as number }))
          : [];
        const statusDist = safeArray<StatusBucket>(data.status_distribution);
        const monthly = safeArray<MonthlyVolume>(data.monthly_volume);
        return <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <KpiCard
              label="Conversaciones analizadas"
              value={formatNumber(data.total_conversations ?? 0)}
              icon={<MessageSquare className="w-5 h-5" />}
            />
            <KpiCard
              label="Leads identificados"
              value={formatNumber(data.total_leads ?? 0)}
              icon={<Users className="w-5 h-5" />}
              tone="positive"
            />
            <KpiCard
              label="Leads recuperables"
              value={formatNumber(data.recoverable_count ?? 0)}
              sub="Oportunidades activas a retomar"
              icon={<TrendingUp className="w-5 h-5" />}
              tone="warning"
            />
            <KpiCard
              label="Valor estimado recuperable"
              value={formatCOP(data.total_recoverable_estimated_value ?? 0)}
              icon={<PiggyBank className="w-5 h-5" />}
              tone="positive"
            />
            <KpiCard
              label="Intención promedio"
              value={`${formatNumber(data.avg_intent_score ?? 0, 1)} / 10`}
              sub="Score 1-10 de intención de compra"
              icon={<Sparkles className="w-5 h-5" />}
            />
            <KpiCard
              label="Score promedio asesor"
              value={`${formatNumber(data.avg_advisor_score ?? 0, 1)} / 10`}
              sub="Calidad ponderada de atención"
              icon={<UserCheck className="w-5 h-5" />}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-6">
            <ChartCard
              title="Embudo de conversión"
              subtitle="Progreso de conversaciones por etapa comercial"
            >
              <ChartFunnel
                data={funnel}
                nameKey="stage"
                valueKey="count"
              />
            </ChartCard>

            <ChartCard
              title="Distribución por estado"
              subtitle="Estados actuales del pipeline"
            >
              <ChartPie
                data={statusDist}
                nameKey="final_status"
                valueKey="count"
              />
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-4 mt-4">
            <ChartCard
              title="Volumen mensual de conversaciones"
              subtitle="Últimos meses"
              height={300}
            >
              <ChartLine
                data={monthly}
                xKey="month"
                yKey="count"
              />
            </ChartCard>
          </div>

          <div className="mt-4">
            <ChartCard
              title="Estados (barras)"
              subtitle="Volumen por estado"
              height={280}
            >
              <ChartBar
                data={statusDist}
                xKey="final_status"
                yKey="count"
                color="#2563eb"
              />
            </ChartCard>
          </div>
        </>;
      })()}
    </div>
  );
}
