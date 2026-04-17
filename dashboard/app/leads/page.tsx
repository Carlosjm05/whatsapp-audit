'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, downloadFile } from '@/lib/api';
import type { RecoverableLeadsResponse, RecoverableLead } from '@/types/api';
import PageHeader from '@/components/PageHeader';
import DataTable, { Column } from '@/components/DataTable';
import { ErrorState } from '@/components/LoadingState';
import { formatCOP, formatDate } from '@/lib/format';
import { Download, Filter, Search } from 'lucide-react';
import { useToast } from '@/components/Toast';

function displayName(r: RecoverableLead): string {
  return (
    (r.real_name as string) ||
    (r.whatsapp_name as string) ||
    (r.phone as string) ||
    '—'
  );
}

function probabilityBadge(p?: string): string {
  if (p === 'alta') return 'bg-emerald-100 text-emerald-800';
  if (p === 'media') return 'bg-amber-100 text-amber-800';
  if (p === 'baja') return 'bg-rose-100 text-rose-800';
  return 'bg-slate-100 text-slate-700';
}

function priorityBadgeClass(p?: string): string {
  if (p === 'esta_semana') return 'bg-rose-100 text-rose-800';
  if (p === 'este_mes') return 'bg-amber-100 text-amber-800';
  if (p === 'puede_esperar') return 'bg-slate-100 text-slate-700';
  return 'bg-slate-100 text-slate-500';
}

function humanize(v?: string): string {
  return (v || '').replace(/_/g, ' ');
}

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

    const timer = setTimeout(() => {
      (async () => {
        try {
          const res = await fetchApi<RecoverableLeadsResponse>(
            `/api/leads/recoverable?${params.toString()}`
          );
          if (active) {
            setData(res);
            setError(null);
          }
        } catch (err) {
          if (active) setError(err instanceof Error ? err.message : 'Error');
        } finally {
          if (active) setLoading(false);
        }
      })();
    }, 300); // debounce

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [priority, probability, advisor, search]);

  const advisors = useMemo(() => {
    const set = new Set<string>();
    data?.rows?.forEach((l) => {
      if (l.advisor_name) set.add(l.advisor_name as string);
    });
    return Array.from(set).sort();
  }, [data]);

  const columns: Column<RecoverableLead>[] = [
    {
      key: 'cliente',
      header: 'Cliente',
      accessor: (r) => displayName(r),
      sortable: true,
      render: (r) => (
        <div>
          <div className="font-medium text-slate-900">{displayName(r)}</div>
          <div className="text-xs text-slate-500">{(r.phone as string) || ''}</div>
        </div>
      )
    },
    {
      key: 'advisor_name',
      header: 'Asesor',
      accessor: (r) => r.advisor_name ?? '',
      sortable: true,
      render: (r) => (r.advisor_name as string) || '—'
    },
    {
      key: 'recovery_priority',
      header: 'Prioridad',
      accessor: (r) => r.recovery_priority ?? '',
      sortable: true,
      render: (r) => (
        <span className={`badge ${priorityBadgeClass(r.recovery_priority as string)}`}>
          {humanize(r.recovery_priority as string) || '—'}
        </span>
      )
    },
    {
      key: 'recovery_probability',
      header: 'Probabilidad',
      accessor: (r) => r.recovery_probability ?? '',
      sortable: true,
      render: (r) => (
        <span className={`badge ${probabilityBadge(r.recovery_probability as string)}`}>
          {(r.recovery_probability as string) || '—'}
        </span>
      )
    },
    {
      key: 'intent_score',
      header: 'Intención',
      accessor: (r) => Number(r.intent_score) || 0,
      sortable: true,
      render: (r) =>
        r.intent_score !== undefined && r.intent_score !== null
          ? `${r.intent_score}/10`
          : '—'
    },
    {
      key: 'budget_estimated_cop',
      header: 'Presupuesto',
      accessor: (r) => Number(r.budget_estimated_cop) || 0,
      sortable: true,
      align: 'right',
      render: (r) => formatCOP(r.budget_estimated_cop as number | string | undefined)
    },
    {
      key: 'project_name',
      header: 'Proyecto',
      accessor: (r) => r.project_name ?? '',
      sortable: true,
      render: (r) => (r.project_name as string) || '—'
    },
    {
      key: 'last_contact_at',
      header: 'Último contacto',
      accessor: (r) => r.last_contact_at ?? '',
      sortable: true,
      render: (r) => formatDate(r.last_contact_at as string | undefined)
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

  const total = data?.total ?? 0;
  const shown = data?.rows?.length ?? 0;

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
            <label htmlFor="flt-priority" className="label">Prioridad</label>
            <select
              id="flt-priority"
              className="input"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="">Todas</option>
              <option value="esta_semana">Esta semana</option>
              <option value="este_mes">Este mes</option>
              <option value="puede_esperar">Puede esperar</option>
            </select>
          </div>
          <div>
            <label htmlFor="flt-prob" className="label">Probabilidad</label>
            <select
              id="flt-prob"
              className="input"
              value={probability}
              onChange={(e) => setProbability(e.target.value)}
            >
              <option value="">Cualquiera</option>
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>
          </div>
          <div>
            <label htmlFor="flt-advisor" className="label">Asesor</label>
            <select
              id="flt-advisor"
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
            <label htmlFor="flt-search" className="label">Búsqueda</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="flt-search"
                className="input pl-9"
                placeholder="Nombre, teléfono…"
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
            {shown} resultado{shown === 1 ? '' : 's'}
            {total > shown && ` de ${total}`}
          </div>
          <DataTable
            columns={columns}
            rows={data?.rows || []}
            onRowClick={(r) => router.push(`/leads/${r.id}`)}
            initialSortKey="recovery_priority"
            initialSortDir="asc"
            empty="No se encontraron leads recuperables con los filtros aplicados."
          />
        </>
      )}
    </div>
  );
}
