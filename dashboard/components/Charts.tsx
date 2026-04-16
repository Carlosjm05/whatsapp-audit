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
import { ReactNode } from 'react';

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
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div style={{ width: '100%', height }}>{children}</div>
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

export function ChartBar({
  data,
  xKey,
  yKey,
  color = '#2563eb',
  horizontal = false
}: {
  data: ChartDataItem[];
  xKey: string;
  yKey: string;
  color?: string;
  horizontal?: boolean;
}) {
  if (!data || data.length === 0) return <EmptyChart />;
  return (
    <ResponsiveContainer>
      <BarChart
        data={data}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        {horizontal ? (
          <>
            <XAxis type="number" stroke="#64748b" fontSize={12} />
            <YAxis
              type="category"
              dataKey={xKey}
              stroke="#64748b"
              fontSize={12}
              width={120}
            />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} stroke="#64748b" fontSize={12} />
            <YAxis stroke="#64748b" fontSize={12} />
          </>
        )}
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: '1px solid #e2e8f0',
            fontSize: 12
          }}
        />
        <Bar dataKey={yKey} fill={color} radius={[4, 4, 0, 0]} />
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
