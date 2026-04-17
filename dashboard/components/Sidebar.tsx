'use client';

import { useState } from 'react';
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
} from 'lucide-react';

const nav = [
  { href: '/overview', label: 'Vista general', icon: LayoutDashboard },
  { href: '/ghosts', label: 'Leads fantasma', icon: Ghost },
  { href: '/search', label: 'Búsqueda avanzada', icon: Search },
  { href: '/leads', label: 'Leads recuperables', icon: Users },
  { href: '/advisors', label: 'Desempeño de asesores', icon: UserCheck },
  { href: '/product-intel', label: 'Inteligencia de producto', icon: Building2 },
  { href: '/trends', label: 'Tendencias', icon: TrendingUp },
  { href: '/errors', label: 'Diagnóstico de errores', icon: AlertTriangle },
  { href: '/competitors', label: 'Competencia', icon: Swords },
  { href: '/knowledge-base', label: 'Base de conocimiento', icon: BookOpen },
  { href: '/catalogos', label: 'Catálogos', icon: Settings },
];

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
      {nav.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + '/');
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition ${
              active
                ? 'bg-brand-600 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </Link>
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
            <div className="px-6 py-4 border-t border-slate-800 text-xs text-slate-500">
              v1.1 · Uso interno
            </div>
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 bg-slate-900 text-slate-100 flex-col">
        <Brand />
        <NavList pathname={pathname} />
        <div className="px-6 py-4 border-t border-slate-800 text-xs text-slate-500">
          v1.1 · Uso interno
        </div>
      </aside>
    </>
  );
}
