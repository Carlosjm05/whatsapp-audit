'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchApi, downloadFile } from '@/lib/api';
import type { KnowledgeEntry, KnowledgeBaseResponse } from '@/types/api';
import PageHeader from '@/components/PageHeader';
import DataTable, { Column } from '@/components/DataTable';
import { ErrorState } from '@/components/LoadingState';
import { formatDate } from '@/lib/format';
import { Download, Search, Sparkles, Eye } from 'lucide-react';
import { useToast } from '@/components/Toast';

export default function KnowledgeBasePage() {
  const toast = useToast();
  const [rows, setRows] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<KnowledgeEntry | null>(null);
  const [daptaPreview, setDaptaPreview] = useState<Record<string, unknown> | null>(null);
  const [daptaLoading, setDaptaLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (search) params.set('search', search);
    (async () => {
      try {
        const res = await fetchApi<KnowledgeBaseResponse | KnowledgeEntry[]>(
          `/api/knowledge-base?${params.toString()}`
        );
        // El API devuelve {total, limit, offset, rows}. Mantengo fallback
        // a array plano por si alguna vez cambia la forma.
        const list = Array.isArray(res)
          ? res
          : Array.isArray((res as KnowledgeBaseResponse).rows)
            ? (res as KnowledgeBaseResponse).rows
            : [];
        if (active) setRows(list);
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
  }, [type, search]);

  const types = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.entry_type && s.add(r.entry_type));
    return Array.from(s).sort();
  }, [rows]);

  async function onExport() {
    try {
      await downloadFile(
        '/api/knowledge-base/export',
        `knowledge-base-${new Date().toISOString().slice(0, 10)}.json`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error exportando');
    }
  }

  async function previewDapta() {
    setDaptaLoading(true);
    try {
      const res = await fetchApi<Record<string, unknown>>(
        '/api/knowledge-base/dapta-export'
      );
      setDaptaPreview(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error generando preview');
    } finally {
      setDaptaLoading(false);
    }
  }

  function downloadDaptaJson() {
    if (!daptaPreview) return;
    const blob = new Blob([JSON.stringify(daptaPreview, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dapta-knowledge-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const columns: Column<KnowledgeEntry>[] = [
    {
      key: 'entry_type',
      header: 'Tipo',
      accessor: (r) => r.entry_type,
      sortable: true,
      render: (r) => (
        <span className="badge bg-brand-50 text-brand-700">{r.entry_type}</span>
      )
    },
    {
      key: 'category',
      header: 'Tema',
      accessor: (r) => r.category || '—',
      sortable: true,
      render: (r) => (r.category as string) || '—'
    },
    {
      key: 'content_text',
      header: 'Contenido',
      accessor: (r) => r.content_text,
      render: (r) => (
        <span className="line-clamp-2 text-slate-600">{r.content_text}</span>
      )
    },
    {
      key: 'frequency_count',
      header: 'Frecuencia',
      accessor: (r) => r.frequency_count ?? 0,
      sortable: true,
      align: 'right',
      render: (r) =>
        r.frequency_count != null ? `×${r.frequency_count}` : '—'
    }
  ];

  return (
    <div>
      <PageHeader
        title="Base de conocimiento"
        subtitle="Entradas extraídas listas para exportar a Dapta."
        actions={
          <div className="flex gap-2">
            <button onClick={previewDapta} className="btn-primary text-xs" disabled={daptaLoading}>
              <Sparkles className="w-4 h-4" />
              {daptaLoading ? 'Generando...' : 'Exportar para Dapta'}
            </button>
            <button onClick={onExport} className="btn-outline text-xs">
              <Download className="w-4 h-4" /> JSON crudo
            </button>
          </div>
        }
      />

      <div className="card p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label">Tipo de entrada</label>
            <select
              className="input"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">Todos</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
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
                placeholder="Título, contenido, tags…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {loading && <div className="skeleton h-40" />}
      {error && <ErrorState message={error} />}
      {!loading && !error && rows.length === 0 && (
        <div className="card p-10 text-center">
          <Sparkles className="w-10 h-10 mx-auto text-slate-400 mb-3" />
          <div className="text-slate-700 font-medium mb-2">
            La base de conocimiento todavía está vacía.
          </div>
          <div className="text-xs text-slate-500 max-w-lg mx-auto">
            Se genera automáticamente tras cada corrida del analyzer.
            Si acabas de analizar leads, espera un momento o regenera
            manualmente desde el servidor con:
            <br />
            <code className="text-slate-600 bg-slate-100 px-1 rounded mt-2 inline-block">
              docker compose run --rm analyzer python -m src.main --mode=kb
            </code>
          </div>
        </div>
      )}
      {!loading && !error && rows.length > 0 && (
        <DataTable
          columns={columns}
          rows={rows}
          onRowClick={(r) => setSelected(r)}
          initialSortKey="frequency_count"
          initialSortDir="desc"
          empty="Sin resultados con el filtro aplicado."
        />
      )}

      {selected && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-40 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white rounded-xl max-w-2xl w-full max-h-[85vh] overflow-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-200 flex items-start justify-between">
              <div>
                <span className="badge bg-brand-50 text-brand-700 mb-2">
                  {selected.entry_type}
                </span>
                <h3 className="text-lg font-semibold text-slate-900">
                  {(selected.category as string) || 'Sin categoría'}
                </h3>
                {selected.frequency_count != null && (
                  <div className="text-xs text-slate-500 mt-1">
                    Aparece {selected.frequency_count} vez{selected.frequency_count === 1 ? '' : 'es'}
                  </div>
                )}
              </div>
              <button
                className="btn-ghost"
                onClick={() => setSelected(null)}
              >
                Cerrar
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <div className="text-xs font-medium text-slate-600 mb-1">Contenido</div>
                <div className="text-sm text-slate-800 whitespace-pre-wrap">
                  {selected.content_text}
                </div>
              </div>
              {Array.isArray(selected.verbatim_examples) &&
                selected.verbatim_examples.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-slate-600 mb-1">
                      Ejemplos textuales
                    </div>
                    <ul className="text-sm text-slate-700 space-y-1 list-disc list-inside">
                      {selected.verbatim_examples.map((v, i) => (
                        <li key={i} className="italic">"{v}"</li>
                      ))}
                    </ul>
                  </div>
                )}
              {selected.ideal_response && (
                <div>
                  <div className="text-xs font-medium text-emerald-700 mb-1">
                    Respuesta ideal sugerida
                  </div>
                  <div className="text-sm text-slate-800 border-l-2 border-emerald-400 pl-3 bg-emerald-50 rounded py-2 whitespace-pre-wrap">
                    {selected.ideal_response as string}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dapta export preview modal */}
      {daptaPreview && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4"
          onClick={() => setDaptaPreview(null)}
        >
          <div
            className="bg-white rounded-xl max-w-5xl w-full max-h-[90vh] overflow-hidden shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-slate-200 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-brand-600" />
                  <h3 className="text-lg font-semibold text-slate-900">
                    Base de conocimiento — formato Dapta
                  </h3>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {daptaPreview.estadisticas && typeof daptaPreview.estadisticas === 'object'
                    ? Object.entries(daptaPreview.estadisticas as Record<string, unknown>).map(([k, v]) => (
                        <span key={k} className="badge bg-slate-100 text-slate-700">
                          {k.replace(/_/g, ' ')}: <strong className="ml-1">{String(v)}</strong>
                        </span>
                      ))
                    : null}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={downloadDaptaJson} className="btn-primary text-xs">
                  <Download className="w-4 h-4" /> Descargar
                </button>
                <button onClick={() => setDaptaPreview(null)} className="btn-ghost text-xs">
                  Cerrar
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-slate-50">
              <pre className="text-xs text-slate-800 whitespace-pre-wrap break-words">
                {JSON.stringify(daptaPreview, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
