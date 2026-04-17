'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { fetchApi, safeArray } from '@/lib/api';
import type { LeadDetail } from '@/types/api';
import PageHeader from '@/components/PageHeader';
import { ErrorState } from '@/components/LoadingState';
import { formatCOP, formatDate, formatDateTime } from '@/lib/format';
import {
  ArrowLeft,
  MessageSquare,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  User,
  Phone,
  MapPin,
  Target,
  DollarSign,
  Shield,
  TrendingDown,
  Users,
  Clock,
  Loader2,
} from 'lucide-react';

function Badge({
  tone = 'gray',
  children,
}: {
  tone?: 'red' | 'yellow' | 'green' | 'blue' | 'gray' | 'purple';
  children: React.ReactNode;
}) {
  const map = {
    red: 'bg-rose-100 text-rose-800 ring-rose-200',
    yellow: 'bg-amber-100 text-amber-800 ring-amber-200',
    green: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
    blue: 'bg-sky-100 text-sky-800 ring-sky-200',
    gray: 'bg-slate-100 text-slate-700 ring-slate-200',
    purple: 'bg-violet-100 text-violet-800 ring-violet-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset ${map[tone]}`}>
      {children}
    </span>
  );
}

function intentTone(score?: number): 'red' | 'yellow' | 'green' {
  if (!score || score < 4) return 'red';
  if (score < 8) return 'yellow';
  return 'green';
}

