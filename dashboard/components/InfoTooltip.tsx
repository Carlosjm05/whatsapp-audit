'use client';

import { useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface Props {
  text: string;
  /** Tamaño del icono (px). Default 14. */
  size?: number;
  /** Aria label del botón. Default "Cómo se calcula este dato". */
  ariaLabel?: string;
}

/**
 * Tooltip explicativo en forma de icono (?) que se abre al hacer click.
 *
 * Pensado para reuniones donde Oscar (o cualquiera) ve un número en el
 * informe y quiere entender cómo se calculó SIN tener que abrir docs
 * aparte. La metodología de cada KPI vive al lado del KPI.
 *
 * Implementación:
 *   - Click toggle (mobile y desktop funcionan igual — no depende de hover).
 *   - Cierra al hacer click afuera.
 *   - Posiciona debajo y centrado con max-width para no overflow en mobile.
 *   - z-50 sobre cualquier card.
 */
export default function InfoTooltip({ text, size = 14, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center justify-center text-slate-400 hover:text-slate-600 focus:outline-none focus:text-slate-700 transition-colors"
        aria-label={ariaLabel || 'Cómo se calcula este dato'}
        aria-expanded={open}
      >
        <HelpCircle style={{ width: size, height: size }} />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-50 left-1/2 -translate-x-1/2 top-full mt-2 w-64 max-w-[calc(100vw-2rem)] p-2.5 text-xs leading-snug bg-slate-900 text-slate-100 rounded-md shadow-lg pointer-events-none"
        >
          {text}
        </span>
      )}
    </span>
  );
}
