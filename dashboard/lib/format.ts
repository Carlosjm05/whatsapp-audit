export function formatCOP(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0
    }).format(value);
  } catch {
    return `$${Math.round(value).toLocaleString('es-CO')}`;
  }
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('es-CO').format(value);
}

export function formatPct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const v = value <= 1 ? value * 100 : value;
  return `${v.toFixed(digits)}%`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: '2-digit'
    });
  } catch {
    return value;
  }
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return value;
  }
}

export function priorityBadge(p?: string): string {
  const v = (p || '').toLowerCase();
  if (v === 'alta' || v === 'high') return 'bg-rose-100 text-rose-800';
  if (v === 'media' || v === 'medium') return 'bg-amber-100 text-amber-800';
  if (v === 'baja' || v === 'low') return 'bg-slate-100 text-slate-700';
  return 'bg-slate-100 text-slate-700';
}