// Postgres DECIMAL llega como string en el JSON (default de FastAPI
// para tipos Decimal). Este helper coacciona a number seguro.
function toNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function recoveryTone(prob?: string): 'red' | 'yellow' | 'green' | 'gray' {
  if (prob === 'alta') return 'green';
  if (prob === 'media') return 'yellow';
  if (prob === 'baja') return 'red';
  return 'gray';
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        {icon && <div className="text-brand-600">{icon}</div>}
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500 mb-0.5">{label}</div>
      <div className="text-sm text-slate-900">{value ?? <span className="text-slate-400">—</span>}</div>
    </div>
  );
}

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id as string;
  const [data, setData] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeToast, setReanalyzeToast] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      try {
        const res = await fetchApi<LeadDetail>(`/api/leads/${id}`);
        if (active) setData(res);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Error');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  async function onReanalyze() {
    setReanalyzing(true);
    setReanalyzeToast(null);
    try {
      await fetchApi(`/api/leads/${id}/reanalyze`, { method: 'POST' });
      setReanalyzeToast('Lead encolado para re-análisis. Resultados en aprox. 1 minuto.');
    } catch (err) {
      setReanalyzeToast(
        'Error: ' + (err instanceof Error ? err.message : 'No se pudo encolar')
      );
    } finally {
      setReanalyzing(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="skeleton h-10 w-48 mb-4" />
        <div className="skeleton h-40" />
      </div>
    );
  }

  if (error || !data) {
    return <ErrorState message={error || 'Lead no encontrado'} />;
  }

  const lead = data.lead || ({} as any);
  const intent = data.intent || {};
  const financials = data.financials || {};
  const interests = data.interests || {};
  const metrics = data.metrics || {};
  const responseTimes = data.response_times || {};
  const advisor = data.advisor_score || {};
  const outcome = data.outcome || {};
  const summary = data.summary || {};
  const objections = safeArray<NonNullable<LeadDetail['objections']>[number]>(data.objections);
  const competitors = safeArray<NonNullable<LeadDetail['competitor_intel']>[number]>(
    data.competitor_intel
  );

  const displayName = (lead.real_name as string) || (lead.whatsapp_name as string) || (lead.phone as string) || 'Sin nombre';
  const intentScore = toNum(intent.intent_score);
  const convId = lead.conversation_id as string | undefined;

  // Coacciones de campos DECIMAL (vienen como string desde el API).
  const firstRespMin = toNum(responseTimes.first_response_minutes);
  const avgRespMin = toNum(responseTimes.avg_response_minutes);
  const longestGapH = toNum(responseTimes.longest_gap_hours);
  const overallScore = toNum(advisor.overall_score);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header nav */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>
        <div className="flex items-center gap-2">
          {convId && (
            <Link
              href={`/leads/${id}/conversation`}
              className="btn-secondary text-xs"
            >
              <MessageSquare className="w-4 h-4" /> Ver conversación
            </Link>
          )}
          <button
            onClick={onReanalyze}
            disabled={reanalyzing}
            className="btn-primary text-xs"
          >
            {reanalyzing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Re-analizar
          </button>
        </div>
      </div>

      {reanalyzeToast && (
        <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 text-sm px-4 py-2">
          {reanalyzeToast}
        </div>
      )}

      {/* Lead header */}
      <div className="card p-5 mb-4">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 mb-1">{displayName}</h1>
            <div className="flex flex-wrap gap-3 text-sm text-slate-600">
              {lead.phone && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5" /> {lead.phone}
                </span>
              )}
              {lead.city && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" /> {lead.city}
                  {lead.zone ? `, ${lead.zone}` : ''}
                </span>
              )}
              {advisor.advisor_name && (
                <span className="inline-flex items-center gap-1">
                  <User className="w-3.5 h-3.5" /> {advisor.advisor_name}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {intentScore !== undefined && (
              <div className="flex flex-col items-center rounded-lg border-2 px-4 py-2"
                style={{
                  borderColor: intentTone(intentScore) === 'green' ? '#10b981'
                    : intentTone(intentScore) === 'yellow' ? '#f59e0b' : '#ef4444',
                }}>
                <div className="text-2xl font-bold text-slate-900">{intentScore}</div>
                <div className="text-[10px] uppercase text-slate-500">Intención</div>
              </div>
            )}
            {outcome.final_status && (
              <Badge tone="blue">{String(outcome.final_status).replace(/_/g, ' ')}</Badge>
            )}
            {outcome.recovery_probability && (
              <Badge tone={recoveryTone(outcome.recovery_probability as string)}>
                Recup.: {outcome.recovery_probability}
              </Badge>
            )}
            {outcome.recovery_priority && outcome.recovery_priority !== 'no_aplica' && (
              <Badge tone="purple">{String(outcome.recovery_priority).replace(/_/g, ' ')}</Badge>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-200 text-xs">
          <div>
            <div className="text-slate-500">Primer contacto</div>
            <div className="font-medium">{lead.first_contact_at ? formatDate(lead.first_contact_at as string) : '—'}</div>
          </div>
          <div>
            <div className="text-slate-500">Último contacto</div>
            <div className="font-medium">{lead.last_contact_at ? formatDate(lead.last_contact_at as string) : '—'}</div>
          </div>
          <div>
            <div className="text-slate-500">Duración</div>
            <div className="font-medium">{(lead.conversation_days as number) || 0} días</div>
          </div>
          <div>
            <div className="text-slate-500">Analizado</div>
            <div className="font-medium">
              {lead.analyzed_at ? formatDateTime(lead.analyzed_at as string) : 'Pendiente'}
            </div>
          </div>
        </div>
      </div>

      {/* Summary */}
      {summary.summary_text && (
        <Section title="Resumen narrativo" icon={<MessageSquare className="w-4 h-4" />}>
          <p className="text-sm text-slate-800 leading-relaxed mb-3">{summary.summary_text as string}</p>
          {Array.isArray(summary.key_takeaways) && summary.key_takeaways.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-600 mb-1">Puntos clave</div>
              <ul className="text-sm text-slate-700 list-disc list-inside space-y-0.5">
                {(summary.key_takeaways as string[]).map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {/* Lead data */}
        <Section title="Datos del lead" icon={<User className="w-4 h-4" />}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nombre real" value={lead.real_name as string} />
            <Field label="Nombre WhatsApp" value={lead.whatsapp_name as string} />
            <Field label="Teléfono" value={lead.phone as string} />
            <Field label="Ciudad de residencia" value={lead.city as string} />
            <Field label="Zona" value={lead.zone as string} />
            <Field label="Ocupación" value={lead.occupation as string} />
            <Field
              label="Rango de edad"
              value={
                lead.age_range && lead.age_range !== 'desconocido'
                  ? (lead.age_range as string)
                  : undefined
              }
            />
            <Field
              label="Contexto familiar"
              value={lead.family_context as string}
            />
            <Field
              label="Fuente"
              value={lead.lead_source ? String(lead.lead_source).replace(/_/g, ' ') : undefined}
            />
            <Field
              label="Confianza del análisis"
              value={
                lead.analysis_confidence ? (
                  <Badge
                    tone={
                      lead.analysis_confidence === 'alta'
                        ? 'green'
                        : lead.analysis_confidence === 'media'
                        ? 'yellow'
                        : 'red'
                    }
                  >
                    {String(lead.analysis_confidence)}
                  </Badge>
                ) : undefined
              }
            />
            {lead.lead_source_detail && (
              <div className="col-span-2">
                <Field label="Detalle fuente" value={lead.lead_source_detail as string} />
              </div>
            )}
          </div>
        </Section>

        {/* Intent */}
        <Section title="Intención y urgencia" icon={<Target className="w-4 h-4" />}>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Score"
              value={
                intent.intent_score ? (
                  <Badge tone={intentTone(intent.intent_score as number)}>
                    {intent.intent_score}/10
                  </Badge>
                ) : undefined
              }
            />
            <Field
              label="Urgencia"
              value={intent.urgency ? String(intent.urgency).replace(/_/g, ' ') : undefined}
            />
            <Field
              label="¿Es el decisor?"
              value={intent.is_decision_maker ? String(intent.is_decision_maker).replace(/_/g, ' ') : undefined}
            />
            <Field
              label="Comparando competencia"
              value={intent.comparing_competitors ? 'Sí' : 'No'}
            />
          </div>
          {intent.intent_justification && (
            <div className="mt-3 pt-3 border-t border-slate-200">
              <div className="text-xs text-slate-500 mb-1">Justificación</div>
              <div className="text-sm text-slate-800">{intent.intent_justification as string}</div>
            </div>
          )}
          {Array.isArray(intent.high_urgency_signals) && (intent.high_urgency_signals as string[]).length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium text-emerald-700 mb-1">Señales de alta urgencia</div>
              <ul className="text-sm text-slate-700 list-disc list-inside">
                {(intent.high_urgency_signals as string[]).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {Array.isArray(intent.low_urgency_signals) && (intent.low_urgency_signals as string[]).length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-medium text-rose-700 mb-1">Señales de baja urgencia</div>
              <ul className="text-sm text-slate-700 list-disc list-inside">
                {(intent.low_urgency_signals as string[]).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
        </Section>

        {/* Financials */}
        <Section title="Situación financiera" icon={<DollarSign className="w-4 h-4" />}>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Presupuesto estimado"
              value={financials.budget_estimated_cop ? formatCOP(financials.budget_estimated_cop as number) : undefined}
            />
            <Field
              label="Rango"
              value={financials.budget_range ? String(financials.budget_range).replace(/_/g, ' ') : undefined}
            />
            <Field
              label="Forma de pago"
              value={financials.payment_method ? String(financials.payment_method).replace(/_/g, ' ') : undefined}
            />
            <Field label="Preaprobado" value={financials.has_bank_preapproval as string} />
            <Field label="Ofrece inmueble" value={financials.offers_trade_in as string} />
            <Field label="Depende de vender" value={financials.depends_on_selling as string} />
          </div>
          {financials.budget_verbatim && (
            <div className="mt-3 pt-3 border-t border-slate-200">
              <div className="text-xs text-slate-500 mb-1">Verbatim</div>
              <blockquote className="text-sm text-slate-800 italic border-l-2 border-slate-300 pl-3">
                "{financials.budget_verbatim as string}"
              </blockquote>
            </div>
          )}
          {Array.isArray(financials.positive_financial_signals) && (financials.positive_financial_signals as string[]).length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium text-emerald-700 mb-1">Señales positivas</div>
              <ul className="text-sm text-slate-700 list-disc list-inside">
                {(financials.positive_financial_signals as string[]).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {Array.isArray(financials.negative_financial_signals) && (financials.negative_financial_signals as string[]).length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-medium text-rose-700 mb-1">Señales negativas</div>
              <ul className="text-sm text-slate-700 list-disc list-inside">
                {(financials.negative_financial_signals as string[]).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
        </Section>

        {/* Interests */}
        <Section title="Producto de interés" icon={<Target className="w-4 h-4" />}>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Tipo"
              value={interests.product_type ? String(interests.product_type).replace(/_/g, ' ') : undefined}
            />
            <Field label="Proyecto" value={interests.project_name as string} />
            <Field label="Zona deseada" value={interests.desired_zone as string} />
            <Field label="Tamaño" value={interests.desired_size as string} />
            <Field
              label="Propósito"
              value={interests.purpose ? String(interests.purpose).replace(/_/g, ' ') : undefined}
            />
          </div>
          {Array.isArray(interests.all_projects_mentioned) && (interests.all_projects_mentioned as string[]).length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-slate-500 mb-1">Todos los proyectos mencionados</div>
              <div className="flex flex-wrap gap-1">
                {(interests.all_projects_mentioned as string[]).map((p, i) => (
                  <Badge key={i} tone="blue">{p}</Badge>
                ))}
              </div>
            </div>
          )}
          {interests.specific_conditions && (
            <div className="mt-3 pt-3 border-t border-slate-200">
              <Field label="Condiciones específicas" value={interests.specific_conditions as string} />
            </div>
          )}
        </Section>
      </div>

      {/* Objections */}
      <div className="mt-4">
        <Section title={`Objeciones (${objections.length})`} icon={<AlertCircle className="w-4 h-4" />}>
          {objections.length === 0 ? (
            <div className="text-sm text-slate-500">Sin objeciones identificadas.</div>
          ) : (
            <div className="space-y-3">
              {objections.map((o: any, i: number) => (
                <div key={i} className="border-l-4 border-amber-400 pl-3 py-1">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <Badge tone="yellow">
                        {String(o.objection_type || 'otro').replace(/_/g, ' ')}
                      </Badge>
                      {o.was_resolved ? (
                        <Badge tone="green">
                          <CheckCircle2 className="w-3 h-3" /> Resuelta
                        </Badge>
                      ) : (
                        <Badge tone="red">
                          <XCircle className="w-3 h-3" /> No resuelta
                        </Badge>
                      )}
                      {o.is_hidden_objection && <Badge tone="gray">Oculta</Badge>}
                    </div>
                    {o.response_quality !== undefined && (
                      <span className="text-xs text-slate-500">
                        Calidad respuesta: {o.response_quality}/10
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-slate-800">{o.objection_text}</div>
                  {o.objection_verbatim && (
                    <blockquote className="mt-1 text-xs text-slate-600 italic">
                      "{o.objection_verbatim}"
                    </blockquote>
                  )}
                  {o.advisor_response && (
                    <div className="mt-2 text-xs text-slate-600">
                      <span className="font-medium">Respuesta del asesor:</span> {o.advisor_response}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {/* Metrics */}
        <Section title="Métricas de conversación" icon={<Clock className="w-4 h-4" />}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total mensajes" value={metrics.total_messages as number} />
            <Field label="Asesor / Lead" value={`${metrics.advisor_messages || 0} / ${metrics.lead_messages || 0}`} />
            <Field label="Audios asesor" value={metrics.advisor_audios as number} />
            <Field label="Audios lead" value={metrics.lead_audios as number} />
            <Field label="Mandó info del proyecto" value={metrics.sent_project_info ? 'Sí' : 'No'} />
            <Field label="Mandó precios" value={metrics.sent_prices ? 'Sí' : 'No'} />
            <Field label="Propuso visita" value={metrics.proposed_visit ? 'Sí' : 'No'} />
            <Field label="Intentó cerrar" value={metrics.attempted_close ? 'Sí' : 'No'} />
            <Field label="Hizo seguimiento" value={metrics.did_followup ? 'Sí' : 'No'} />
            <Field label="Intentos seguimiento" value={metrics.followup_attempts as number} />
          </div>
          <div className="mt-4 pt-3 border-t border-slate-200">
            <div className="text-xs font-medium text-slate-600 mb-2">Tiempos de respuesta</div>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Primera respuesta"
                value={firstRespMin !== undefined ? `${Math.round(firstRespMin)} min` : undefined}
              />
              <Field
                label="Promedio"
                value={avgRespMin !== undefined ? `${Math.round(avgRespMin)} min` : undefined}
              />
              <Field
                label="Brecha más larga"
                value={longestGapH !== undefined ? `${longestGapH.toFixed(1)} h` : undefined}
              />
              <Field
                label="Categoría"
                value={responseTimes.response_time_category as string}
              />
            </div>
          </div>
        </Section>

        {/* Advisor score */}
        <Section title="Calificación del asesor" icon={<Shield className="w-4 h-4" />}>
          {overallScore !== undefined && (
            <div className="mb-4 flex items-center gap-3">
              <div className="text-3xl font-bold text-slate-900">
                {overallScore.toFixed(1)}
              </div>
              <div className="text-xs text-slate-500">
                Score general<br />(1-10)
              </div>
            </div>
          )}
          {Array.isArray(advisor.advisors_involved) &&
            (advisor.advisors_involved as string[]).length > 0 && (
              <div className="mb-3 text-xs">
                <div className="text-slate-500 mb-1">Asesores involucrados:</div>
                <div className="flex flex-wrap gap-1">
                  {(advisor.advisors_involved as string[]).map((n, i) => (
                    <Badge key={i} tone="gray">{n}</Badge>
                  ))}
                </div>
              </div>
            )}
          <div className="flex flex-wrap gap-2 mb-3">
            {advisor.speed_compliance === true && (
              <Badge tone="green">✓ Respondió a tiempo (SLA 10 min)</Badge>
            )}
            {advisor.speed_compliance === false && (
              <Badge tone="red">✗ Violó SLA de 10 min</Badge>
            )}
            {advisor.followup_compliance === true && (
              <Badge tone="green">✓ Hizo seguimiento</Badge>
            )}
            {advisor.followup_compliance === false && (
              <Badge tone="red">✗ Sin seguimiento</Badge>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Velocidad" value={advisor.speed_score !== undefined ? `${advisor.speed_score}/10` : undefined} />
            <Field label="Calificación" value={advisor.qualification_score !== undefined ? `${advisor.qualification_score}/10` : undefined} />
            <Field label="Presentación" value={advisor.product_presentation_score !== undefined ? `${advisor.product_presentation_score}/10` : undefined} />
            <Field label="Manejo objeciones" value={advisor.objection_handling_score !== undefined ? `${advisor.objection_handling_score}/10` : undefined} />
            <Field label="Cierre" value={advisor.closing_attempt_score !== undefined ? `${advisor.closing_attempt_score}/10` : undefined} />
            <Field label="Seguimiento" value={advisor.followup_score !== undefined ? `${advisor.followup_score}/10` : undefined} />
          </div>
          {Array.isArray(advisor.errors_list) && (advisor.errors_list as string[]).length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium text-rose-700 mb-1">Errores cometidos</div>
              <ul className="text-sm text-slate-700 list-disc list-inside">
                {(advisor.errors_list as string[]).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          {Array.isArray(advisor.strengths_list) && (advisor.strengths_list as string[]).length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-medium text-emerald-700 mb-1">Fortalezas</div>
              <ul className="text-sm text-slate-700 list-disc list-inside">
                {(advisor.strengths_list as string[]).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
        </Section>
      </div>

      {/* Outcome & Recovery */}
      <div className="mt-4">
        <Section title="Estado final y estrategia de recuperación" icon={<TrendingDown className="w-4 h-4" />}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Field
                label="Estado final"
                value={outcome.final_status ? String(outcome.final_status).replace(/_/g, ' ') : undefined}
              />
              {outcome.loss_reason && (
                <div className="mt-2">
                  <Field label="Razón de pérdida" value={outcome.loss_reason as string} />
                </div>
              )}
              {outcome.loss_point_description && (
                <div className="mt-2">
                  <Field label="Punto exacto donde se perdió" value={outcome.loss_point_description as string} />
                </div>
              )}
            </div>
            <div>
              <Field
                label="¿Recuperable?"
                value={outcome.is_recoverable ? 'Sí' : 'No'}
              />
              <div className="mt-2">
                <Field
                  label="Probabilidad"
                  value={
                    outcome.recovery_probability ? (
                      <Badge tone={recoveryTone(outcome.recovery_probability as string)}>
                        {outcome.recovery_probability}
                      </Badge>
                    ) : undefined
                  }
                />
              </div>
              <div className="mt-2">
                <Field
                  label="Prioridad"
                  value={outcome.recovery_priority ? String(outcome.recovery_priority).replace(/_/g, ' ') : undefined}
                />
              </div>
            </div>
          </div>
          {outcome.perdido_por && outcome.perdido_por !== 'no_aplica' && (
            <div className="mt-3">
              <Field
                label="Causa de la pérdida"
                value={
                  <Badge
                    tone={
                      String(outcome.perdido_por).startsWith('asesor_')
                        ? 'red'
                        : 'yellow'
                    }
                  >
                    {String(outcome.perdido_por).replace(/_/g, ' ')}
                  </Badge>
                }
              />
            </div>
          )}
          {outcome.peak_intent_verbatim && (
            <div className="mt-4 border-l-4 border-emerald-400 pl-3 py-1 bg-emerald-50 rounded">
              <div className="text-[10px] uppercase text-emerald-700 font-medium">
                Momento de máxima intención (golden moment)
              </div>
              <blockquote className="text-sm text-slate-800 italic mt-1">
                "{outcome.peak_intent_verbatim as string}"
              </blockquote>
            </div>
          )}
          {outcome.loss_point_verbatim && (
            <div className="mt-3 border-l-4 border-rose-400 pl-3 py-1 bg-rose-50 rounded">
              <div className="text-[10px] uppercase text-rose-700 font-medium">
                Punto exacto donde se rompió
              </div>
              <blockquote className="text-sm text-slate-800 italic mt-1">
                "{outcome.loss_point_verbatim as string}"
              </blockquote>
            </div>
          )}
          {outcome.next_concrete_action && (
            <div className="mt-3 border-l-4 border-brand-400 pl-3 py-2 bg-brand-50 rounded">
              <div className="text-[10px] uppercase text-brand-700 font-medium mb-1">
                🎯 Próxima acción sugerida
              </div>
              <div className="text-sm text-slate-900 font-medium">
                {outcome.next_concrete_action as string}
              </div>
            </div>
          )}
          {outcome.recovery_strategy && (
            <div className="mt-4 pt-3 border-t border-slate-200">
              <div className="text-xs font-medium text-slate-700 mb-1">Estrategia de recuperación</div>
              <div className="text-sm text-slate-800">{outcome.recovery_strategy as string}</div>
            </div>
          )}
          {outcome.recovery_message_suggestion && (
            <div className="mt-3">
              <div className="text-xs font-medium text-slate-700 mb-1">Mensaje de recontacto</div>
              <blockquote className="text-sm text-slate-800 italic border-l-2 border-brand-400 pl-3 bg-slate-50 py-2 rounded">
                {outcome.recovery_message_suggestion as string}
              </blockquote>
            </div>
          )}
          {outcome.alternative_product && (
            <div className="mt-3">
              <Field label="Producto alternativo" value={outcome.alternative_product as string} />
            </div>
          )}
        </Section>
      </div>

      {/* Competitors */}
      {competitors.length > 0 && (
        <div className="mt-4">
          <Section title={`Competencia mencionada (${competitors.length})`} icon={<Users className="w-4 h-4" />}>
            <div className="space-y-3">
              {competitors.map((c: any, i: number) => (
                <div key={i} className="border-l-4 border-violet-400 pl-3 py-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-slate-900">{c.competitor_name}</span>
                    {c.went_with_competitor && (
                      <Badge tone="red">Se fue con ellos</Badge>
                    )}
                  </div>
                  {c.competitor_offer && (
                    <div className="text-xs text-slate-600">
                      <span className="font-medium">Oferta:</span> {c.competitor_offer}
                    </div>
                  )}
                  {c.why_considering && (
                    <div className="text-xs text-slate-600 mt-1">
                      <span className="font-medium">Por qué lo considera:</span> {c.why_considering}
                    </div>
                  )}
                  {c.reason_chose_competitor && (
                    <div className="text-xs text-slate-600 mt-1">
                      <span className="font-medium">Razón de elección:</span> {c.reason_chose_competitor}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
