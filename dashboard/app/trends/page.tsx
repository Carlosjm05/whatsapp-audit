'use client';

import { useEffect, useState } from 'react';
import { fetchApi, safeArray } from '@/lib/api';
import PageHeader from '@/components/PageHeader';
import { ChartCard, ChartBar, ChartLine } from '@/components/Charts';
import { ErrorState } from '@/components/LoadingState';
import type { TrendsResponse } from '@/types/api';

interface MonthCount { [key: string]: unknown; month: string; count: number }
interface MonthScore { [key: string]: unknown; month: string; score: number }
interface MonthLeadsConv { [key: string]: unknown; month: string; leads: number; conversions: number }
interface Heatmap { dow: number; hour: number; count: number }
interface ProductMonth { month: string; product: string; count: number }
interface MonthAvgMin { [key: string]: unknown; month: string; avg_min: number }

const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export default function TrendsPage() {
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    const p = new URLSearchParams();
    if (fromDate) p.set('from_date', fromDate);
    if (toDate) p.set('to_date', toDate);
    (async () => {
      try {
        const res = await fetchApi<TrendsResponse>(`/api/trends?${p.toString()}`);
        if (active) setData(res);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Error');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [fromDate, toDate]);

  const heatmap = safeArray<Heatmap>(data?.hourDayHeatmap);

  // Build heatmap matrix [7 dows][24 hours]
  const matrix: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let maxHeat = 0;
  for (const h of heatmap) {
    if (h.dow >= 0 && h.dow < 7 && h.hour >= 0 && h.hour < 24) {
      matrix[h.dow][h.hour] = h.count;
      if (h.count > maxHeat) maxHeat = h.count;
    }
  }

  return (
    <div>
      <PageHeader
        title="Tendencias"
        subtitle="Evolución temporal de KPIs comerciales y operacionales."
        actions={
          <div className="flex gap-2 items-center">
            <input type="date" className="input text-xs" value={fromDate}
              onChange={e => setFromDate(e.target.value)} />
            <span className="text-xs text-slate-500">→</span>
            <input type="date" className="input text-xs" value={toDate}
              onChange={e => setToDate(e.target.value)} />
          </div>
        }
      />

      {error && <ErrorState message={error} />}
      {loading && <div className="skeleton h-40" />}

      {!loading && !error && data && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ChartCard title="Volumen de leads por mes">
            <ChartLine
              data={safeArray<MonthCount>(data.volumeByMonth)}
              xKey="month" yKey="count"
            />
          </ChartCard>

          <ChartCard title="Conversiones por mes"
            subtitle="Leads vs ventas cerradas">
            <ChartBar
              data={safeArray<MonthLeadsConv>(data.conversionByMonth)}
              xKey="month" yKey="conversions" color="#10b981"
            />
          </ChartCard>

          <ChartCard title="Score promedio de intención"
            subtitle="1-10 por mes">
            <ChartLine
              data={safeArray<MonthScore>(data.intentScoreByMonth)}
              xKey="month" yKey="score" color="#8b5cf6"
            />
          </ChartCard>

          <ChartCard title="Score promedio de asesores"
            subtitle="1-10 por mes">
            <ChartLine
              data={safeArray<MonthScore>(data.advisorScoreByMonth)}
              xKey="month" yKey="score" color="#f59e0b"
            />
          </ChartCard>

          <ChartCard title="Tiempo promedio de 1a respuesta"
            subtitle="Minutos por mes">
            <ChartLine
              data={safeArray<MonthAvgMin>(data.responseTimeByMonth)}
              xKey="month" yKey="avg_min" color="#ef4444"
            />
          </ChartCard>

          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Actividad por día y hora</h3>
            {heatmap.length === 0 ? (
              <div className="text-sm text-slate-400 text-center py-8">Sin datos</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="text-[10px]">
                  <thead>
                    <tr>
                      <th></th>
                      {Array.from({ length: 24 }).map((_, h) => (
                        <th key={h} className="px-1 text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.map((row, dow) => (
                      <tr key={dow}>
                        <td className="pr-2 text-slate-500 font-medium">{DOW_LABELS[dow]}</td>
                        {row.map((v, h) => {
                          const pct = maxHeat > 0 ? v / maxHeat : 0;
                          return (
                            <td key={h}
                              className="px-1 py-1"
                              title={`${DOW_LABELS[dow]} ${h}h: ${v} leads`}
                            >
                              <div className="w-5 h-5 rounded"
                                style={{
                                  background: pct === 0 ? '#f1f5f9'
                                    : `rgba(37, 99, 235, ${Math.max(0.15, pct)})`,
                                }}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
