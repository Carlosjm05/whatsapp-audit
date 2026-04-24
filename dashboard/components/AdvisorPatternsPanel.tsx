'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import { AlertTriangle, Clock, Copy, FileText, MessageCircleOff, Target, UserCheck, XCircle } from 'lucide-react';

type Pattern = {
  type: string;
  label: string;
  severity: 'high' | 'medium' | 'low';
  evidence: string;
  percent: number;
  p95_minutes?: number | null;
};

type PatternsResponse = {
  advisor_name: string;
  total_leads: number;
  avg_first_response_minutes?: number | null;
  p95_first_response_minutes?: number | null;
  patterns: Pattern[];
};

const SEVERITY = {
  high:   { badge: 'bg-rose-100 text-rose-800 ring-rose-200', bar: 'bg-rose-500' },
  medium: { badge: 'bg-amber-100 text-amber-800 ring-amber-200', bar: 'bg-amber-500' },
  low:    { badge: 'bg-sky-100 text-sky-800 ring-sky-200', bar: 'bg-sky-400' },
};

const ICONS: Record<string, any> = {
  respuestas_tardias:  Clock,
  mensajes_plantilla:  Copy,
  no_califica:         FileText,
  no_propone_visita:   Target,
  no_cierra:           XCircle,
  sin_seguimiento:     MessageCircleOff,
  ignora_objeciones:   AlertTriangle,
};

export default function AdvisorPatternsPanel({ name }: { name: string }) {
  const [data, setData] = useState<PatternsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetchApi<PatternsResponse>(
          `/api/advisors/${encodeURIComponent(name)}/patterns`
        );
        if (active) setData(res);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Error');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [name]);

  if (loading) return <div className="card p-5"><div className="skeleton h-24" /></div>;
  if (error) return <div className="card p-4 text-sm text-rose-600">{error}</div>;
  if (!data) return null;

  const patterns = data.patterns || [];

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center">
          <UserCheck className="w-4 h-4" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-800">Patrones de comportamiento</h3>
          <p className="text-xs text-slate-500">
            Tendencias detectadas en <strong>{data.total_leads}</strong> leads atendidos.
            Diferente a errores sueltos: son costumbres que se repiten.
          </p>
        </div>
      </div>

      {patterns.length === 0 ? (
        <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          ✅ Sin patrones problemáticos detectados en este asesor. Buen trabajo.
        </div>
      ) : (
        <div className="space-y-3">
          {patterns.map((p) => {
            const sev = SEVERITY[p.severity] || SEVERITY.low;
            const Icon = ICONS[p.type] || AlertTriangle;
            return (
              <div key={p.type} className="border border-slate-200 rounded-lg p-3">
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${sev.badge}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold text-slate-800">{p.label}</span>
                      <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full ring-1 ring-inset ${sev.badge}`}>
                        {p.severity}
                      </span>
                      <span className="text-xs text-slate-500 ml-auto shrink-0">
                        {p.percent.toFixed(0)}%
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 mb-2">{p.evidence}</div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${sev.bar}`}
                        style={{ width: `${Math.min(100, p.percent)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
