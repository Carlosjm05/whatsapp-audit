'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
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
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 p-3 sm:p-6 lg:p-8 overflow-x-auto">{children}</main>
      </div>
    </div>
  );
}
