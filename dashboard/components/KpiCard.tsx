import { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'positive' | 'warning' | 'danger';
}

const tones: Record<NonNullable<Props['tone']>, string> = {
  default: 'bg-brand-50 text-brand-700',
  positive: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-rose-50 text-rose-700'
};

export default function KpiCard({ label, value, sub, icon, tone = 'default' }: Props) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            {label}
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900 truncate">
            {value}
          </div>
          {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
        </div>
        {icon && (
          <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${tones[tone]}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
