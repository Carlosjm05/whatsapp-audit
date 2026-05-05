'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Ghost, Users, UserCheck, MoreHorizontal } from 'lucide-react';

// Bottom navigation tipo app nativa para mobile.
// 4 atajos a las páginas más usadas + "Más" que abre el drawer completo.
// Solo visible en mobile (lg+ usa el sidebar persistente).
interface Props {
  onMore: () => void;
}

const ITEMS = [
  { href: '/overview', label: 'Inicio',    icon: LayoutDashboard },
  { href: '/ghosts',   label: 'Fantasma',  icon: Ghost },
  { href: '/leads',    label: 'Leads',     icon: Users },
  { href: '/advisors', label: 'Asesores',  icon: UserCheck },
];

export default function BottomNav({ onMore }: Props) {
  const pathname = usePathname() || '/';

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200 grid grid-cols-5
                 pb-[env(safe-area-inset-bottom)]"
      role="navigation"
      aria-label="Navegación principal"
    >
      {ITEMS.map((it) => {
        const active = pathname === it.href || pathname.startsWith(it.href + '/');
        const Icon = it.icon;
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition ${
              active
                ? 'text-brand-700'
                : 'text-slate-500 active:text-brand-600'
            }`}
          >
            <Icon className={`w-5 h-5 ${active ? 'text-brand-600' : 'text-slate-500'}`} />
            <span>{it.label}</span>
          </Link>
        );
      })}
      <button
        onClick={onMore}
        className="flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-slate-500 active:text-brand-600 transition"
        aria-label="Más opciones"
      >
        <MoreHorizontal className="w-5 h-5" />
        <span>Más</span>
      </button>
    </nav>
  );
}
