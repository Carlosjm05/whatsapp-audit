'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import type { ProductIntel, ProjectConversions } from '@/types/api';
import PageHeader from '@/components/PageHeader';
import { ChartCard, ChartBar, ChartPie } from '@/components/Charts';
import { ErrorState } from '@/components/LoadingState';
import DataTable, { Column } from '@/components/DataTable';
import { formatNumber, formatPct } from '@/lib/format';

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

  const projectColumns: Column<ProjectConversions>[] = [
    { key: 'project', header: 'Proyecto', accessor: (r) => r.project, sortable: true },
    {
      key: 'leads',
      header: 'Leads',
      accessor: (r) => r.leads,
      sortable: true,
      render: (r) => formatNumber(r.leads)
    },
    {
      key: 'conversions',
      header: 'Conversiones',
      accessor: (r) => r.conversions,
      sortable: true,
      render: (r) => formatNumber(r.conversions)
    },
    {
      key: 'rate',
      header: 'Tasa',
      accessor: (r) => (r.leads ? r.conversions / r.leads : 0),
      sortable: true,
      render: (r) =>
        formatPct(r.leads ? r.conversions / r.leads : 0, 1)
    }
  ];

  return (
    <div>
      <PageHeader
        title="Inteligencia de producto"
        subtitle="Demanda, presupuestos, zonas y proyectos con mayor tracción."
      />

      {loading && <div className="skeleton h-40" />}
      {error && <ErrorState message={error} />}

      {!loading && !error && data && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard
              title="Distribución de presupuestos"
              subtitle="Rango de precios de interés"
            >
              <ChartBar
                data={data.budgetDistribution || []}
                xKey="range"
                yKey="count"
                color="#2563eb"
              />
            </ChartCard>
            <ChartCard
              title="Zonas más solicitadas"
              subtitle="Top zonas por interés"
            >
              <ChartBar
                data={(data.topZones || []).slice(0, 10)}
                xKey="zone"
                yKey="count"
                color="#10b981"
                horizontal
              />
            </ChartCard>
            <ChartCard
              title="Habitaciones demandadas"
              subtitle="Preferencias por número de habitaciones"
            >
              <ChartPie
                data={data.bedroomsDemand || []}
                nameKey="bedrooms"
                valueKey="count"
              />
            </ChartCard>
            <ChartCard
              title="Tipos de inmueble"
              subtitle="Distribución por tipología"
            >
              <ChartPie
                data={data.propertyTypes || []}
                nameKey="type"
                valueKey="count"
              />
            </ChartCard>
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">
              Top proyectos
            </h3>
            <DataTable
              columns={projectColumns}
              rows={data.topProjects || []}
              initialSortKey="leads"
              initialSortDir="desc"
              empty="Sin datos de proyectos."
            />
          </div>
        </>
      )}
    </div>
  );
}
