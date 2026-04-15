'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import type { ErrorsIntel } from '@/types/api';
import PageHeader from '@/components/PageHeader';
import KpiCard from '@/components/KpiCard';
import { ChartCard, ChartBar } from '@/components/Charts';
import { ErrorState } from '@/components/LoadingState';
import { formatNumber, formatPct } from '@/lib/format';
import { AlertTriangle, Clock, MessageSquareDashed, Flame } from 'lucide-react';

export default function ErrorsPage() {
  const [data, setData] = useState<ErrorsIntel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetchApi<ErrorsIntel>('/api/errors');
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

  const totalFollowup =
    (data?.followupStats.withFollowup ?? 0) +
    (data?.followupStats.withoutFollowup ?? 0);
  const followupPct = totalFollowup
    ? (data?.followupStats.withFollowup ?? 0) / totalFollowup
    : 0;

  return (
    <div>
      <PageHeader
        title="Diagnóstico de errores"
        subtitle="Errores operativos detectados en la atención conversacional."
      />

      {loading && <div className="skeleton h-40" />}
      {error && <ErrorState message={error} />}

      {!loading && !error && data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <KpiCard
              label="Con seguimiento"
              value={formatNumber(data.followupStats.withFollowup)}
              sub={`${formatPct(followupPct, 1)} del total`}
              icon={<MessageSquareDashed className="w-5 h-5" />}
              tone="positive"
            />
            <KpiCard
              label="Sin seguimiento"
              value={formatNumber(data.followupStats.withoutFollowup)}
              icon={<AlertTriangle className="w-5 h-5" />}
              tone="warning"
            />
            <KpiCard
              label="Promedio de seguimientos"
              value={formatNumber(Math.round(data.followupStats.avgFollowups))}
              icon={<Clock className="w-5 h-5" />}
            />
            <KpiCard
              label="Perdidos por no seguimiento"
              value={formatNumber(data.followupStats.lostDueToNoFollowup)}
              icon={<Flame className="w-5 h-5" />}
              tone="danger"
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard
              title="Errores más frecuentes"
              subtitle="Conteo por tipo de error"
            >
              <ChartBar
                data={data.topErrors || []}
                xKey="type"
                yKey="count"
                color="#ef4444"
                horizontal
              />
            </ChartCard>
            <ChartCard
              title="Histograma de tiempos de respuesta"
              subtitle="Minutos entre mensaje del cliente y respuesta"
            >
              <ChartBar
                data={data.responseTimeHistogram || []}
                xKey="bucket"
                yKey="count"
                color="#f59e0b"
              />
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
