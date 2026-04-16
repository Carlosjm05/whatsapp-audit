'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, safeArray } from '@/lib/api';
import PageHeader from '@/components/PageHeader';
import DataTable, { Column } from '@/components/DataTable';
import { ErrorState } from '@/components/LoadingState';
import { formatCOP, formatDate } from '@/lib/format';
import { Search, Filter, X, Bookmark } from 'lucide-react';
import type { RecoverableLead } from '@/types/api';
import { useToast } from '@/components/Toast';

interface SearchResponse {
  total: number;
  limit: number;
  offset: number;
  rows: RecoverableLead[];
}

interface Filters {
  q: string;
  min_intent: string;
  max_intent: string;
  budget_range: string;
  urgency: string;
  final_status: string;
  advisor: string;
  recovery_probability: string;
  lead_source: string;
  product_type: string;
  has_unresolved_objections: string;
  mentioned_competitors: string;
  from_date: string;
  to_date: string;
}

const INITIAL: Filters = {
  q: '',
  min_intent: '',
  max_intent: '',
  budget_range: '',
  urgency: '',
  final_status: '',
  advisor: '',
  recovery_probability: '',
  lead_source: '',
  product_type: '',
  has_unresolved_objections: '',
  mentioned_competitors: '',
  from_date: '',
  to_date: '',
};

const BUDGETS = ['menos_50m', '50_100m', '100_200m', '200_500m', 'mas_500m', 'no_especificado'];
const URGENCIES = ['comprar_ya', '1_3_meses', '3_6_meses', 'mas_6_meses', 'no_sabe', 'no_especificado'];
const STATUSES = [
  'venta_cerrada', 'visita_agendada', 'negociacion_activa',
  'seguimiento_activo', 'se_enfrio', 'ghosteado_por_asesor',
  'ghosteado_por_lead', 'descalificado', 'nunca_calificado',
];
const PROBS = ['alta', 'media', 'baja', 'no_aplica'];
const SOURCES = ['anuncio_facebook', 'anuncio_instagram', 'google_ads', 'referido', 'busqueda_organica', 'portal_inmobiliario', 'otro', 'desconocido'];
const PRODUCTS = ['lote', 'arriendo', 'compra_inmueble', 'inversion', 'local_comercial', 'bodega', 'finca', 'otro'];

function Select({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <div>
      <label className="label text-xs">{label}</label>
      <select className="input text-sm" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Todos</option>
        {options.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
      </select>
    </div>
  );
}

function YesNoSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label text-xs">{label}</label>
      <select className="input text-sm" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Indiferente</option>
        <option value="true">Sí</option>
        <option value="false">No</option>
      </select>
    </div>
  );
}

