'use client';

import { useEffect, useState } from 'react';
import { fetchApi, safeArray } from '@/lib/api';
import type { ProductIntel } from '@/types/api';
import PageHeader from '@/components/PageHeader';
import { ChartCard, ChartBar, ChartPie } from '@/components/Charts';
import { ErrorState } from '@/components/LoadingState';
import DataTable, { Column } from '@/components/DataTable';
import { formatNumber } from '@/lib/format';

interface ProjectRow {
  [key: string]: unknown;
  project: string;
  count: number;
}

function humanize(v?: string): string {
  return (v || '').replace(/_/g, ' ');
}

export default function ProductIntelPage() {
  const [data, setData] = useState<ProductIntel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetchApi<ProductIntel>('/api/product-intel');
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

  const projectColumns: Column<ProjectRow>[] = [
    {
      key: 'project',
      header: 'Proyecto',
      accessor: (r) => r.project,
      sortable: true
    },
    {
      key: 'count',
      header: 'Menciones',
      accessor: (r) => r.count,
      sortable: true,
      align: 'right',
      render: (r) => formatNumber(r.count)
    }
  ];

  // Normalizar (humanizar _): "50_100m" -> "50 100m"
  const productTypes = safeArray<{ product_type: string; count: number }>(
    data?.demand_by_product_type
  ).map((r) => ({ ...r, product_type: humanize(r.product_type) }));

  const zones = safeArray<{ zone: string; count: number }>(data?.demand_by_zone);

  const budgets = safeArray<{ budget_range: string; count: number }>(
    data?.budget_range_distribution
  ).map((r) => ({ ...r, budget_range: humanize(r.budget_range) }));

  const payments = safeArray<{ payment_method: string; count: number }>(
    data?.payment_method_distribution
  ).map((r) => ({ ...r, payment_method: humanize(r.payment_method) }));

  const projects = safeArray<ProjectRow>(data?.top_projects_mentioned);

  const totalSignals =
    productTypes.length + zones.length + budgets.length + payments.length + projects.length;

  return (
    <div>
      <PageHeader
        title="Inteligencia de producto"
        subtitle="Demanda, presupuestos, zonas y proyectos con mayor tracción en las conversaciones analizadas."
      />

      {loading && <div className="skeleton h-40" />}
      {error && <ErrorState message={error} />}

      {!loading && !error && data && totalSignals === 0 && (
        <div className="card p-10 text-center">
          <div className="text-slate-600 mb-2">
            Todavía no hay suficientes datos para mostrar inteligencia de producto.
          </div>
          <div className="text-xs text-slate-500">
            Esta vista se llena a medida que el analyzer procesa conversaciones
            con menciones de producto, zona, presupuesto o forma de pago.
          </div>
        </div>
      )}

      {!loading && !error && data && totalSignals > 0 && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard
              title="Tipos de inmueble demandados"
              subtitle="Lotes, fincas, etc. según lo que pide el lead"
            >
              {productTypes.length > 0 ? (
                <ChartPie
                  data={productTypes}
                  nameKey="product_type"
                  valueKey="count"
                />
              ) : (
                <EmptyMini msg="Sin datos de tipo de producto" />
              )}
            </ChartCard>

            <ChartCard
              title="Zonas más solicitadas"
              subtitle="Top 10 zonas/ciudades de interés"
            >
              {zones.length > 0 ? (
                <ChartBar
                  data={zones.slice(0, 10)}
                  xKey="zone"
                  yKey="count"
                  color="#10b981"
                  horizontal
                />
              ) : (
                <EmptyMini msg="Sin datos de zona" />
              )}
            </ChartCard>

            <ChartCard
              title="Distribución de presupuestos"
              subtitle="Rangos de inversión mencionados"
            >
              {budgets.length > 0 ? (
                <ChartBar
                  data={budgets}
                  xKey="budget_range"
                  yKey="count"
                  color="#2563eb"
                />
              ) : (
                <EmptyMini msg="Sin datos de presupuesto" />
              )}
            </ChartCard>

            <ChartCard
              title="Forma de pago preferida"
              subtitle="Contado, crédito, subsidio, etc."
            >
              {payments.length > 0 ? (
                <ChartPie
                  data={payments}
                  nameKey="payment_method"
                  valueKey="count"
                />
              ) : (
                <EmptyMini msg="Sin datos de forma de pago" />
              )}
            </ChartCard>
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">
              Top proyectos mencionados
            </h3>
            <DataTable
              columns={projectColumns}
              rows={projects}
              initialSortKey="count"
              initialSortDir="desc"
              empty="Ningún lead mencionó proyectos específicos todavía."
            />
          </div>
        </>
      )}
    </div>
  );
}

function EmptyMini({ msg }: { msg: string }) {
  return (
    <div className="flex items-center justify-center h-40 text-xs text-slate-400">
      {msg}
    </div>
  );
}
