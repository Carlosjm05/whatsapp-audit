'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { fetchApi } from '@/lib/api';
import type { LeadDetail } from '@/types/api';
import PageHeader from '@/components/PageHeader';
import { ErrorState } from '@/components/LoadingState';
import {
  formatCOP,
  formatDate,
  formatDateTime,
  formatPct,
  priorityBadge
} from '@/lib/format';
import {
  ArrowLeft,
  User,
  Phone,
  Mail,
  Building2,
  ClipboardList,
  Star,
  Target,
  DollarSign
} from 'lucide-react';

type Tab = 'info' | 'financials' | 'objections' | 'timeline' | 'scoring' | 'strategy';

const TABS: { id: Tab; label: string }[] = [
  { id: 'info', label: 'Información' },
  { id: 'financials', label: 'Financieros' },
  { id: 'objections', label: 'Objeciones' },
  { id: 'timeline', label: 'Línea de tiempo' },
  { id: 'scoring', label: 'Calificación asesor' },
  { id: 'strategy', label: 'Estrategia de recuperación' }
];

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id as string;
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('info');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetchApi<LeadDetail>(`/api/leads/${id}`);
        if (active) setLead(res);
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

  return (
    <div>
      <button
        onClick={() => router.push('/leads')}
        className="mb-4 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="w-4 h-4" /> Volver a leads recuperables
      </button>

      {loading && <div className="skeleton h-32" />}
      {error && <ErrorState message={error} />}

      {!loading && !error && lead && (
        <>
          <PageHeader
            title={lead.clientName || 'Lead sin nombre'}
            subtitle={`ID: ${lead.id}`}
            actions={
              <span className={`badge ${priorityBadge(lead.priority)}`}>
                Prioridad {lead.priority || '—'}
              </span>
            }
          />

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <InfoTile
              icon={<Target className="w-4 h-4" />}
              label="Prob. recuperación"
              value={formatPct(lead.recoveryProbability, 0)}
            />
            <InfoTile
              icon={<DollarSign className="w-4 h-4" />}
              label="Valor estimado"
              value={formatCOP(lead.estimatedValue)}
            />
            <InfoTile
              icon={<Star className="w-4 h-4" />}
              label="Intención"
              value={formatPct(lead.intentScore, 0)}
            />
            <InfoTile
              icon={<Building2 className="w-4 h-4" />}
              label="Proyecto"
              value={lead.projectInterest || '—'}
            />
          </div>

          <div className="card">
            <div className="border-b border-slate-200 px-4 flex gap-1 overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${
                    tab === t.id
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="p-6">
              {tab === 'info' && <TabInfo lead={lead} />}
              {tab === 'financials' && <TabFinancials lead={lead} />}
              {tab === 'objections' && <TabObjections lead={lead} />}
              {tab === 'timeline' && <TabTimeline lead={lead} />}
              {tab === 'scoring' && <TabScoring lead={lead} />}
              {tab === 'strategy' && <TabStrategy lead={lead} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function InfoTile({
  icon,
  label,
  value
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-900 truncate">{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2 border-b border-slate-100 last:border-0">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="col-span-2 text-sm text-slate-800">{value ?? '—'}</div>
    </div>
  );
}

function TabInfo({ lead }: { lead: LeadDetail }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
          <User className="w-4 h-4" /> Datos del cliente
        </h3>
        <Row label="Nombre" value={lead.clientName} />
        <Row
          label="Teléfono"
          value={
            lead.phone ? (
              <span className="inline-flex items-center gap-1">
                <Phone className="w-3 h-3" /> {lead.phone}
              </span>
            ) : (
              '—'
            )
          }
        />
        <Row
          label="Email"
          value={
            lead.email ? (
              <span className="inline-flex items-center gap-1">
                <Mail className="w-3 h-3" /> {lead.email}
              </span>
            ) : (
              '—'
            )
          }
        />
        <Row label="Asesor" value={lead.advisor} />
        <Row label="Estado" value={lead.status} />
        <Row label="Último contacto" value={formatDateTime(lead.lastContactAt)} />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
          <Building2 className="w-4 h-4" /> Preferencias
        </h3>
        <Row label="Proyecto" value={lead.projectInterest} />
        <Row
          label="Zonas"
          value={
            lead.preferredZones && lead.preferredZones.length > 0
              ? lead.preferredZones.join(', ')
              : '—'
          }
        />
        <Row label="Habitaciones" value={lead.bedrooms} />
        <Row
          label="Presupuesto"
          value={
            lead.budgetMin || lead.budgetMax
              ? `${formatCOP(lead.budgetMin)} — ${formatCOP(lead.budgetMax)}`
              : '—'
          }
        />
        {lead.notes && (
          <div className="mt-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Notas</div>
            <div className="text-sm text-slate-700 whitespace-pre-wrap">{lead.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function TabFinancials({ lead }: { lead: LeadDetail }) {
  const f = lead.financials || {};
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Row label="Valor estimado" value={formatCOP(f.estimatedValue ?? lead.estimatedValue)} />
      <Row label="Comisión estimada" value={formatCOP(f.commissionEstimate)} />
      <Row
        label="Interés en financiación"
        value={f.financingInterest ? 'Sí' : f.financingInterest === false ? 'No' : '—'}
      />
      <Row label="% cuota inicial" value={formatPct(f.downPaymentPct, 0)} />
      <Row label="Presupuesto mínimo" value={formatCOP(lead.budgetMin)} />
      <Row label="Presupuesto máximo" value={formatCOP(lead.budgetMax)} />
    </div>
  );
}

function TabObjections({ lead }: { lead: LeadDetail }) {
  const list = lead.objections || [];
  if (list.length === 0)
    return <div className="text-sm text-slate-500">Sin objeciones registradas.</div>;
  return (
    <ul className="space-y-3">
      {list.map((o, i) => (
        <li key={i} className="border border-slate-200 rounded-lg p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="badge bg-amber-100 text-amber-800">
              {o.category || 'Objeción'}
            </span>
            <span className="text-xs text-slate-500">{formatDate(o.createdAt)}</span>
          </div>
          <div className="text-sm text-slate-800">{o.text}</div>
        </li>
      ))}
    </ul>
  );
}

function TabTimeline({ lead }: { lead: LeadDetail }) {
  const list = lead.timeline || [];
  if (list.length === 0)
    return <div className="text-sm text-slate-500">Sin eventos en la línea de tiempo.</div>;
  return (
    <ol className="relative border-l border-slate-200 ml-2 space-y-5">
      {list.map((e, i) => (
        <li key={i} className="ml-4">
          <div className="absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full bg-brand-600 border-2 border-white" />
          <div className="text-xs text-slate-500">{formatDateTime(e.at)}</div>
          <div className="text-sm font-medium text-slate-800">{e.type}</div>
          <div className="text-sm text-slate-600">{e.summary}</div>
        </li>
      ))}
    </ol>
  );
}

function TabScoring({ lead }: { lead: LeadDetail }) {
  const s = lead.advisorScoring || {};
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Row label="Score general" value={formatPct(s.overall, 0)} />
      <Row label="Tiempos de respuesta" value={formatPct(s.responseTimeScore, 0)} />
      <Row label="Seguimiento" value={formatPct(s.followupScore, 0)} />
      <Row label="Calidad de atención" value={formatPct(s.qualityScore, 0)} />
      {s.notes && (
        <div className="md:col-span-2 mt-2">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1 flex items-center gap-1">
            <ClipboardList className="w-3 h-3" /> Observaciones
          </div>
          <div className="text-sm text-slate-700 whitespace-pre-wrap">{s.notes}</div>
        </div>
      )}
    </div>
  );
}

function TabStrategy({ lead }: { lead: LeadDetail }) {
  const r = lead.recoveryStrategy || {};
  return (
    <div className="space-y-4">
      <Row label="Acción recomendada" value={r.recommendedAction} />
      <Row label="Mejor canal" value={r.bestChannel} />
      <Row label="Mejor horario" value={r.bestTimeToContact} />
      {r.scriptSuggestion && (
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
            Script sugerido
          </div>
          <div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap">
            {r.scriptSuggestion}
          </div>
        </div>
      )}
      {r.nextSteps && r.nextSteps.length > 0 && (
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
            Próximos pasos
          </div>
          <ul className="list-disc pl-5 text-sm text-slate-800 space-y-1">
            {r.nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
