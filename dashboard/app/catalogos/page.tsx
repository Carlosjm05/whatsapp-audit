'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import type { ProjectCatalog, AdvisorCatalog } from '@/types/api';
import PageHeader from '@/components/PageHeader';
import { ErrorState } from '@/components/LoadingState';
import { useToast } from '@/components/Toast';
import {
  Building2,
  UserCircle,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Save,
} from 'lucide-react';

type Tab = 'proyectos' | 'asesores';

// ─── Proyectos ───────────────────────────────────────────────
function ProjectsSection() {
  const toast = useToast();
  const [items, setItems] = useState<ProjectCatalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Partial<ProjectCatalog>>({});

  async function load() {
    setLoading(true);
    try {
      const res = await fetchApi<{ items: ProjectCatalog[] }>(
        '/api/catalogs/projects'
      );
      setItems(res.items || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando proyectos');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startNew() {
    setEditingId('new');
    setDraft({
      canonical_name: '',
      aliases: [],
      project_type: '',
      city: '',
      description: '',
      is_active: true,
    });
  }

  function startEdit(p: ProjectCatalog) {
    setEditingId(p.id);
    setDraft({ ...p });
  }

  function cancel() {
    setEditingId(null);
    setDraft({});
  }

  async function save() {
    if (!draft.canonical_name || !draft.canonical_name.trim()) {
      toast.error('El nombre canónico es obligatorio');
      return;
    }
    try {
      if (editingId === 'new') {
        await fetchApi('/api/catalogs/projects', {
          method: 'POST',
          body: JSON.stringify({
            canonical_name: draft.canonical_name.trim(),
            aliases: draft.aliases || [],
            project_type: draft.project_type || null,
            city: draft.city || null,
            description: draft.description || null,
            is_active: draft.is_active ?? true,
          }),
        });
        toast.success('Proyecto creado');
      } else if (editingId) {
        await fetchApi(`/api/catalogs/projects/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            canonical_name: draft.canonical_name.trim(),
            aliases: draft.aliases || [],
            project_type: draft.project_type || null,
            city: draft.city || null,
            description: draft.description || null,
            is_active: draft.is_active ?? true,
          }),
        });
        toast.success('Proyecto actualizado');
      }
      cancel();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`¿Eliminar el proyecto "${name}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    try {
      await fetchApi(`/api/catalogs/projects/${id}`, { method: 'DELETE' });
      toast.success(`Proyecto "${name}" eliminado`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-slate-600">
          {items.length} proyecto{items.length === 1 ? '' : 's'} registrado
          {items.length === 1 ? '' : 's'}
        </div>
        <button onClick={startNew} className="btn-primary" disabled={editingId !== null}>
          <Plus className="w-4 h-4" /> Nuevo proyecto
        </button>
      </div>

      {error && <ErrorState message={error} />}
      {loading && <div className="skeleton h-40" />}

      {!loading && !error && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Nombre canónico</th>
                  <th className="px-4 py-2 text-left">Aliases</th>
                  <th className="px-4 py-2 text-left">Ciudad</th>
                  <th className="px-4 py-2 text-left">Estado</th>
                  <th className="px-4 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {editingId === 'new' && (
                  <EditableRow
                    draft={draft}
                    setDraft={setDraft}
                    onSave={save}
                    onCancel={cancel}
                    withCity
                  />
                )}
                {items.map((p) =>
                  editingId === p.id ? (
                    <EditableRow
                      key={p.id}
                      draft={draft}
                      setDraft={setDraft}
                      onSave={save}
                      onCancel={cancel}
                      withCity
                    />
                  ) : (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {p.canonical_name}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {p.aliases && p.aliases.length > 0
                          ? p.aliases.join(', ')
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{p.city || '—'}</td>
                      <td className="px-4 py-3">
                        {p.is_active ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 text-xs">
                            <Check className="w-3 h-3" /> Activo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-slate-500 text-xs">
                            <X className="w-3 h-3" /> Inactivo
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right space-x-1">
                        <button
                          onClick={() => startEdit(p)}
                          className="btn-ghost text-xs py-1"
                          disabled={editingId !== null}
                        >
                          <Pencil className="w-3 h-3" /> Editar
                        </button>
                        <button
                          onClick={() => remove(p.id, p.canonical_name)}
                          className="btn-ghost text-xs py-1 text-rose-700 hover:bg-rose-50"
                          disabled={editingId !== null}
                        >
                          <Trash2 className="w-3 h-3" /> Eliminar
                        </button>
                      </td>
                    </tr>
                  )
                )}
                {items.length === 0 && editingId !== 'new' && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                      Sin proyectos registrados. Agrega el primero.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Asesores ────────────────────────────────────────────────
function AdvisorsSection() {
  const toast = useToast();
  const [items, setItems] = useState<AdvisorCatalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Partial<AdvisorCatalog>>({});

  async function load() {
    setLoading(true);
    try {
      const res = await fetchApi<{ items: AdvisorCatalog[] }>(
        '/api/catalogs/advisors'
      );
      setItems(res.items || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando asesores');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startNew() {
    setEditingId('new');
    setDraft({
      canonical_name: '',
      aliases: [],
      phone: '',
      is_active: true,
    });
  }

  function startEdit(a: AdvisorCatalog) {
    setEditingId(a.id);
    setDraft({ ...a });
  }

  function cancel() {
    setEditingId(null);
    setDraft({});
  }

  async function save() {
    if (!draft.canonical_name || !draft.canonical_name.trim()) {
      toast.error('El nombre canónico es obligatorio');
      return;
    }
    try {
      if (editingId === 'new') {
        await fetchApi('/api/catalogs/advisors', {
          method: 'POST',
          body: JSON.stringify({
            canonical_name: draft.canonical_name.trim(),
            aliases: draft.aliases || [],
            phone: draft.phone || null,
            is_active: draft.is_active ?? true,
          }),
        });
        toast.success('Asesor creado');
      } else if (editingId) {
        await fetchApi(`/api/catalogs/advisors/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            canonical_name: draft.canonical_name.trim(),
            aliases: draft.aliases || [],
            phone: draft.phone || null,
            is_active: draft.is_active ?? true,
          }),
        });
        toast.success('Asesor actualizado');
      }
      cancel();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`¿Eliminar al asesor "${name}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    try {
      await fetchApi(`/api/catalogs/advisors/${id}`, { method: 'DELETE' });
      toast.success(`Asesor "${name}" eliminado`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-slate-600">
          {items.length} asesor{items.length === 1 ? '' : 'es'} registrado
          {items.length === 1 ? '' : 's'}
        </div>
        <button onClick={startNew} className="btn-primary" disabled={editingId !== null}>
          <Plus className="w-4 h-4" /> Nuevo asesor
        </button>
      </div>

      {error && <ErrorState message={error} />}
      {loading && <div className="skeleton h-40" />}

      {!loading && !error && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Nombre canónico</th>
                  <th className="px-4 py-2 text-left">Aliases</th>
                  <th className="px-4 py-2 text-left">Teléfono</th>
                  <th className="px-4 py-2 text-left">Estado</th>
                  <th className="px-4 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {editingId === 'new' && (
                  <EditableRow
                    draft={draft}
                    setDraft={setDraft}
                    onSave={save}
                    onCancel={cancel}
                    withPhone
                  />
                )}
                {items.map((a) =>
                  editingId === a.id ? (
                    <EditableRow
                      key={a.id}
                      draft={draft}
                      setDraft={setDraft}
                      onSave={save}
                      onCancel={cancel}
                      withPhone
                    />
                  ) : (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {a.canonical_name}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {a.aliases && a.aliases.length > 0
                          ? a.aliases.join(', ')
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{a.phone || '—'}</td>
                      <td className="px-4 py-3">
                        {a.is_active ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 text-xs">
                            <Check className="w-3 h-3" /> Activo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-slate-500 text-xs">
                            <X className="w-3 h-3" /> Inactivo
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right space-x-1">
                        <button
                          onClick={() => startEdit(a)}
                          className="btn-ghost text-xs py-1"
                          disabled={editingId !== null}
                        >
                          <Pencil className="w-3 h-3" /> Editar
                        </button>
                        <button
                          onClick={() => remove(a.id, a.canonical_name)}
                          className="btn-ghost text-xs py-1 text-rose-700 hover:bg-rose-50"
                          disabled={editingId !== null}
                        >
                          <Trash2 className="w-3 h-3" /> Eliminar
                        </button>
                      </td>
                    </tr>
                  )
                )}
                {items.length === 0 && editingId !== 'new' && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                      Sin asesores registrados. Agrega el primero.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Fila editable reutilizable ──────────────────────────────
interface EditableRowProps {
  draft: Partial<ProjectCatalog | AdvisorCatalog>;
  setDraft: (d: any) => void;
  onSave: () => void;
  onCancel: () => void;
  withCity?: boolean;
  withPhone?: boolean;
}

function EditableRow({
  draft,
  setDraft,
  onSave,
  onCancel,
  withCity,
  withPhone,
}: EditableRowProps) {
  const aliasesText = Array.isArray(draft.aliases)
    ? (draft.aliases as string[]).join(', ')
    : '';

  return (
    <tr className="bg-amber-50">
      <td className="px-4 py-2">
        <input
          className="input text-sm"
          value={draft.canonical_name || ''}
          onChange={(e) => setDraft({ ...draft, canonical_name: e.target.value })}
          placeholder="Ej. Mirador de Anapoima"
          autoFocus
        />
      </td>
      <td className="px-4 py-2">
        <input
          className="input text-sm"
          value={aliasesText}
          onChange={(e) =>
            setDraft({
              ...draft,
              aliases: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="mirador, mirador anapoima, …"
        />
        <div className="text-[10px] text-slate-500 mt-0.5">
          Separar con comas. Incluye variantes sin tildes y en minúsculas.
        </div>
      </td>
      <td className="px-4 py-2">
        {withCity && (
          <input
            className="input text-sm"
            value={(draft as Partial<ProjectCatalog>).city || ''}
            onChange={(e) => setDraft({ ...draft, city: e.target.value })}
            placeholder="Ej. Anapoima"
          />
        )}
        {withPhone && (
          <input
            className="input text-sm"
            value={(draft as Partial<AdvisorCatalog>).phone || ''}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            placeholder="+57300…"
          />
        )}
      </td>
      <td className="px-4 py-2">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.is_active ?? true}
            onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
          />
          Activo
        </label>
      </td>
      <td className="px-4 py-2 text-right space-x-1 whitespace-nowrap">
        <button onClick={onSave} className="btn-primary text-xs py-1">
          <Save className="w-3 h-3" /> Guardar
        </button>
        <button onClick={onCancel} className="btn-ghost text-xs py-1">
          <X className="w-3 h-3" /> Cancelar
        </button>
      </td>
    </tr>
  );
}

// ─── Página principal ───────────────────────────────────────
export default function CatalogosPage() {
  const [tab, setTab] = useState<Tab>('proyectos');

  return (
    <div>
      <PageHeader
        title="Catálogos"
        subtitle="Proyectos y asesores conocidos. Usados por la IA para normalizar nombres al analizar conversaciones."
      />

      <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 text-sm px-4 py-3">
        <strong>Tip:</strong> los cambios aquí se aplican a <em>nuevos análisis</em> en
        hasta 1 minuto. Para que los leads ya analizados reflejen los cambios, usa el
        botón "Re-analizar" en la vista detalle del lead.
      </div>

      <div className="flex gap-1 mb-4 border-b border-slate-200">
        <button
          onClick={() => setTab('proyectos')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === 'proyectos'
              ? 'text-brand-700 border-brand-600'
              : 'text-slate-600 border-transparent hover:text-slate-900'
          }`}
        >
          <span className="inline-flex items-center gap-2">
            <Building2 className="w-4 h-4" /> Proyectos
          </span>
        </button>
        <button
          onClick={() => setTab('asesores')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === 'asesores'
              ? 'text-brand-700 border-brand-600'
              : 'text-slate-600 border-transparent hover:text-slate-900'
          }`}
        >
          <span className="inline-flex items-center gap-2">
            <UserCircle className="w-4 h-4" /> Asesores
          </span>
        </button>
      </div>

      {tab === 'proyectos' ? <ProjectsSection /> : <AdvisorsSection />}
    </div>
  );
}
