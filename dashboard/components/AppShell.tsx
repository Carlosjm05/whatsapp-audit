'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Sidebar, { MobileDrawer } from './Sidebar';
import Header from './Header';
import BottomNav from './BottomNav';
import { getToken } from '@/lib/auth';

// Rutas públicas (sin login). /escanear/[token] es para que el cliente
// pueda escanear el QR vía link temporal sin tener cuenta en el panel.
function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith('/login') ||
    pathname.startsWith('/escanear')
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isPublic = isPublicPath(pathname);

  useEffect(() => {
    if (isPublic) {
      setReady(true);
      return;
    }
    const tok = getToken();
    if (!tok) {
      router.replace('/login');
      return;
    }
    setReady(true);
  }, [pathname, isPublic, router]);

  // Cerrar drawer al cambiar de ruta (los Links en el NavList ya llaman
  // onNavigate, pero por si alguien navega vía router programático).
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Páginas públicas: render limpio sin sidebar/header.
  if (isPublic) {
    return <>{children}</>;
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="skeleton h-8 w-40" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      <Sidebar />
      <MobileDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header onMenuClick={() => setDrawerOpen(true)} />
        {/* pb extra en mobile = altura del BottomNav (60px) + safe area */}
        <main className="flex-1 p-3 sm:p-6 lg:p-8 overflow-x-auto pb-24 md:pb-8">
          {children}
        </main>
      </div>
      <BottomNav onMore={() => setDrawerOpen(true)} />
    </div>
  );
}
