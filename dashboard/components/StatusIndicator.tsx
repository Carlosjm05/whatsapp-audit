'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchApi } from '@/lib/api';

type ExtractorStatus = {
  status: string;
  light: 'green' | 'yellow' | 'red';
  is_healthy: boolean;
  last_activity_at: string | null;
  last_activity_secs_ago: number | null;
  status_changed_at: string | null;
  status_changed_secs_ago: number | null;
  connected_at: string | null;
};

const POLL_MS = 15_000;

const STATUS_LABEL: Record<string, string> = {
  connected: 'Conectado',
  qr_ready: 'QR listo',
  connecting: 'Conectando',
  reconnecting: 'Reconectando',
  disconnected: 'Desconectado',
  unknown: 'Sin datos',
};

function humanSecs(s: number | null): string {
  if (s === null || s === undefined) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function StatusIndicator() {
  const [data, setData] = useState<ExtractorStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetchApi<ExtractorStatus>('/api/system/status');
        if (!cancelled) setData(res);
      } catch {
        // Silencioso: si la API falla, mostramos estado "sin datos"
        if (!cancelled) {
          setData((prev) =>
            prev ? prev : { status: 'unknown', light: 'red', is_healthy: false,
              last_activity_at: null, last_activity_secs_ago: null,
              status_changed_at: null, status_changed_secs_ago: null,
              connected_at: null }
          );
        }
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const light = data?.light || 'red';
  const dotColor =
    light === 'green' ? 'bg-emerald-400' :
    light === 'yellow' ? 'bg-amber-400' : 'bg-rose-400';
  const ringColor =
    light === 'green' ? 'shadow-[0_0_0_3px_rgba(52,211,153,0.18)]' :
    light === 'yellow' ? 'shadow-[0_0_0_3px_rgba(251,191,36,0.18)]' :
    'shadow-[0_0_0_3px_rgba(244,63,94,0.18)]';

  const label = STATUS_LABEL[data?.status || 'unknown'] || data?.status || 'Sin datos';
  const sub = data?.last_activity_secs_ago !== null && data?.last_activity_secs_ago !== undefined
    ? `Actividad hace ${humanSecs(data.last_activity_secs_ago)}`
    : data?.status_changed_secs_ago
    ? `Hace ${humanSecs(data.status_changed_secs_ago)}`
    : 'Sin actividad reciente';

  return (
    <Link
      href="/conexion"
      className="block px-3 py-2 rounded-lg text-xs hover:bg-slate-800 transition"
      title={`Estado WhatsApp: ${label}. Click para ver QR / detalles.`}
    >
      <div className="flex items-center gap-2 mb-0.5">
        <span className={`w-2.5 h-2.5 rounded-full ${dotColor} ${ringColor}`} />
        <span className="text-slate-200 font-medium">{label}</span>
      </div>
      <div className="text-slate-500 pl-4 leading-tight truncate">{sub}</div>
    </Link>
  );
}
