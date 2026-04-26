'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  UserCheck,
  Building2,
  AlertTriangle,
  Swords,
  BookOpen,
  Building,
  TrendingUp,
  Search,
  Menu,
  X,
  Settings,
  Ghost,
  Smartphone,
  ChevronDown,
  Sparkles,
  Wrench,
  Download,
} from 'lucide-react';
import StatusIndicator from './StatusIndicator';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: 'new';
};

type NavGroup = {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
};

// Estructura agrupada — los títulos y orden están pensados para Óscar:
// arriba lo que mira a diario; abajo configuración/sistema.
const groups: NavGroup[] = [
  {
    id: 'principal',
    title: 'Principal',
    icon: LayoutDashboard,
    items: [
      { href: '/overview', label: 'Vista general', icon: LayoutDashboard },
      { href: '/ghosts',   label: 'Leads fantasma', icon: Ghost },
      { href: '/leads',    label: 'Leads recuperables', icon: Users },
      { href: '/search',   label: 'Búsqueda avanzada', icon: Search },
    ],
  },
  {
    id: 'inteligencia',
    title: 'Inteligencia',
    icon: Sparkles,
    items: [
      { href: '/advisors',       label: 'Desempeño asesores', icon: UserCheck },
      { href: '/product-intel',  label: 'Producto', icon: Building2 },
      { href: '/competitors',    label: 'Competencia', icon: Swords },
      { href: '/trends',         label: 'Tendencias', icon: TrendingUp },
      { href: '/errors',         label: 'Errores', icon: AlertTriangle },
      { href: '/knowledge-base', label: 'Base conocimiento', icon: BookOpen },
    ],
  },
  {
    id: 'sistema',
    title: 'Sistema',
    icon: Wrench,
    items: [
      { href: '/conexion',   label: 'Conexión WhatsApp', icon: Smartphone, badge: 'new' },
      { href: '/extraccion', label: 'Extracción por lotes', icon: Download, badge: 'new' },
      { href: '/catalogos',  label: 'Catálogos', icon: Settings },
    ],
  },
];

// Recordamos qué grupos están abiertos en localStorage para que entre
// recargas mantenga la preferencia del usuario.
const STORAGE_KEY = 'wa_sidebar_groups_v1';

function loadOpenGroups(defaultIds: string[]): Set<string> {
  if (typeof window === 'undefined') return new Set(defaultIds);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set(defaultIds);
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr);
  } catch { /* ignore */ }
  return new Set(defaultIds);
}

function saveOpenGroups(open: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...open]));
  } catch { /* ignore */ }
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  // Por defecto abrimos solo el grupo que contiene la ruta actual + 'principal'.
  const initialOpen = (() => {
    const s = new Set<string>(['principal']);
    for (const g of groups) {
      if (g.items.some((it) => pathname === it.href || pathname.startsWith(it.href + '/'))) {
        s.add(g.id);
      }
    }
    return s;
  })();
  const [openIds, setOpenIds] = useState<Set<string>>(initialOpen);

  // Hidratar desde localStorage solo en cliente para evitar hydration mismatch.
  useEffect(() => {
    setOpenIds(loadOpenGroups([...initialOpen]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persistir cambios de toggle.
  useEffect(() => {
    saveOpenGroups(openIds);
  }, [openIds]);

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <nav className="flex-1 px-3 py-4 space-y-3 overflow-y-auto">
      {groups.map((group) => {
        const isOpen = openIds.has(group.id);
        const GroupIcon = group.icon;
        const hasActive = group.items.some(
          (it) => pathname === it.href || pathname.startsWith(it.href + '/')
        );
        return (
          <div key={group.id}>
            <button
              onClick={() => toggle(group.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[10px] font-semibold uppercase tracking-wider transition ${
                hasActive
                  ? 'text-slate-200'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
              aria-expanded={isOpen}
            >
              <GroupIcon className="w-3.5 h-3.5" />
              <span className="flex-1 text-left">{group.title}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${
                  isOpen ? 'rotate-0' : '-rotate-90'
                }`}
              />
            </button>
            {isOpen && (
              <div className="mt-1 space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(item.href + '/');
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      className={`flex items-center gap-3 pl-3 pr-2 py-2 rounded-lg text-sm transition ${
                        active
                          ? 'bg-brand-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge === 'new' && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-emerald-500 text-white">
                          NUEVO
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="px-6 py-6 border-b border-slate-800 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center">
        <Building className="w-5 h-5 text-white" />
      </div>
      <div>
        <div className="text-sm font-semibold leading-tight">Ortiz Finca Raíz</div>
        <div className="text-xs text-slate-400">Auditoría WhatsApp</div>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname() || '';
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile header with hamburger */}
      <div className="md:hidden bg-slate-900 text-white flex items-center gap-3 px-4 py-3 sticky top-0 z-30">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 -m-2"
          aria-label="Abrir menú"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="w-7 h-7 rounded bg-brand-600 flex items-center justify-center">
          <Building className="w-4 h-4 text-white" />
        </div>
        <div className="text-sm font-semibold">Ortiz Finca Raíz</div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-slate-900/70"
          onClick={() => setMobileOpen(false)}
        >
          <aside
            className="w-72 max-w-[85vw] h-full bg-slate-900 text-slate-100 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <Brand />
              <button
                onClick={() => setMobileOpen(false)}
                className="p-3 text-slate-300 hover:text-white"
                aria-label="Cerrar menú"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <NavList pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            <div className="px-3 py-3 border-t border-slate-800">
              <StatusIndicator />
            </div>
            <div className="px-6 py-3 border-t border-slate-800 text-xs text-slate-500">
              v1.3 · Uso interno
            </div>
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 bg-slate-900 text-slate-100 flex-col">
        <Brand />
        <NavList pathname={pathname} />
        <div className="px-3 py-3 border-t border-slate-800">
          <StatusIndicator />
        </div>
        <div className="px-6 py-3 border-t border-slate-800 text-xs text-slate-500">
          v1.3 · Uso interno
        </div>
      </aside>
    </>
  );
}
