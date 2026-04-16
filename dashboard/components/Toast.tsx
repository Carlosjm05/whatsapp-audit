'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastAPI {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
}

const ToastContext = createContext<ToastAPI | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, kind, message }]);
    // Auto-dismiss después de 4s.
    setTimeout(() => setItems((xs) => xs.filter((t) => t.id !== id)), 4000);
  }, []);

  const api: ToastAPI = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm"
        role="status"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg px-4 py-3 shadow-lg text-sm ${
              t.kind === 'error'
                ? 'bg-red-600 text-white'
                : t.kind === 'success'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-white'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastAPI {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback seguro: si se usa fuera del Provider, no-op pero loguea.
    // Evita crash en builds/preview aislados.
    return {
      success: (m) => console.info(`[toast success] ${m}`),
      error: (m) => console.error(`[toast error] ${m}`),
      info: (m) => console.info(`[toast info] ${m}`),
    };
  }
  return ctx;
}

// Preserva compatibilidad con eventlistener: cualquier error no manejado
// de window se convierte en toast error si el provider está montado.
export function installWindowErrorToast(toast: ToastAPI): () => void {
  if (typeof window === 'undefined') return () => {};
  const h = (e: ErrorEvent) => toast.error(`Error inesperado: ${e.message}`);
  window.addEventListener('error', h);
  return () => window.removeEventListener('error', h);
}

export function useMountToastErrorHandler(): void {
  const toast = useToast();
  useEffect(() => installWindowErrorToast(toast), [toast]);
}
