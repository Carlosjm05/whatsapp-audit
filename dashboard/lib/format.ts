export function formatCOP(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  // Postgres BIGINT/DECIMAL pueden llegar como string en JSON.
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0
    }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString('es-CO')}`;
  }
}

export function formatNumber(
  value: number | string | null | undefined,
  digits = 0
): string {
  if (value === null || value === undefined || value === '') return '—';
  // Postgres DECIMAL puede llegar como string en JSON.
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(n);
}

export function formatPct(value: number | string | null | undefined, digits = 0): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  const v = n <= 1 ? n * 100 : n;
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
