'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { fetchApi, ApiError } from '@/lib/api';
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Smartphone,
  XCircle,
  Clock,
} from 'lucide-react';

type PublicQR = {
  status: string;
  qr_data_url: string | null;
  qr_emitted_at: string | null;
  connected_at: string | null;
  expires_at: string;
  note: string | null;
};

const POLL_MS = 3000;

const STATUS_LABEL: Record<string, string> = {
  connected: 'WhatsApp conectado',
  qr_ready: 'Código QR listo',
  connecting: 'Esperando conexión…',
  reconnecting: 'Reconectando…',
  disconnected: 'Extractor offline',
  unknown: 'Sin datos',
};

function formatExpires(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-CO', {
      hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short'
    });
  } catch {
    return iso;
  }
}

function secondsTo(iso: string): number {
  const t = new Date(iso).getTime();
  return Math.max(0, Math.floor((t - Date.now()) / 1000));
}

function humanCountdown(s: number): string {
  if (s <= 0) return 'expirado';
  if (s < 60) return `${s} s restantes`;
  return `${Math.floor(s / 60)} min ${s % 60} s restantes`;
}

export default function EscanearPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [data, setData] = useState<PublicQR | null>(null);
  const [error, setError] = useState<{ status: number; msg: string } | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetchApi<PublicQR>(`/api/qr/public/${token}`, { skipAuth: true });
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError) {
            setError({ status: err.status, msg: err.message });
          } else {
            setError({ status: 0, msg: 'Sin conexión' });
          }
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
  }, [token]);

  // Reloj para countdown
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Pantalla de error / link inválido
  if (error && (!data || error.status !== 0)) {
    const friendly =
      error.status === 404 ? 'Este link no es válido.' :
      error.status === 410 ? error.msg :
      'No se pudo cargar el código QR.';
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-8 text-center">
          <XCircle className="w-16 h-16 text-rose-400 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-slate-900 mb-2">Link no disponible</h1>
          <p className="text-sm text-slate-600">{friendly}</p>
          <p className="text-xs text-slate-400 mt-4">
            Pedile a la persona que te compartió el link uno nuevo.
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-slate-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Cargando…</span>
        </div>
      </div>
    );
  }

  const status = data.status;
  const showQR = status === 'qr_ready' && data.qr_data_url;
  const isConnected = status === 'connected';

  // Countdown del token
  const secsToExpire = Math.floor((new Date(data.expires_at).getTime() - now) / 1000);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-sky-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg ring-1 ring-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-emerald-600 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500 flex items-center justify-center">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold">Conectar WhatsApp</h1>
              <p className="text-xs text-emerald-100 mt-0.5">Ortiz Finca Raíz · Auditoría</p>
            </div>
          </div>
        </div>

        {/* Cuerpo */}
        <div className="p-6">
          {data.note && (
            <p className="text-xs text-center text-slate-500 mb-3">{data.note}</p>
          )}

          {isConnected ? (
            <div className="text-center py-6">
              <CheckCircle2 className="w-20 h-20 text-emerald-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-slate-900 mb-2">¡Listo!</h2>
              <p className="text-sm text-slate-600">
                WhatsApp ya está conectado. Podés cerrar esta página.
              </p>
            </div>
          ) : showQR ? (
            <>
              <div className="text-center mb-3">
                <h2 className="text-base font-semibold text-slate-900">Escaneá este código</h2>
                <p className="text-xs text-slate-500 mt-1">El QR se actualiza automáticamente.</p>
              </div>
              <div className="rounded-xl ring-1 ring-slate-200 p-4 bg-white">
                <img
                  src={data.qr_data_url!}
                  alt="Código QR de WhatsApp"
                  className="w-full h-auto"
                />
              </div>
              <ol className="mt-5 space-y-2 text-sm text-slate-700 list-decimal list-inside">
                <li>En tu celular, abrí <strong>WhatsApp</strong>.</li>
                <li>Tocá <strong>Más opciones (⋮)</strong> → <strong>Dispositivos vinculados</strong>.</li>
                <li>Tocá <strong>Vincular un dispositivo</strong> y escaneá este QR.</li>
              </ol>
            </>
          ) : (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-50 mb-4">
                <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
              </div>
              <h2 className="text-base font-semibold text-slate-900 mb-1">{STATUS_LABEL[status] || 'Esperando…'}</h2>
              <p className="text-xs text-slate-500">
                Aguardá unos segundos. El sistema está preparando el código QR.
              </p>
            </div>
          )}

          {/* Token info */}
          <div className="mt-6 pt-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <div className="inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {secsToExpire > 0 ? humanCountdown(secsToExpire) : 'Link expirado'}
            </div>
            <div className="text-slate-400">Expira {formatExpires(data.expires_at)}</div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-3 text-center text-xs text-slate-500 border-t border-slate-200">
          🔒 Conexión segura · No compartas este link con terceros
        </div>
      </div>
    </div>
  );
}
