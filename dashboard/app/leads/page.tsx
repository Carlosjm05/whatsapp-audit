'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, downloadFile } from '@/lib/api';
import type { RecoverableLeadsResponse, RecoverableLead } from '@/types/api';
import PageHeader from '@/components/PageHeader';
import DataTable, { Column } from '@/components/DataTable';
import { ErrorState } from '@/components/LoadingState';
import { formatCOP, formatDate, formatPct, priorityBadge } from '@/lib/format';
import { Download, Filter, Search } from 'lucide-react';
import { useToast } from '@/components/Toast';

export default function LeadsPage() {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<RecoverableLeadsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [priority, setPriority] = useState('');
  const [probability, setProbability] = useState('');
  const [advisor, setAdvisor] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams();
    if (priority) params.set('priority', priority);
    if (probability) params.set('probability', probability);
    if (advisor) params.set('advisor', advisor);
    if (search) params.set('search', search);
    params.set('limit', '500');

    (async () => {
      try {
        const res = await fetchApi<RecoverableLeadsResponse>(
          `/api/leads/recoverable?${params.toString()}`
        );
        if (active) setData(res);
        if (active) setError(null);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Error');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [priority, probability, advisor, search]);

  const advisors = useMemo(() => {
    const set = new Set<string>();
    data?.items?.forEach((l) => l.advisor && set.add(l.advisor));
    return Array.from(set).sort();
  }, [data]);

  const columns: Column<RecoverableLead>[] = [
    {
      key: 'clientName',
      header: 'Cliente',
      accessor: (r) => r.clientName,
      sortable: true,
      render: (r) => (
        <div>
          <div className="font-medium text-slate-900">{r.clientName || '—'}</div>
          <div className="text-xs text-slate-500">{r.phone || ''}</div>
        </div>
      )
    },
    {
      key: 'advisor',
      header: 'Asesor',
      accessor: (r) => r.advisor,
      sortable: true
    },
    {
      key: 'priority',
      header: 'Prioridad',
      accessor: (r) => r.priority,
      sortable: true,
      render: (r) => (
        <span className={`badge ${priorityBadge(r.priority)}`}>
          {r.priority || '—'}
        </span>
      )
    },
    {
      key: 'recoveryProbability',
      header: 'Prob. recuperación',
      accessor: (r) => r.recoveryProbability,
      sortable: true,
      render: (r) => formatPct(r.recoveryProbability, 0)
    },
    {
      key: 'estimatedValue',
      header: 'Valor estimado',
      accessor: (r) => r.estimatedValue,
      sortable: true,
      align: 'right',
      render: (r) => formatCOP(r.estimatedValue)
    },
    {
      key: 'projectInterest',
      header: 'Proyecto',
      accessor: (r) => r.projectInterest,
      sortable: true
    },
    {
      key: 'lastContactAt',
      header: 'Último contacto',
      accessor: (r) => r.lastContactAt,
      sortable: true,
      render: (r) => formatDate(r.lastContactAt)
    }
  ];

  async function onExport() {
    const params = new URLSearchParams();
    params.set('format', 'csv');
    if (priority) params.set('priority', priority);
    if (probability) params.set('probability', probability);
    if (advisor) params.set('advisor', advisor);
    if (search) params.set('search', search);
    try {
      await downloadFile(
        `/api/export/recoverable-leads?${params.toString()}`,
        `leads-recuperables-${new Date().toISOString().slice(0, 10)}.csv`
      );
      toast.success('Exportación iniciada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error exportando');
    }
  }

  return (
    <div>
      <PageHeader
        title="Leads recuperables"
        subtitle="Oportunidades con alta probabilidad de retomarse y cerrar venta."
        actions={
          <button onClick={onExport} className="btn-outline">
            <Download className="w-4 h-4" /> Exportar CSV
          </button>
        }
      />

      <div className="card p-4 mb-4">
        <div className="flex items-center gap-2 text-sm text-slate-600 mb-3">
          <Filter className="w-4 h-4" /> Filtros
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Prioridad</label>
            <select
              className="input"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="">Todas</option>
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>
          </div>
          <div>
            <label className="label">Probabilidad mínima</label>
            <select
              className="input"
              value={probability}
              onChange={(e) => setProbability(e.target.value)}
            >
              <option value="">Cualquiera</option>
              <option value="70">≥ 70%</option>
              <option value="50">≥ 50%</option>
              <option value="30">≥ 30%</option>
            </select>
          </div>
          <div>
            <label className="label">Asesor</label>
            <select
              className="input"
              value={advisor}
              onChange={(e) => setAdvisor(e.target.value)}
            >
              <option value="">Todos</option>
              {advisors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Búsqueda</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="input pl-9"
                placeholder="Nombre, teléfono, proyecto…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="card p-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-8" />
          ))}
        </div>
      )}
      {error && <ErrorState message={error} />}
      {!loading && !error && (
        <>
          <div className="mb-2 text-sm text-slate-500">
            {(data?.items?.length ?? 0)} resultado
            {(data?.items?.length ?? 0) === 1 ? '' : 's'}
            {data?.total != null && ` de ${data.total}`}
          </div>
          <DataTable
            columns={columns}
            rows={data?.items || []}
            onRowClick={(r) => router.push(`/leads/${r.id}`)}
            initialSortKey="recoveryProbability"
            initialSortDir="desc"
            empty="No se encontraron leads recuperables con los filtros aplicados."
          />
        </>
      )}
    </div>
  );
}
