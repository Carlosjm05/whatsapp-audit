import { ReactNode } from 'react';
import InfoTooltip from './InfoTooltip';

interface Props {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'positive' | 'warning' | 'danger';
  /** Si se pasa, muestra un (?) al lado del label que abre un popover
   *  con la explicación de cómo se calcula el KPI. */
  tooltip?: string;
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

export default function KpiCard({ label, value, sub, icon, tone = 'default', tooltip }: Props) {
  return (
    <div className={`bg-white rounded-xl shadow-card p-3 sm:p-5 ring-1 ${TONE_RING[tone]} transition hover:shadow-md`}>
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wider leading-tight">
            <span className="min-w-0">{label}</span>
            {tooltip && (
              <InfoTooltip
                text={tooltip}
                ariaLabel={`Cómo se calcula: ${label}`}
              />
            )}
          </div>
          <div className={`mt-1.5 sm:mt-2 text-xl sm:text-3xl font-bold leading-tight ${TONE_VALUE[tone]} break-words`}>
            {value}
          </div>
          {sub && <div className="mt-1 sm:mt-1.5 text-[10px] sm:text-xs text-slate-500 leading-snug">{sub}</div>}
        </div>
        {icon && (
          <div className={`shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center ${TONE_BG_ICON[tone]}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
