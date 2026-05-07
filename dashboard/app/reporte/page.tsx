'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchApi, safeArray, ApiError } from '@/lib/api';
import { formatNumber, formatDate, formatDateTime } from '@/lib/format';
import { ChartCard, ChartBar, ChartLine, ChartPie } from '@/components/Charts';
import KpiCard from '@/components/KpiCard';
import {
  AlertTriangle,
  Clock,
  CalendarDays,
  Flame,
  TrendingUp,
  Users,
  Target,
  Award,
  XCircle,
  ListChecks,
  Info,
  ShieldAlert,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────
// Tipos del payload del endpoint /api/public/report (ver
// api/src/routers/public_report.py). Mantener ALINEADO con el router.
// ─────────────────────────────────────────────────────────────────────
interface ReportPayload {
  summary: {
    leads_analyzed?: number;
    period_start?: string | null;
    period_end?: string | null;
    avg_overall_score?: number | null;
    total_errors?: number | null;
    leads_with_errors?: number | null;
    pct_leads_with_errors?: number | null;
    errors_per_lead?: number | null;
  };
  response_time_stats: {
    p50_first_response_minutes?: number | null;
    avg_first_response_minutes?: number | null;
    p95_first_response_minutes?: number | null;
    leads_con_respuesta_efectiva?: number | null;
    leads_sin_respuesta_efectiva?: number | null;
    avg_response_minutes?: number | null;
    avg_longest_gap_hours?: number | null;
    sunday_avg_minutes?: number | null;
    sunday_total_responses?: number | null;
    leads_with_sunday_activity?: number | null;
  };
  response_time_categories: { category: string; count: number }[];
  sla_compliance: {
    speed_ok?: number;
    speed_fail?: number;
    followup_ok?: number;
    followup_fail?: number;
    speed_compliance_pct?: number | null;
    followup_compliance_pct?: number | null;
  };
  process_failures: {
    total_chats: number;
    [key: string]: { count: number; pct: number | null } | number;
  };
  top_errors: { error_text: string; count: number }[];
  loss_causes: { cause: string; count: number }[];
  final_statuses: { status: string; count: number }[];
  objections_summary: {
    total?: number;
    resolved?: number;
    hidden?: number;
    avg_response_quality?: number | null;
    pct_resolved?: number | null;
  };
  objections_by_type: { type: string; total: number; resolved: number }[];
  unanswered_questions: { question: string; count: number }[];
  monthly_evolution: {
    month: string;
    leads: number;
    errors: number;
    avg_score: number | null;
    p50_first_response: number | null;
    conversions: number;
  }[];
  raw_errors: { text: string; date: string }[];
  top_strengths: { strength: string; count: number }[];
}

const PROCESS_LABELS: Record<string, string> = {
  no_followup: 'Sin seguimiento del asesor',
  used_generic: 'Mensajes genéricos / plantilla',
  no_proposed_visit: 'Nunca propuso una visita',
  no_attempted_close: 'Nunca intentó cerrar',
  no_qualified: 'No calificó al lead',
  unanswered_questions: 'Quedaron preguntas sin responder',
  no_project_info: 'No envió información del proyecto',
  no_prices_sent: 'No compartió precios',
  no_alternatives: 'No ofreció alternativas',
};

const CAUSE_LABELS: Record<string, string> = {
  asesor_lento: 'Asesor lento',
  asesor_sin_seguimiento: 'Asesor sin seguimiento',
  asesor_no_califico: 'Asesor no calificó al lead',
  asesor_no_cerro: 'Asesor no cerró',
  asesor_info_incompleta: 'Asesor envió info incompleta',
  asesor_no_consulto_de_vuelta: 'Asesor prometió consultar y no volvió',
  lead_desaparecio: 'Lead desapareció',
  lead_fuera_portafolio: 'Lead fuera de portafolio',
  lead_sin_decision: 'Lead sin decisión',
  lead_presupuesto: 'Presupuesto del lead',
  lead_competencia: 'Lead se fue a la competencia',
  ambos: 'Ambos (asesor + lead)',
  no_aplica: 'No aplica',
};

const STATUS_LABELS: Record<string, string> = {
  venta_cerrada: 'Venta cerrada',
  cliente_existente: 'Cliente existente',
  visita_agendada: 'Visita agendada',
  negociacion_activa: 'Negociación activa',
  seguimiento_activo: 'Seguimiento activo',
  se_enfrio: 'Se enfrió',
  ghosteado_por_asesor: 'Ghosteado por asesor',
  ghosteado_por_lead: 'Ghosteado por lead',
  descalificado: 'Descalificado',
  nunca_calificado: 'Nunca calificado',
  spam: 'Spam',
  numero_equivocado: 'Número equivocado',
  datos_insuficientes: 'Datos insuficientes',
};

const CATEGORY_LABELS: Record<string, string> = {
  excelente: 'Excelente',
  bueno: 'Bueno',
  regular: 'Regular',
  malo: 'Malo',
  critico: 'Crítico',
};

const CATEGORY_COLORS: Record<string, string> = {
  excelente: '#10b981',
  bueno: '#22c55e',
  regular: '#f59e0b',
  malo: '#f97316',
  critico: '#ef4444',
};

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtMin(v: number | null | undefined): string {
  if (v == null) return '—';
  const n = toNum(v);
  if (n < 60) return `${Math.round(n)} min`;
  return `${(n / 60).toFixed(1)} h`;
}

export default function ReportePublicoPage() {
  const [data, setData] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorFilter, setErrorFilter] = useState('');
  const [errorsShown, setErrorsShown] = useState(200);

  useEffect(() => {
    let active = true;
    (async () => {
      // Token vía query string. Si no hay, mostramos el mismo mensaje
      // genérico que cuando es inválido para no filtrar info.
      const params = new URLSearchParams(window.location.search);
      const k = params.get('k') || '';
      if (!k) {
        if (active) {
          setError('Enlace inválido o expirado.');
          setLoading(false);
        }
        return;
      }
      try {
        const res = await fetchApi<ReportPayload>(
          `/api/public/report?k=${encodeURIComponent(k)}&raw_limit=5000`,
          { skipAuth: true },
        );
        if (active) setData(res);
      } catch (err) {
        if (active) {
          // 404 (token inválido o desactivado) lo mostramos genérico.
          if (err instanceof ApiError && err.status === 404) {
            setError('Enlace inválido o expirado.');
          } else {
            setError(err instanceof Error ? err.message : 'Error al cargar el informe.');
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Lista de errores filtrada en cliente. raw_errors ya viene ordenado
  // por fecha desc desde el backend.
  const filteredErrors = useMemo(() => {
    const all = safeArray<{ text: string; date: string }>(data?.raw_errors);
    if (!errorFilter.trim()) return all;
    const f = errorFilter.toLowerCase();
    return all.filter((e) => e.text.toLowerCase().includes(f));
  }, [data, errorFilter]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-slate-500 text-sm">Cargando informe…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl shadow-card p-8 max-w-md text-center ring-1 ring-slate-200">
          <ShieldAlert className="w-10 h-10 text-rose-500 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-slate-800 mb-1">No se pudo cargar el informe</h1>
          <p className="text-sm text-slate-600">{error}</p>
          <p className="text-xs text-slate-400 mt-4">
            Si el enlace lo recibiste por mensaje, pídeselo de nuevo a quien te lo compartió.
          </p>
        </div>
      </div>
    );
  }

  const s = data.summary;
  const rt = data.response_time_stats;
  const sla = data.sla_compliance;
  const pf = data.process_failures;
  const objs = data.objections_summary;

  // Re-formatear datos del backend para charts.
  const rtCategoriesData = safeArray<{ category: string; count: number }>(
    data.response_time_categories,
  ).map((r) => ({
    name: CATEGORY_LABELS[r.category] || r.category,
    value: r.count,
    raw: r.category,
  }));

  const lossCausesData = safeArray<{ cause: string; count: number }>(data.loss_causes)
    .filter((l) => l.cause !== 'no_aplica')
    .map((l) => ({ cause: CAUSE_LABELS[l.cause] || l.cause, count: l.count }));

  const finalStatusesData = safeArray<{ status: string; count: number }>(data.final_statuses).map(
    (s) => ({ name: STATUS_LABELS[s.status] || s.status, value: s.count }),
  );

  const monthly = safeArray<ReportPayload['monthly_evolution'][number]>(data.monthly_evolution);

  const totalErrors = toNum(s.total_errors);
  const leadsAnalyzed = toNum(s.leads_analyzed);

  // Lista ordenada de fallas de proceso (% más alto arriba — donde más se rompe).
  const processList = Object.entries(PROCESS_LABELS)
    .map(([k, label]) => {
      const v = pf[k];
      if (typeof v === 'object' && v !== null && 'count' in v) {
        return { key: k, label, count: v.count, pct: v.pct };
      }
      return { key: k, label, count: 0, pct: null as number | null };
    })
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      {/* ── HEADER / HERO ───────────────────────────────────── */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500 mb-2">
            <ListChecks className="w-4 h-4" />
            Informe ejecutivo · solo lectura
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
            Diagnóstico de errores del equipo
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Vista agregada y anónima — no incluye nombres de asesores ni datos por persona.
          </p>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-slate-500 uppercase">Conversaciones analizadas</div>
              <div className="text-base font-semibold text-slate-800">
                {formatNumber(leadsAnalyzed)}
              </div>
            </div>
            <div>
              <div className="text-slate-500 uppercase">Periodo</div>
              <div className="text-base font-semibold text-slate-800">
                {formatDate(s.period_start)} → {formatDate(s.period_end)}
              </div>
            </div>
            <div>
              <div className="text-slate-500 uppercase">Score promedio del equipo</div>
              <div className="text-base font-semibold text-slate-800">
                {s.avg_overall_score != null
                  ? `${toNum(s.avg_overall_score).toFixed(1)} / 10`
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-slate-500 uppercase">Generado</div>
              <div className="text-base font-semibold text-slate-800">
                {formatDateTime(new Date().toISOString())}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        {/* ── BANNER METODOLOGÍA ─────────────────────────────── */}
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 flex items-start gap-3 text-sm text-sky-900">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <strong>Cómo se mide:</strong> los tiempos de respuesta usan solo
            <strong> horario laboral (Lun–Sáb 7:00–19:00)</strong> — los mensajes recibidos fuera de ese horario
            no penalizan. Los promedios excluyen casos extremos (&gt;8 h) que se reportan aparte como
            <em> &quot;sin respuesta efectiva&quot;</em>. La actividad de domingo se reporta como métrica
            informativa, no afecta el SLA.
          </div>
        </div>

        {/* ── KPIS PRINCIPALES ───────────────────────────────── */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <Target className="w-5 h-5 text-slate-500" />
            Indicadores clave
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <KpiCard
              label="1ra respuesta — mediana"
              value={fmtMin(rt.p50_first_response_minutes)}
              sub="50% de los leads responden en este tiempo o menos"
              icon={<Clock className="w-5 h-5" />}
              tone="positive"
              tooltip="Tiempo entre el primer mensaje del lead y la primera respuesta del asesor. Solo cuenta el tiempo dentro de horario laboral (Lun–Sáb 7:00–19:00). Es la mediana (percentil 50): la mitad de los leads responde más rápido y la otra mitad más lento. Más robusta que el promedio porque no se distorsiona con casos extremos."
            />
            <KpiCard
              label="1ra respuesta — promedio"
              value={fmtMin(rt.avg_first_response_minutes)}
              sub="Sin outliers (≤8 h horario laboral)"
              icon={<Clock className="w-5 h-5" />}
              tooltip="Promedio del tiempo de primera respuesta, contando solo horario laboral. Excluye los casos donde el asesor tardó más de 8 horas (esos van a 'Sin respuesta efectiva') porque distorsionan demasiado el promedio."
            />
            <KpiCard
              label="1ra respuesta — p95"
              value={fmtMin(rt.p95_first_response_minutes)}
              sub="Peor caso típico: el 5% más lento"
              icon={<TrendingUp className="w-5 h-5" />}
              tone="warning"
              tooltip="Percentil 95: 95 de cada 100 leads esperan menos que esto, solo 5 esperan más. Sirve para entender el peor caso típico sin contar casos extremos absolutos. Si la mediana está bien pero el p95 es alto, hay un grupo de leads recibiendo mala atención."
            />
            <KpiCard
              label="Tiempo prom. entre mensajes"
              value={fmtMin(rt.avg_response_minutes)}
              sub="Promedio de toda la conversación"
              icon={<Clock className="w-5 h-5" />}
              tooltip="Promedio del tiempo entre cada mensaje del lead y la siguiente respuesta del asesor, durante toda la conversación. Mide si la atención sigue siendo ágil después del primer contacto, no solo al inicio. Solo horario laboral, sin outliers (>8 h)."
            />

            <KpiCard
              label="Sin respuesta efectiva"
              value={formatNumber(rt.leads_sin_respuesta_efectiva)}
              sub="Leads que esperaron >8 h o nunca recibieron respuesta"
              icon={<AlertTriangle className="w-5 h-5" />}
              tone="danger"
              tooltip="Cantidad de leads donde el asesor tardó más de 8 horas en responder (en horario laboral) o nunca respondió. Estos casos NO entran al cálculo del promedio para no distorsionarlo, pero se reportan acá porque suelen ser pérdidas concretas de oportunidad."
            />
            <KpiCard
              label="SLA velocidad"
              value={
                sla.speed_compliance_pct != null
                  ? `${toNum(sla.speed_compliance_pct).toFixed(0)}%`
                  : '—'
              }
              sub={`${formatNumber(sla.speed_ok)} cumplen / ${formatNumber(sla.speed_fail)} no`}
              icon={<Flame className="w-5 h-5" />}
              tone={
                sla.speed_compliance_pct != null && toNum(sla.speed_compliance_pct) < 70
                  ? 'danger'
                  : 'warning'
              }
              tooltip="% de chats donde el asesor cumplió el SLA de velocidad (responder rápido al primer contacto). El analyzer de IA evalúa cada chat contra la regla del negocio y marca cumplimiento sí/no. El % es chats OK sobre el total de chats con evaluación."
            />
            <KpiCard
              label="SLA seguimiento"
              value={
                sla.followup_compliance_pct != null
                  ? `${toNum(sla.followup_compliance_pct).toFixed(0)}%`
                  : '—'
              }
              sub={`${formatNumber(sla.followup_ok)} cumplen / ${formatNumber(sla.followup_fail)} no`}
              icon={<Flame className="w-5 h-5" />}
              tone={
                sla.followup_compliance_pct != null && toNum(sla.followup_compliance_pct) < 70
                  ? 'danger'
                  : 'warning'
              }
              tooltip="% de chats donde el asesor hizo seguimiento al lead después del primer contacto (no lo dejó colgado). El analyzer marca sí/no en cada chat. Bajo en este KPI suele significar que se pierden ventas por falta de persistencia, no por mala atención inicial."
            />
            <KpiCard
              label="% leads con al menos 1 error"
              value={
                s.pct_leads_with_errors != null
                  ? `${toNum(s.pct_leads_with_errors).toFixed(0)}%`
                  : '—'
              }
              sub={`${formatNumber(totalErrors)} errores en total`}
              icon={<XCircle className="w-5 h-5" />}
              tone="danger"
              tooltip="Porcentaje de conversaciones donde el analyzer detectó al menos un error operativo. Un mismo chat puede tener varios errores. El total de la derecha es la suma de TODOS los errores (no de chats con errores) — útil para ver el volumen absoluto."
            />
          </div>
        </section>

        {/* ── DISTRIBUCIÓN TIEMPOS DE RESPUESTA ──────────────── */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ChartCard
            title="Distribución de calidad de respuesta"
            subtitle="Cómo se reparten los chats por velocidad"
            height={360}
          >
            {rtCategoriesData.length > 0 ? (
              <ChartPie data={rtCategoriesData} nameKey="name" valueKey="value" />
            ) : (
              <div className="flex items-center justify-center h-40 text-xs text-slate-400">
                Sin datos.
              </div>
            )}
          </ChartCard>

          <ChartCard
            title="Errores más frecuentes"
            subtitle="Categorías agrupadas (variantes textuales unificadas)"
            height={420}
          >
            {data.top_errors.length > 0 ? (
              <ChartBar
                data={data.top_errors.slice(0, 12)}
                xKey="error_text"
                yKey="count"
                color="#ef4444"
                horizontal
                yAxisWidth={260}
              />
            ) : (
              <div className="flex items-center justify-center h-40 text-xs text-slate-400">
                Sin errores registrados.
              </div>
            )}
          </ChartCard>
        </section>

        {/* ── Tabla detallada de categorías de errores ───────── */}
        {data.top_errors.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <ListChecks className="w-5 h-5 text-rose-500" />
              Detalle por categoría
            </h2>
            <div className="card p-4 sm:p-5">
              <p className="text-xs text-slate-500 mb-4">
                Distribución de los {formatNumber(
                  data.top_errors.reduce((acc, e) => acc + (e.count || 0), 0),
                )}{' '}
                errores detectados, agrupados por tipo. La barra muestra el peso
                relativo de cada categoría.
              </p>
              <div className="space-y-3">
                {(() => {
                  const total = data.top_errors.reduce(
                    (acc, e) => acc + (e.count || 0),
                    0,
                  );
                  const max = data.top_errors[0]?.count || 1;
                  return data.top_errors.map((e) => {
                    const pctOfTotal = total > 0 ? (e.count / total) * 100 : 0;
                    const widthPct = max > 0 ? (e.count / max) * 100 : 0;
                    const isOther = e.error_text === 'Otros (sin clasificar)';
                    const tone = isOther
                      ? 'bg-slate-400'
                      : pctOfTotal >= 20
                      ? 'bg-rose-500'
                      : pctOfTotal >= 10
                      ? 'bg-orange-500'
                      : 'bg-amber-500';
                    return (
                      <div key={e.error_text}>
                        <div className="flex items-center justify-between text-sm mb-1 gap-3">
                          <span
                            className={`flex-1 min-w-0 ${
                              isOther ? 'text-slate-500 italic' : 'text-slate-700'
                            }`}
                          >
                            {e.error_text}
                          </span>
                          <span className="text-slate-700 font-medium tabular-nums whitespace-nowrap">
                            {formatNumber(e.count)}
                            <span className="text-slate-400 text-xs ml-1.5">
                              ({pctOfTotal.toFixed(1)}%)
                            </span>
                          </span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${tone} rounded-full transition-all`}
                            style={{ width: `${Math.max(2, widthPct)}%` }}
                          />
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </section>
        )}

        {/* ── PROCESOS QUE MÁS SE ROMPEN ─────────────────────── */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <XCircle className="w-5 h-5 text-rose-500" />
            Pasos del proceso que más se rompen
          </h2>
          <div className="card p-4 sm:p-5">
            <p className="text-xs text-slate-500 mb-4">
              Sobre {formatNumber(pf.total_chats)} conversaciones analizadas. Ordenado por % de
              chats donde el paso falló.
            </p>
            <div className="space-y-3">
              {processList.map((p) => {
                const pct = p.pct ?? 0;
                const tone =
                  pct >= 60 ? 'bg-rose-500' : pct >= 30 ? 'bg-amber-500' : 'bg-emerald-500';
                return (
                  <div key={p.key}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-slate-700">{p.label}</span>
                      <span className="text-slate-600 font-medium tabular-nums">
                        {p.pct != null ? `${pct.toFixed(0)}%` : '—'}{' '}
                        <span className="text-slate-400 text-xs">
                          ({formatNumber(p.count)})
                        </span>
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${tone} rounded-full`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── CAUSAS DE PÉRDIDA + ESTADO FINAL ───────────────── */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ChartCard
            title="Causas de pérdida de leads"
            subtitle="Por qué se perdieron las conversaciones que no convirtieron"
            height={400}
          >
            {lossCausesData.length > 0 ? (
              <ChartBar
                data={lossCausesData}
                xKey="cause"
                yKey="count"
                color="#f97316"
                horizontal
                yAxisWidth={220}
              />
            ) : (
              <div className="flex items-center justify-center h-40 text-xs text-slate-400">
                Sin datos.
              </div>
            )}
          </ChartCard>

          <ChartCard
            title="Estado final de las conversaciones"
            subtitle="Distribución de en qué terminó cada chat"
            height={400}
          >
            {finalStatusesData.length > 0 ? (
              <ChartPie data={finalStatusesData} nameKey="name" valueKey="value" />
            ) : (
              <div className="flex items-center justify-center h-40 text-xs text-slate-400">
                Sin datos.
              </div>
            )}
          </ChartCard>
        </section>

        {/* ── OBJECIONES ─────────────────────────────────────── */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Objeciones del lead
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <KpiCard
              label="Total objeciones"
              value={formatNumber(objs.total)}
              icon={<AlertTriangle className="w-5 h-5" />}
              tooltip="Cantidad total de objeciones detectadas por el analyzer (precio, ubicación, tiempo, financiación, etc.). Un mismo lead puede tener varias. Incluye tanto las que el lead dijo abiertamente como las 'ocultas' (que se dedujeron del contexto)."
            />
            <KpiCard
              label="% resueltas"
              value={
                objs.pct_resolved != null
                  ? `${toNum(objs.pct_resolved).toFixed(0)}%`
                  : '—'
              }
              sub={`${formatNumber(objs.resolved)} resueltas`}
              icon={<Award className="w-5 h-5" />}
              tone={
                objs.pct_resolved != null && toNum(objs.pct_resolved) < 50 ? 'danger' : 'positive'
              }
              tooltip="% de objeciones donde el asesor dio una respuesta concreta que resolvió la duda del lead. El analyzer marca 'resuelta' cuando hay evidencia clara: el lead pasó al siguiente paso, agradeció la info, dejó de mencionar el tema, etc. Bajo % aquí = se están perdiendo ventas en la objeción."
            />
            <KpiCard
              label="Objeciones ocultas"
              value={formatNumber(objs.hidden)}
              sub="Detectadas pero el lead no las dijo abiertamente"
              icon={<Info className="w-5 h-5" />}
              tone="warning"
              tooltip="Objeciones que el lead no expresó directamente, pero el analyzer las detectó por el contexto (ej: el lead nunca volvió después de ver el precio, o cambió de tema cuando el asesor mencionó la ubicación). Son las más peligrosas porque el asesor no se entera de que existen."
            />
            <KpiCard
              label="Calidad de respuesta"
              value={
                objs.avg_response_quality != null
                  ? `${toNum(objs.avg_response_quality).toFixed(1)} / 10`
                  : '—'
              }
              sub="Cómo respondió el equipo a las objeciones"
              icon={<Target className="w-5 h-5" />}
              tooltip="Calificación promedio (0–10) de la calidad con la que el asesor respondió a las objeciones. La asigna el analyzer evaluando si la respuesta atacó el fondo del problema, ofreció alternativas, o solo respondió de forma genérica. 7+ es bueno, <5 indica falta de capacitación."
            />
          </div>

          {data.objections_by_type.length > 0 && (
            <div className="card p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Por tipo de objeción</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Tipo</th>
                      <th className="px-4 py-2 text-right">Total</th>
                      <th className="px-4 py-2 text-right">Resueltas</th>
                      <th className="px-4 py-2 text-right">% resueltas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.objections_by_type.map((t) => {
                      const pct = t.total > 0 ? (t.resolved / t.total) * 100 : 0;
                      return (
                        <tr key={t.type} className="hover:bg-slate-50">
                          <td className="px-4 py-2 capitalize">{t.type}</td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {formatNumber(t.total)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                            {formatNumber(t.resolved)}
                          </td>
                          <td
                            className={`px-4 py-2 text-right tabular-nums font-medium ${
                              pct < 50 ? 'text-rose-700' : 'text-emerald-700'
                            }`}
                          >
                            {pct.toFixed(0)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* ── PREGUNTAS QUE NUNCA RESPONDIERON ───────────────── */}
        {data.unanswered_questions.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <XCircle className="w-5 h-5 text-rose-500" />
              Preguntas del lead que nunca se respondieron
            </h2>
            <ChartCard
              title="Preguntas más frecuentes sin responder"
              subtitle="Top 20 — repetidas en múltiples conversaciones"
              height={420}
            >
              <ChartBar
                data={data.unanswered_questions}
                xKey="question"
                yKey="count"
                color="#8b5cf6"
                horizontal
                yAxisWidth={280}
              />
            </ChartCard>
          </section>
        )}

        {/* ── TENDENCIA MENSUAL ──────────────────────────────── */}
        {monthly.length > 1 && (
          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-500" />
              Evolución mensual
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ChartCard
                title="Errores totales por mes"
                subtitle="Suma de errores acumulados"
                height={300}
              >
                <ChartLine data={monthly} xKey="month" yKey="errors" color="#ef4444" />
              </ChartCard>
              <ChartCard
                title="Score promedio del equipo"
                subtitle="Calificación general 0–10"
                height={300}
              >
                <ChartLine data={monthly} xKey="month" yKey="avg_score" color="#10b981" />
              </ChartCard>
              <ChartCard
                title="Mediana de 1ra respuesta (min)"
                subtitle="Más bajo = mejor"
                height={300}
              >
                <ChartLine data={monthly} xKey="month" yKey="p50_first_response" color="#2563eb" />
              </ChartCard>
              <ChartCard
                title="Conversiones cerradas"
                subtitle="Ventas + clientes existentes por mes"
                height={300}
              >
                <ChartLine data={monthly} xKey="month" yKey="conversions" color="#8b5cf6" />
              </ChartCard>
            </div>
          </section>
        )}

        {/* ── DOMINGO ─────────────────────────────────────────── */}
        {toNum(rt.sunday_total_responses) > 0 && (
          <section>
            <div className="card p-5 bg-violet-50/50 ring-1 ring-violet-200">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center">
                  <CalendarDays className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Actividad de domingo</h3>
                  <p className="text-xs text-slate-600">
                    Métrica separada — no entra al SLA, es solo para ver si se atiende fuera de horario.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-white ring-1 ring-violet-200 p-3">
                  <div className="text-[11px] uppercase text-slate-500 mb-1">Tiempo prom. domingo</div>
                  <div className="text-2xl font-bold text-violet-700">
                    {fmtMin(rt.sunday_avg_minutes)}
                  </div>
                </div>
                <div className="rounded-lg bg-white ring-1 ring-violet-200 p-3">
                  <div className="text-[11px] uppercase text-slate-500 mb-1">Respuestas en domingo</div>
                  <div className="text-2xl font-bold text-slate-800">
                    {formatNumber(rt.sunday_total_responses)}
                  </div>
                </div>
                <div className="rounded-lg bg-white ring-1 ring-violet-200 p-3">
                  <div className="text-[11px] uppercase text-slate-500 mb-1">Leads activos en domingo</div>
                  <div className="text-2xl font-bold text-slate-800">
                    {formatNumber(rt.leads_with_sunday_activity)}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── FORTALEZAS (BALANCE) ────────────────────────────── */}
        {data.top_strengths.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <Award className="w-5 h-5 text-emerald-500" />
              Lo que el equipo está haciendo bien
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              <div className="lg:col-span-3">
                <ChartCard
                  title="Fortalezas más frecuentes"
                  subtitle="Categorías agrupadas (variantes textuales unificadas)"
                  height={380}
                >
                  <ChartBar
                    data={data.top_strengths.slice(0, 12)}
                    xKey="strength"
                    yKey="count"
                    color="#10b981"
                    horizontal
                    yAxisWidth={240}
                  />
                </ChartCard>
              </div>
              <div className="lg:col-span-2">
                <div className="card p-4 sm:p-5 h-full">
                  <h3 className="text-sm font-semibold text-slate-800 mb-1">
                    Detalle por categoría
                  </h3>
                  <p className="text-xs text-slate-500 mb-4">
                    Distribución de las{' '}
                    {formatNumber(
                      data.top_strengths.reduce((a, e) => a + (e.count || 0), 0),
                    )}{' '}
                    fortalezas detectadas.
                  </p>
                  <div className="space-y-3">
                    {(() => {
                      const total = data.top_strengths.reduce(
                        (a, e) => a + (e.count || 0),
                        0,
                      );
                      const max = data.top_strengths[0]?.count || 1;
                      return data.top_strengths.map((s) => {
                        const pctOfTotal = total > 0 ? (s.count / total) * 100 : 0;
                        const widthPct = max > 0 ? (s.count / max) * 100 : 0;
                        const isOther = s.strength === 'Otros (sin clasificar)';
                        return (
                          <div key={s.strength}>
                            <div className="flex items-center justify-between text-sm mb-1 gap-3">
                              <span
                                className={`flex-1 min-w-0 ${
                                  isOther ? 'text-slate-500 italic' : 'text-slate-700'
                                }`}
                              >
                                {s.strength}
                              </span>
                              <span className="text-slate-700 font-medium tabular-nums whitespace-nowrap">
                                {formatNumber(s.count)}
                                <span className="text-slate-400 text-xs ml-1.5">
                                  ({pctOfTotal.toFixed(1)}%)
                                </span>
                              </span>
                            </div>
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  isOther ? 'bg-slate-400' : 'bg-emerald-500'
                                }`}
                                style={{ width: `${Math.max(2, widthPct)}%` }}
                              />
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── LISTA TEXTUAL DE TODOS LOS ERRORES ─────────────── */}
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-slate-500" />
            Lista completa de errores detectados
          </h2>
          <div className="card p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
              <div>
                <p className="text-xs text-slate-500">
                  {formatNumber(filteredErrors.length)} de{' '}
                  {formatNumber(safeArray(data.raw_errors).length)} errores · ordenados del más
                  reciente al más antiguo · sin nombres de asesor.
                </p>
              </div>
              <div className="flex gap-2 items-center">
                <input
                  type="search"
                  value={errorFilter}
                  onChange={(e) => {
                    setErrorFilter(e.target.value);
                    setErrorsShown(200);
                  }}
                  placeholder="Filtrar por palabra…"
                  className="text-sm border border-slate-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
            </div>

            <ul className="divide-y divide-slate-100">
              {filteredErrors.slice(0, errorsShown).map((e, i) => (
                <li key={i} className="py-2 flex items-start gap-3 text-sm">
                  <span className="shrink-0 w-20 text-xs text-slate-400 tabular-nums pt-0.5">
                    {e.date}
                  </span>
                  <span className="text-slate-700 flex-1">{e.text}</span>
                </li>
              ))}
            </ul>

            {filteredErrors.length > errorsShown && (
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => setErrorsShown((n) => n + 200)}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  Ver 200 más ({formatNumber(filteredErrors.length - errorsShown)} restantes)
                </button>
              </div>
            )}

            {filteredErrors.length === 0 && (
              <div className="text-center text-sm text-slate-400 py-8">
                {errorFilter ? 'Ningún error coincide con el filtro.' : 'No hay errores registrados.'}
              </div>
            )}
          </div>
        </section>

        {/* ── FOOTER ──────────────────────────────────────────── */}
        <footer className="text-center text-xs text-slate-400 pt-6 border-t border-slate-200">
          <p>Datos generados automáticamente por el sistema de auditoría WhatsApp.</p>
          <p className="mt-1">
            Este informe es confidencial. No compartir el enlace con personas ajenas a la operación.
          </p>
        </footer>
      </main>
    </div>
  );
}
