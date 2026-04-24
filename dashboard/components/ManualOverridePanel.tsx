'use client';

import { useState } from 'react';
import { fetchApi } from '@/lib/api';
import { Edit3, Save, X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

const FINAL_STATUS_OPTIONS = [
  { value: '',                        label: '— sin override —' },
  { value: 'venta_cerrada',           label: 'Venta cerrada (ya pagó/firmó)' },
  { value: 'visita_agendada',         label: 'Visita agendada' },
  { value: 'negociacion_activa',      label: 'Negociación activa' },
  { value: 'seguimiento_activo',      label: 'Seguimiento activo' },
  { value: 'se_enfrio',               label: 'Se enfrió' },
  { value: 'ghosteado_por_asesor',    label: 'Ghosteado por asesor' },
  { value: 'ghosteado_por_lead',      label: 'Ghosteado por lead' },
  { value: 'descalificado',           label: 'Descalificado (no comprará nunca)' },
  { value: 'spam',                    label: 'Spam / no es lead real' },
  { value: 'numero_equivocado',       label: 'Número equivocado' },
  { value: 'datos_insuficientes',     label: 'Datos insuficientes' },
];

type Props = {
  leadId: string;
  initialStatus?: string | null;
  initialIsRecoverable?: boolean | null;
  initialNotes?: string | null;
  overriddenBy?: string | null;
  overriddenAt?: string | null;
  iaStatus?: string | null;        // El status que dio la IA (final_status)
  iaIsRecoverable?: boolean | null; // El is_recoverable de la IA
  onSaved?: () => void;
};

export default function ManualOverridePanel(props: Props) {
  const {
    leadId,
    initialStatus,
    initialIsRecoverable,
    initialNotes,
    overriddenBy,
    overriddenAt,
    iaStatus,
    iaIsRecoverable,
    onSaved,
  } = props;

  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(initialStatus || '');
  const [isRecoverable, setIsRecoverable] = useState<'' | 'true' | 'false'>(
    initialIsRecoverable === true ? 'true' :
    initialIsRecoverable === false ? 'false' : ''
  );
  const [notes, setNotes] = useState(initialNotes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);

  // Paréntesis explícitos para legibilidad — antes era ambiguo y dependía
  // de precedencia de operadores.
  const hasOverride = !!(
    initialStatus ||
    (initialIsRecoverable !== null && initialIsRecoverable !== undefined) ||
    initialNotes
  );

  const save = async () => {
    // Validación: rechazar guardado completamente vacío cuando no hay
    // override previo. Antes el backend hacía COALESCE y devolvía OK
    // sin modificar nada → toast mentía con "Guardado".
    const allEmpty =
      !status &&
      isRecoverable === '' &&
      !notes.trim();
    if (allEmpty && !hasOverride) {
      setError('Marcá al menos un campo para guardar el override.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await fetchApi(`/api/leads/${leadId}/override`, {
        method: 'POST',
        body: JSON.stringify({
          manual_status: status || null,
          manual_is_recoverable:
            isRecoverable === '' ? null :
            isRecoverable === 'true' ? true : false,
          manual_notes: notes.trim() || null,
        }),
      });
      setEditing(false);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
      if (onSaved) onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const clearOverride = async () => {
    if (!confirm('¿Quitar el override manual? El lead volverá a usar lo que dijo la IA.')) return;
    setSaving(true);
    setError(null);
    try {
      await fetchApi(`/api/leads/${leadId}/override`, {
        method: 'POST',
        body: JSON.stringify({ clear: true }),
      });
      setStatus('');
      setIsRecoverable('');
      setNotes('');
      setEditing(false);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
      if (onSaved) onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`card p-5 ${hasOverride ? 'ring-2 ring-amber-300 bg-amber-50/40' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            hasOverride ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
          }`}>
            <Edit3 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">
              Override manual {hasOverride && <span className="text-amber-700">· activo</span>}
            </h3>
            <p className="text-xs text-slate-500">
              Corregí lo que dijo la IA si te equivocaste o tenés información que ella no.
            </p>
          </div>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)} className="btn-secondary text-xs">
            {hasOverride ? 'Editar' : 'Marcar manual'}
          </button>
        )}
      </div>

      {savedToast && (
        <div className="mb-3 inline-flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" /> Guardado
        </div>
      )}
      {error && (
        <div className="mb-3 inline-flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-1.5">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      {!editing ? (
        hasOverride ? (
          <div className="text-sm space-y-2">
            {initialStatus && (
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-slate-500 w-32 shrink-0">Estado override</span>
                <span className="font-medium text-slate-800">{initialStatus.replace(/_/g, ' ')}</span>
                {iaStatus && iaStatus !== initialStatus && (
                  <span className="text-xs text-slate-400 line-through">IA: {iaStatus.replace(/_/g, ' ')}</span>
                )}
              </div>
            )}
            {initialIsRecoverable !== null && initialIsRecoverable !== undefined && (
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-slate-500 w-32 shrink-0">Recuperable</span>
                <span className="font-medium text-slate-800">{initialIsRecoverable ? 'Sí' : 'No'}</span>
                {iaIsRecoverable !== null && iaIsRecoverable !== undefined && iaIsRecoverable !== initialIsRecoverable && (
                  <span className="text-xs text-slate-400 line-through">IA: {iaIsRecoverable ? 'Sí' : 'No'}</span>
                )}
              </div>
            )}
            {initialNotes && (
              <div className="pt-2 mt-2 border-t border-amber-200">
                <div className="text-xs text-slate-500 mb-1">Nota</div>
                <p className="text-sm text-slate-800 italic">"{initialNotes}"</p>
              </div>
            )}
            {(overriddenBy || overriddenAt) && (
              <div className="pt-2 mt-2 border-t border-amber-200 text-xs text-slate-500">
                Por <strong>{overriddenBy || '—'}</strong>
                {overriddenAt && <> el {new Date(overriddenAt).toLocaleString('es-CO')}</>}
              </div>
            )}
            <div className="pt-3">
              <button onClick={clearOverride} disabled={saving} className="btn-secondary text-xs text-rose-600 hover:bg-rose-50">
                Quitar override
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Sin override. La vista usa exactamente lo que dijo el análisis automático.
          </p>
        )
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Estado manual</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="input text-sm w-full"
            >
              {FINAL_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {iaStatus && (
              <div className="text-[11px] text-slate-500 mt-1">
                La IA dijo: <em>{iaStatus.replace(/_/g, ' ')}</em>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">¿Es recuperable?</label>
            <select
              value={isRecoverable}
              onChange={(e) => setIsRecoverable(e.target.value as '' | 'true' | 'false')}
              className="input text-sm w-full"
            >
              <option value="">— sin override —</option>
              <option value="true">Sí, sí podemos recuperarlo</option>
              <option value="false">No, ya no vale la pena</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Nota (opcional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. 'Cliente llamó por teléfono y firmó el lunes'"
              className="input text-sm w-full"
              rows={3}
              maxLength={500}
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={saving} className="btn-primary text-xs">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Guardar
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setError(null);
                setStatus(initialStatus || '');
                setIsRecoverable(
                  initialIsRecoverable === true ? 'true' :
                  initialIsRecoverable === false ? 'false' : ''
                );
                setNotes(initialNotes || '');
              }}
              className="btn-secondary text-xs"
            >
              <X className="w-3.5 h-3.5" /> Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
