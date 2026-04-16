'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi } from '@/lib/api';
import type { AdvisorRanking } from '@/types/api';
import PageHeader from '@/components/PageHeader';
import DataTable, { Column } from '@/components/DataTable';
import { ErrorState } from '@/components/LoadingState';
import { formatCOP, formatNumber, formatPct } from '@/lib/format';
import { Trophy, Clock, RefreshCcw } from 'lucide-react';

export default function AdvisorsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<AdvisorRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetchApi<AdvisorRanking[] | { items: AdvisorRanking[] }>(
          '/api/advisors'
        );
        const list = Array.isArray(res) ? res : res.items || [];
        if (active) setRows(list);
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

  const top3 = [...rows].sort((a, b) => b.overallScore - a.overallScore).slice(0, 3);

  const columns: Column<AdvisorRanking>[] = [
    { key: 'name', header: 'Asesor', accessor: (r) => r.name, sortable: true },
    {
      key: 'overallScore',
      header: 'Score',
      accessor: (r) => r.overallScore,
      sortable: true,
      render: (r) => formatPct(r.overallScore, 0)
    },
    {
      key: 'conversations',
      header: 'Conversaciones',
      accessor: (r) => r.conversations,
      sortable: true,
      render: (r) => formatNumber(r.conversations)
    },
    {
      key: 'leads',
      header: 'Leads',
      accessor: (r) => r.leads,
      sortable: true,
      render: (r) => formatNumber(r.leads)
    },
    {
      key: 'conversionRate',
      header: 'Conversión',
      accessor: (r) => r.conversionRate,
      sortable: true,
      render: (r) => formatPct(r.conversionRate, 1)
    },
    {
      key: 'avgResponseTimeMin',
      header: 'T. respuesta (min)',
      accessor: (r) => r.avgResponseTimeMin,
      sortable: true,
      render: (r) => formatNumber(Math.round(r.avgResponseTimeMin || 0))
    },
    {
      key: 'followupRate',
      header: 'Seguimiento',
      accessor: (r) => r.followupRate,
      sortable: true,
      render: (r) => formatPct(r.followupRate, 0)
    },
    {
      key: 'revenueAttributed',
      header: 'Ingreso atribuido',
      accessor: (r) => r.revenueAttributed,
      sortable: true,
      align: 'right',
      render: (r) => formatCOP(r.revenueAttributed)
    }
  ];

  return (
    <div>
      <PageHeader
        title="Desempeño de asesores"
        subtitle="Ranking, tiempos de respuesta y efectividad por asesor."
      />

      {loading && <div className="skeleton h-40 mb-4" />}
      {error && <ErrorState message={error} />}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {top3.map((a, i) => (
              <div key={a.name} className="card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold ${
                      i === 0
                        ? 'bg-amber-500'
                        : i === 1
                        ? 'bg-slate-400'
                        : 'bg-orange-700'
                    }`}
                  >
                    {i + 1}
                  </div>
                  <Trophy className="w-4 h-4 text-amber-500" />
                  <div className="font-semibold text-slate-900 truncate">{a.name}</div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-slate-500">Score</div>
                    <div className="font-semibold text-slate-900">
                      {formatPct(a.overallScore, 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Leads</div>
                    <div className="font-semibold text-slate-900">
                      {formatNumber(a.leads)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Resp.
                    </div>
                    <div className="font-semibold text-slate-900">
                      {formatNumber(Math.round(a.avgResponseTimeMin || 0))}m
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-1 text-xs text-emerald-700">
                  <RefreshCcw className="w-3 h-3" /> Seguimiento {formatPct(a.followupRate, 0)}
                </div>
              </div>
            ))}
            {top3.length === 0 && (
              <div className="md:col-span-3 card p-6 text-sm text-slate-500 text-center">
                Sin asesores registrados.
              </div>
            )}
          </div>

          <DataTable
            columns={columns}
            rows={rows}
            onRowClick={(r) => router.push(`/advisors/${encodeURIComponent(r.name)}`)}
            initialSortKey="overallScore"
            initialSortDir="desc"
            empty="No hay datos de asesores."
          />
        </>
      )}
    </div>
  );
}
