'use client';

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
  Building
} from 'lucide-react';

const nav = [
  { href: '/overview', label: 'Vista general', icon: LayoutDashboard },
  { href: '/leads', label: 'Leads recuperables', icon: Users },
  { href: '/advisors', label: 'Desempeño de asesores', icon: UserCheck },
  { href: '/product-intel', label: 'Inteligencia de producto', icon: Building2 },
  { href: '/errors', label: 'Diagnóstico de errores', icon: AlertTriangle },
  { href: '/competitors', label: 'Competencia', icon: Swords },
  { href: '/knowledge-base', label: 'Base de conocimiento', icon: BookOpen }
];

export default function Sidebar() {
  const pathname = usePathname() || '';
  return (
    <aside className="w-64 shrink-0 bg-slate-900 text-slate-100 flex flex-col">
      <div className="px-6 py-6 border-b border-slate-800 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center">
          <Building className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">Ortiz Finca Raíz</div>
          <div className="text-xs text-slate-400">Auditoría WhatsApp</div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
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
      <div className="px-6 py-4 border-t border-slate-800 text-xs text-slate-500">
        v1.0 · Uso interno
      </div>
    </aside>
  );
}
