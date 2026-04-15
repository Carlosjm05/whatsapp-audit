'use client';

import { useEffect, useState } from 'react';
import { LogOut, User } from 'lucide-react';
import { getUsername, logout } from '@/lib/auth';

export default function Header() {
  const [user, setUser] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setUser(getUsername() || 'Usuario');
  }, []);

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-6 lg:px-8 h-14 flex items-center justify-between">
      <div className="text-sm text-slate-500">Panel de auditoría conversacional</div>
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-100 text-sm"
        >
          <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center">
            <User className="w-4 h-4" />
          </div>
          <span className="font-medium text-slate-800">{user}</span>
        </button>
        {open && (
          <div className="absolute right-0 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-40">
            <div className="px-3 py-2 text-xs text-slate-500 border-b border-slate-100">
              Sesión activa
            </div>
            <button
              onClick={() => logout()}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="w-4 h-4" />
              Cerrar sesión
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
