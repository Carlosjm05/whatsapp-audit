'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import type { CompetitorsIntel } from '@/types/api';
import PageHeader from '@/components/PageHeader';
import DataTable, { Column } from '@/components/DataTable';
import { ChartCard, ChartBar } from '@/components/Charts';
import { ErrorState } from '@/components/LoadingState';
import { formatNumber } from '@/lib/format';

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

  const columns: Column<{ name: string; mentions: number; lostDeals: number } & Record<string, unknown>>[] = [
    { key: 'name', header: 'Competidor', accessor: (r) => r.name, sortable: true },
    {
      key: 'mentions',
      header: 'Menciones',
      accessor: (r) => r.mentions,
      sortable: true,
      render: (r) => formatNumber(r.mentions)
    },
    {
      key: 'lostDeals',
      header: 'Negocios perdidos',
      accessor: (r) => r.lostDeals,
      sortable: true,
      render: (r) => formatNumber(r.lostDeals)
    }
  ];

  return (
    <div>
      <PageHeader
        title="Competencia"
        subtitle="Menciones a competidores y razones de pérdida de negocios."
      />

      {loading && <div className="skeleton h-40" />}
      {error && <ErrorState message={error} />}

      {!loading && !error && data && (
        <>
          <div className="mb-6">
            <DataTable
              columns={columns}
              rows={
                (data.topCompetitors || []) as Array<
                  { name: string; mentions: number; lostDeals: number } & Record<string, unknown>
                >
              }
              initialSortKey="mentions"
              initialSortDir="desc"
              empty="Sin menciones a competidores."
            />
          </div>

          <ChartCard title="Razones de pérdida" subtitle="Motivos identificados">
            <ChartBar
              data={data.lossReasons || []}
              xKey="reason"
              yKey="count"
              color="#ef4444"
              horizontal
            />
          </ChartCard>
        </>
      )}
    </div>
  );
}