export default function SearchPage() {
  const router = useRouter();
  const toast = useToast();
  const [filters, setFilters] = useState<Filters>(INITIAL);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedViews, setSavedViews] = useState<{ name: string; filters: Filters }[]>([]);
  const [showFilters, setShowFilters] = useState(true);
  // Modal inline para nombrar vista guardada (reemplaza prompt() nativo).
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveDialogName, setSaveDialogName] = useState('');

  // Load saved views from localStorage
  useEffect(() => {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('saved_views') : null;
    if (raw) {
      try { setSavedViews(JSON.parse(raw)); } catch {}
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => run(), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  async function run() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== '' && v !== null && v !== undefined) params.set(k, v);
    });
    params.set('limit', '200');
    try {
      const res = await fetchApi<SearchResponse>(`/api/leads/search?${params.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  function clearAll() {
    setFilters(INITIAL);
  }

  function saveView() {
    setSaveDialogName('');
    setSaveDialogOpen(true);
  }

  function confirmSaveView() {
    const name = saveDialogName.trim();
    if (!name) {
      toast.error('El nombre no puede estar vacío');
      return;
    }
    if (savedViews.some((v) => v.name === name)) {
      toast.error('Ya existe una vista con ese nombre');
      return;
    }
    const next = [...savedViews, { name, filters }];
    setSavedViews(next);
    localStorage.setItem('saved_views', JSON.stringify(next));
    setSaveDialogOpen(false);
    toast.success(`Vista "${name}" guardada`);
  }

  function loadView(v: { name: string; filters: Filters }) {
    setFilters(v.filters);
  }

  function deleteView(name: string) {
    const next = savedViews.filter(v => v.name !== name);
    setSavedViews(next);
    localStorage.setItem('saved_views', JSON.stringify(next));
  }

  const columns: Column<RecoverableLead>[] = [
    { key: 'clientName', header: 'Cliente', accessor: r => r.clientName || '—', sortable: true },
    { key: 'phone', header: 'Teléfono', accessor: r => r.phone || '—' },
    { key: 'intentScore', header: 'Intención', accessor: r => r.intentScore ?? null, sortable: true,
      render: r => r.intentScore !== undefined
        ? <span className={`px-2 py-0.5 rounded text-xs font-medium ${
            r.intentScore >= 8 ? 'bg-emerald-100 text-emerald-800'
            : r.intentScore >= 4 ? 'bg-amber-100 text-amber-800'
            : 'bg-rose-100 text-rose-800'
          }`}>{r.intentScore}</span>
        : '—' },
    { key: 'status', header: 'Estado', accessor: r => r.status || '—',
      render: r => r.status ? String(r.status).replace(/_/g, ' ') : '—' },
    { key: 'advisor', header: 'Asesor', accessor: r => r.advisor || '—' },
    { key: 'estimatedValue', header: 'Valor est.', accessor: r => r.estimatedValue ?? null,
      render: r => r.estimatedValue ? formatCOP(r.estimatedValue) : '—', align: 'right' },
    { key: 'lastContactAt', header: 'Último contacto', accessor: r => r.lastContactAt || null,
      render: r => r.lastContactAt ? formatDate(r.lastContactAt) : '—' },
  ];

  // Map API rows to RecoverableLead shape (they have slightly different field names)
  const rows: RecoverableLead[] = safeArray<any>(data?.rows).map((r: any) => ({
    id: r.id,
    clientName: r.real_name || r.whatsapp_name || r.phone || '—',
    phone: r.phone,
    advisor: r.advisor_name,
    status: r.final_status,
    priority: r.recovery_priority,
    recoveryProbability: r.recovery_probability,
    estimatedValue: r.budget_estimated_cop,
    lastContactAt: r.last_contact_at,
    projectInterest: r.project_name,
    intentScore: r.intent_score,
  }));

  const activeFiltersCount = Object.values(filters).filter(v => v !== '').length;

  return (
    <div>
      <PageHeader
        title="Búsqueda avanzada"
        subtitle="Filtra leads por cualquier combinación de criterios."
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary text-xs" onClick={() => setShowFilters(!showFilters)}>
              <Filter className="w-4 h-4" />
              {showFilters ? 'Ocultar filtros' : 'Mostrar filtros'}
              {activeFiltersCount > 0 && (
                <span className="ml-1 bg-brand-600 text-white rounded-full px-1.5 text-[10px]">
                  {activeFiltersCount}
                </span>
              )}
            </button>
            <button className="btn-secondary text-xs" onClick={saveView} disabled={activeFiltersCount === 0}>
              <Bookmark className="w-4 h-4" /> Guardar vista
            </button>
            <button className="btn-secondary text-xs" onClick={clearAll} disabled={activeFiltersCount === 0}>
              <X className="w-4 h-4" /> Limpiar
            </button>
          </div>
        }
      />

      {/* Search bar */}
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            className="input pl-9 text-sm"
            placeholder="Buscar por nombre, teléfono o palabras clave del resumen..."
            value={filters.q}
            onChange={e => setFilters({ ...filters, q: e.target.value })}
          />
        </div>
        <div className="text-sm text-slate-600 whitespace-nowrap">
          {data ? `${data.total.toLocaleString('es-CO')} resultados` : ''}
        </div>
      </div>

      {/* Saved views */}
      {savedViews.length > 0 && (
        <div className="mb-4 flex gap-2 flex-wrap">
          {savedViews.map(v => (
            <div key={v.name} className="inline-flex items-center gap-1 bg-slate-100 rounded-full px-3 py-1 text-xs">
              <button onClick={() => loadView(v)} className="hover:underline">{v.name}</button>
              <button onClick={() => deleteView(v.name)} className="text-slate-400 hover:text-rose-600">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Filters sidebar */}
        {showFilters && (
          <div className="lg:col-span-1">
            <div className="card p-4 space-y-3 sticky top-4">
              <div>
                <label className="label text-xs">Score intención (min / max)</label>
                <div className="flex gap-1">
                  <input className="input text-sm" type="number" min="1" max="10" placeholder="1"
                    value={filters.min_intent} onChange={e => setFilters({ ...filters, min_intent: e.target.value })} />
                  <input className="input text-sm" type="number" min="1" max="10" placeholder="10"
                    value={filters.max_intent} onChange={e => setFilters({ ...filters, max_intent: e.target.value })} />
                </div>
              </div>
              <Select label="Rango presupuesto" value={filters.budget_range}
                onChange={v => setFilters({ ...filters, budget_range: v })} options={BUDGETS} />
              <Select label="Urgencia" value={filters.urgency}
                onChange={v => setFilters({ ...filters, urgency: v })} options={URGENCIES} />
              <Select label="Estado final" value={filters.final_status}
                onChange={v => setFilters({ ...filters, final_status: v })} options={STATUSES} />
              <Select label="Probabilidad recuperación" value={filters.recovery_probability}
                onChange={v => setFilters({ ...filters, recovery_probability: v })} options={PROBS} />
              <Select label="Fuente del lead" value={filters.lead_source}
                onChange={v => setFilters({ ...filters, lead_source: v })} options={SOURCES} />
              <Select label="Producto interés" value={filters.product_type}
                onChange={v => setFilters({ ...filters, product_type: v })} options={PRODUCTS} />
              <div>
                <label className="label text-xs">Asesor</label>
                <input className="input text-sm" placeholder="Nombre..." value={filters.advisor}
                  onChange={e => setFilters({ ...filters, advisor: e.target.value })} />
              </div>
              <YesNoSelect label="Objeciones sin resolver" value={filters.has_unresolved_objections}
                onChange={v => setFilters({ ...filters, has_unresolved_objections: v })} />
              <YesNoSelect label="Mencionó competencia" value={filters.mentioned_competitors}
                onChange={v => setFilters({ ...filters, mentioned_competitors: v })} />
              <div>
                <label className="label text-xs">Rango de fechas</label>
                <div className="flex gap-1">
                  <input className="input text-xs" type="date" value={filters.from_date}
                    onChange={e => setFilters({ ...filters, from_date: e.target.value })} />
                  <input className="input text-xs" type="date" value={filters.to_date}
                    onChange={e => setFilters({ ...filters, to_date: e.target.value })} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        <div className={showFilters ? 'lg:col-span-3' : 'lg:col-span-4'}>
          {error && <ErrorState message={error} />}
          {loading && <div className="skeleton h-40" />}
          {!loading && !error && data && (
            <DataTable
              columns={columns}
              rows={rows}
              onRowClick={r => router.push(`/leads/${r.id}`)}
              empty="No se encontraron leads con los filtros aplicados."
            />
          )}
        </div>
      </div>

      {/* Modal para guardar vista (reemplaza prompt() nativo) */}
      {saveDialogOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-view-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSaveDialogOpen(false);
          }}
        >
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 id="save-view-title" className="text-lg font-semibold mb-3">
              Guardar vista
            </h3>
            <label htmlFor="view-name" className="label">
              Nombre
            </label>
            <input
              id="view-name"
              className="input"
              autoFocus
              value={saveDialogName}
              onChange={(e) => setSaveDialogName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmSaveView();
                if (e.key === 'Escape') setSaveDialogOpen(false);
              }}
              placeholder="Ej. Leads alta urgencia Bogotá"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                className="btn-ghost"
                onClick={() => setSaveDialogOpen(false)}
              >
                Cancelar
              </button>
              <button className="btn-primary" onClick={confirmSaveView}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
