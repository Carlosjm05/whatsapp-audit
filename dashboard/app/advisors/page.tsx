'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi } from '@/lib/api';
import type { AdvisorRanking } from '@/types/api';
import PageHeader from '@/components/PageHeader';
import DataTable, { Column } from '@/components/DataTable';
import { ErrorState } from '@/components/LoadingState';
import { formatNumber } from '@/lib/format';
import { Trophy, Clock, RefreshCcw } from 'lucide-react';

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function conversionPct(r: AdvisorRanking): number {
  const total = toNum(r.total_leads);
  if (total === 0) return 0;
  return (toNum(r.sold) / total) * 100;
}

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

  const top3 = [...rows]
    .sort((a, b) => toNum(b.avg_overall_score) - toNum(a.avg_overall_score))
    .slice(0, 3);

  const columns: Column<AdvisorRanking>[] = [
    {
      key: 'advisor_name',
      header: 'Asesor',
      accessor: (r) => r.advisor_name,
      sortable: true
    },
    {
      key: 'avg_overall_score',
      header: 'Score',
      accessor: (r) => toNum(r.avg_overall_score),
      sortable: true,
      render: (r) =>
        r.avg_overall_score != null
          ? `${toNum(r.avg_overall_score).toFixed(1)} / 10`
          : '—'
    },
    {
      key: 'total_leads',
      header: 'Leads',
      accessor: (r) => toNum(r.total_leads),
      sortable: true,
      render: (r) => formatNumber(r.total_leads)
    },
    {
      key: 'sold',
      header: 'Ventas cerradas',
      accessor: (r) => toNum(r.sold),
      sortable: true,
      render: (r) => formatNumber(r.sold)
    },
    {
      key: 'recoverable',
      header: 'Recuperables',
      accessor: (r) => toNum(r.recoverable),
      sortable: true,
      render: (r) => formatNumber(r.recoverable)
    },
    {
      key: 'conversion',
      header: 'Conversión',
      accessor: (r) => conversionPct(r),
      sortable: true,
      render: (r) => `${conversionPct(r).toFixed(1)}%`
    },
    {
      key: 'avg_first_response_minutes',
      header: 'T. 1er resp. (min)',
      accessor: (r) => toNum(r.avg_first_response_minutes),
      sortable: true,
      align: 'right',
      render: (r) =>
        r.avg_first_response_minutes != null
          ? formatNumber(Math.round(toNum(r.avg_first_response_minutes)))
          : '—'
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
              <div key={a.advisor_name} className="card p-5">
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
                  <div className="font-semibold text-slate-900 truncate">
                    {a.advisor_name}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-slate-500">Score</div>
                    <div className="font-semibold text-slate-900">
                      {a.avg_overall_score != null
                        ? `${toNum(a.avg_overall_score).toFixed(1)}/10`
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Leads</div>
                    <div className="font-semibold text-slate-900">
                      {formatNumber(a.total_leads)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Resp.
                    </div>
                    <div className="font-semibold text-slate-900">
                      {a.avg_first_response_minutes != null
                        ? `${formatNumber(Math.round(toNum(a.avg_first_response_minutes)))}m`
                        : '—'}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-1 text-xs text-emerald-700">
                  <RefreshCcw className="w-3 h-3" /> {formatNumber(a.sold)} ventas · {formatNumber(a.recoverable)} recuperables
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
            onRowClick={(r) =>
              router.push(`/advisors/${encodeURIComponent(r.advisor_name)}`)
            }
            initialSortKey="avg_overall_score"
            initialSortDir="desc"
            empty="No hay datos de asesores."
          />
        </>
      )}
    </div>
  );
}
