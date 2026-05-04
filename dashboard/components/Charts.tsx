'use client';

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  FunnelChart,
  Funnel,
  LabelList
} from 'recharts';
import { ReactNode, useEffect, useState } from 'react';

// Hook para detectar viewport mobile (<640px = breakpoint sm de Tailwind).
// Usado para ajustar yAxisWidth/labels en charts horizontales — en iPhone
// (375px) un yAxisWidth=260 deja solo ~80px para barras (ilegible).
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

// Interfaces con propiedades conocidas (FunnelStage, StatusBucket, etc.)
// no son asignables a Record<string, unknown> porque les falta la index
// signature. Este tipo acepta cualquier objeto con propiedades string.
interface ChartDataItem {
  [key: string]: unknown;
}

export const CHART_COLORS = [
  '#2563eb',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#0ea5e9',
  '#14b8a6',
  '#f97316'
];

export function ChartCard({
  title,
  subtitle,
  actions,
  children,
  height = 320
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  height?: number;
}) {
  const isMobile = useIsMobile();
  // En mobile reducimos el height para que el chart no domine la pantalla.
  // Para charts altos (480 — errores frecuentes), bajamos a 360 en mobile
  // para que aún sea legible pero no requiera scroll vertical eterno.
  const effectiveHeight = isMobile ? Math.min(height, 360) : height;
  return (
    <div className="card p-3 sm:p-5">
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div style={{ width: '100%', height: effectiveHeight }}>{children}</div>
    </div>
  );
}

export function EmptyChart({ message = 'Sin datos' }: { message?: string }) {
  return (
    <div className="w-full h-full flex items-center justify-center text-sm text-slate-400">
      {message}
    </div>
  );
}

// Trunca strings largos para que no rompan el layout del chart.
function truncateLabel(s: unknown, maxLen = 32): string {
  const str = String(s ?? '');
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1).trim() + '…';
}

export function ChartBar({
  data,
  xKey,
  yKey,
  color = '#2563eb',
  horizontal = false,
  yAxisWidth = 180,
}: {
  data: ChartDataItem[];
  xKey: string;
  yKey: string;
  color?: string;
  horizontal?: boolean;
  yAxisWidth?: number;
}) {
  const isMobile = useIsMobile();
  if (!data || data.length === 0) return <EmptyChart />;
  // En mobile (iPhone ~375px), reducir yAxisWidth a ~110px para que las
  // barras tengan espacio. También trunca más agresivo.
  const effectiveYAxisWidth = isMobile
    ? Math.min(yAxisWidth, 110)
    : yAxisWidth;
  const labelMaxLen = isMobile ? 22 : 38;
  // Para horizontal: pre-truncar los labels y filtrar nulos para evitar
  // overlapping en chart de "errores más frecuentes".
  const safeData = horizontal
    ? data.map((d) => ({ ...d, [xKey]: truncateLabel(d[xKey], labelMaxLen) }))
    : data;

  return (
    <ResponsiveContainer>
      <BarChart
        data={safeData}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={
          horizontal
            ? { top: 8, right: 24, left: 8, bottom: 8 }
            : { top: 8, right: 16, left: 8, bottom: 8 }
        }
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        {horizontal ? (
          <>
            <XAxis type="number" stroke="#64748b" fontSize={isMobile ? 10 : 12} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey={xKey}
              stroke="#64748b"
              fontSize={isMobile ? 10 : 11}
              width={effectiveYAxisWidth}
              interval={0}
              tick={{ fill: '#475569' }}
            />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} stroke="#64748b" fontSize={12}
              tick={{ fontSize: 11 }}
              interval={0}
              angle={data.length > 8 ? -25 : 0}
              textAnchor={data.length > 8 ? 'end' : 'middle'}
              height={data.length > 8 ? 60 : 30}
            />
            <YAxis stroke="#64748b" fontSize={12} allowDecimals={false} />
          </>
        )}
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: '1px solid #e2e8f0',
            fontSize: 12
          }}
        />
        <Bar dataKey={yKey} fill={color} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ChartLine({
  data,
  xKey,
  yKey,
  color = '#2563eb'
}: {
  data: ChartDataItem[];
  xKey: string;
  yKey: string;
  color?: string;
}) {
  if (!data || data.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey={xKey} stroke="#64748b" fontSize={12} />
        <YAxis stroke="#64748b" fontSize={12} />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: '1px solid #e2e8f0',
            fontSize: 12
          }}
        />
        <Line
          type="monotone"
          dataKey={yKey}
          stroke={color}
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ChartPie({
  data,
  nameKey,
  valueKey
}: {
  data: ChartDataItem[];
  nameKey: string;
  valueKey: string;
}) {
  if (!data || data.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer>
      <PieChart>
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          cx="50%"
          cy="50%"
          outerRadius={100}
          innerRadius={55}
          paddingAngle={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: '1px solid #e2e8f0',
            fontSize: 12
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function ChartFunnel({
  data,
  nameKey,
  valueKey
}: {
  data: ChartDataItem[];
  nameKey: string;
  valueKey: string;
}) {
  if (!data || data.length === 0) return <EmptyChart />;
  const mapped = data.map((d, i) => ({
    name: d[nameKey] as string,
    value: Number(d[valueKey] ?? 0),
    fill: CHART_COLORS[i % CHART_COLORS.length]
  }));
  return (
    <ResponsiveContainer>
      <FunnelChart>
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: '1px solid #e2e8f0',
            fontSize: 12
          }}
        />
        <Funnel dataKey="value" data={mapped} isAnimationActive>
          <LabelList
            position="right"
            fill="#334155"
            stroke="none"
            dataKey="name"
            fontSize={12}
          />
          <LabelList
            position="center"
            fill="#ffffff"
            stroke="none"
            dataKey="value"
            fontSize={12}
          />
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );
}
