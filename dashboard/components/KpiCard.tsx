import { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'positive' | 'warning' | 'danger';
}

// Mapping deliberado a clases completas para que Tailwind JIT las detecte.
const TONE_BG_ICON: Record<NonNullable<Props['tone']>, string> = {
  default:  'bg-brand-50 text-brand-700',
  positive: 'bg-emerald-50 text-emerald-700',
  warning:  'bg-amber-50 text-amber-700',
  danger:   'bg-rose-50 text-rose-700',
};

// Borde sutil de color según tono — refuerza visualmente la categoría.
const TONE_RING: Record<NonNullable<Props['tone']>, string> = {
  default:  'ring-slate-200',
  positive: 'ring-emerald-200',
  warning:  'ring-amber-200',
  danger:   'ring-rose-200',
};

const TONE_VALUE: Record<NonNullable<Props['tone']>, string> = {
  default:  'text-slate-900',
  positive: 'text-emerald-700',
  warning:  'text-amber-700',
  danger:   'text-rose-700',
};

export default function KpiCard({ label, value, sub, icon, tone = 'default' }: Props) {
  return (
    <div className={`bg-white rounded-xl shadow-card p-4 sm:p-5 ring-1 ${TONE_RING[tone]} transition hover:shadow-md`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wider leading-tight">
            {label}
          </div>
          <div className={`mt-2 text-2xl sm:text-3xl font-bold leading-tight ${TONE_VALUE[tone]} break-words`}>
            {value}
          </div>
          {sub && <div className="mt-1.5 text-[11px] sm:text-xs text-slate-500 leading-snug">{sub}</div>}
        </div>
        {icon && (
          <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${TONE_BG_ICON[tone]}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
