'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import { DollarSign, TrendingUp } from 'lucide-react';

type CostBucket = { whisper: number; claude: number; total: number };
type CostSummary = {
  hoy: CostBucket;
  semana: CostBucket;
  mes: CostBucket;
  total: CostBucket;
};

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '$0.00';
  // Pequeñas cantidades con 4 decimales (ej. piloto), grandes con 2.
  const fmt = n < 1
    ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
    : new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${fmt.format(n)}`;
}

function Bucket({
  label,
  bucket,
  highlight = false,
}: {
  label: string;
  bucket: CostBucket | undefined;
  highlight?: boolean;
}) {
  const total = bucket?.total ?? 0;
  const whisper = bucket?.whisper ?? 0;
  const claude = bucket?.claude ?? 0;
  return (
    <div className={`rounded-lg p-3 ${highlight ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'bg-slate-50 ring-1 ring-slate-200'}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      <div className={`text-xl font-bold ${highlight ? 'text-emerald-700' : 'text-slate-800'}`}>
        {formatUsd(total)}
      </div>
      <div className="text-[11px] text-slate-500 mt-1.5 flex items-center justify-between">
        <span>Whisper {formatUsd(whisper)}</span>
        <span>Claude {formatUsd(claude)}</span>
      </div>
    </div>
  );
}

export default function CostWidget() {
  const [data, setData] = useState<CostSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetchApi<CostSummary>('/api/cost/summary');
        if (active) setData(res);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Error');
      }
    })();
    return () => { active = false; };
  }, []);

  if (error) {
    return (
      <div className="card p-4 text-sm text-rose-600">
        No se pudo cargar costos: {error}
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
            <DollarSign className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Gasto en APIs</h3>
            <p className="text-xs text-slate-500">Whisper (audio) + Claude (análisis)</p>
          </div>
        </div>
        {data?.total && (
          <div className="text-right">
            <div className="text-xs text-slate-500">All-time</div>
            <div className="text-base font-semibold text-slate-800">{formatUsd(data.total.total)}</div>
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Bucket label="Hoy"    bucket={data?.hoy}    highlight />
        <Bucket label="Semana" bucket={data?.semana} />
        <Bucket label="Mes"    bucket={data?.mes} />
      </div>
    </div>
  );
}
