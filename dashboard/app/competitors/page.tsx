'use client';

import { useEffect, useState } from 'react';
import { fetchApi, safeArray } from '@/lib/api';
import type { CompetitorsIntel } from '@/types/api';
import PageHeader from '@/components/PageHeader';
import DataTable, { Column } from '@/components/DataTable';
import { ChartCard, ChartBar } from '@/components/Charts';
import { ErrorState } from '@/components/LoadingState';
import { formatNumber } from '@/lib/format';
import { Swords } from 'lucide-react';

interface CompetitorRow {
  [key: string]: unknown;
  competitor_name: string;
  mentions: number;
  lost_to_competitor: number;
}

function humanize(v?: string): string {
  return (v || '').replace(/_/g, ' ');
}

export default function CompetitorsPage() {
  const [data, setData] = useState<CompetitorsIntel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetchApi<CompetitorsIntel>('/api/competitors');
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

  const columns: Column<CompetitorRow>[] = [
    {
      key: 'competitor_name',
      header: 'Competidor',
      accessor: (r) => r.competitor_name,
      sortable: true
    },
    {
      key: 'mentions',
      header: 'Menciones',
      accessor: (r) => r.mentions,
      sortable: true,
      align: 'right',
      render: (r) => formatNumber(r.mentions)
    },
    {
      key: 'lost_to_competitor',
      header: 'Leads perdidos',
      accessor: (r) => r.lost_to_competitor,
      sortable: true,
      align: 'right',
      render: (r) => formatNumber(r.lost_to_competitor)
    }
  ];

  const topCompetitors = safeArray<CompetitorRow>(data?.top_competitors);
  const reasonsConsidering = safeArray<{ reason: string; count: number }>(
    data?.top_reasons_considering
  );
  const lossReasons = safeArray<{ loss_reason: string; count: number }>(
    data?.loss_reasons
  ).map((r) => ({ ...r, loss_reason: humanize(r.loss_reason) }));

  const totalSignals =
    topCompetitors.length + reasonsConsidering.length + lossReasons.length;

  return (
    <div>
      <PageHeader
        title="Competencia"
        subtitle="Competidores mencionados por los leads, razones para considerarlos y motivos de pérdida."
      />

      {loading && <div className="skeleton h-40" />}
      {error && <ErrorState message={error} />}

      {!loading && !error && totalSignals === 0 && (
        <div className="card p-10 text-center">
          <Swords className="w-10 h-10 mx-auto text-slate-400 mb-3" />
          <div className="text-slate-700 font-medium mb-2">
            No se detectó mención de competidores en las conversaciones analizadas.
          </div>
          <div className="text-xs text-slate-500 max-w-md mx-auto">
            Esta vista se llena cuando el analyzer identifica que un lead
            mencionó a un competidor concreto. Si todos tus leads vinieron a
            ti sin comparar con otros, esto está bien — significa que la
            competencia no aparece en las conversaciones.
          </div>
        </div>
      )}

      {!loading && !error && totalSignals > 0 && (
        <>
          {topCompetitors.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">
                Top competidores mencionados
              </h3>
              <DataTable
                columns={columns}
                rows={topCompetitors}
                initialSortKey="mentions"
                initialSortDir="desc"
                empty="Sin menciones a competidores."
              />
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {reasonsConsidering.length > 0 && (
              <ChartCard
                title="Razones para considerar competencia"
                subtitle="Lo que atrae al lead hacia otros"
              >
                <ChartBar
                  data={reasonsConsidering.slice(0, 15)}
                  xKey="reason"
                  yKey="count"
                  color="#f59e0b"
                  horizontal
                />
              </ChartCard>
            )}

            {lossReasons.length > 0 && (
              <ChartCard
                title="Razones de pérdida ante competencia"
                subtitle="Por qué el lead escogió al competidor"
              >
                <ChartBar
                  data={lossReasons.slice(0, 15)}
                  xKey="loss_reason"
                  yKey="count"
                  color="#ef4444"
                  horizontal
                />
              </ChartCard>
            )}
          </div>
        </>
      )}
    </div>
  );
}
