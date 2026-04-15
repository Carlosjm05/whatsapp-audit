'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import { getToken } from '@/lib/auth';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const isLogin = pathname.startsWith('/login');

  useEffect(() => {
    if (isLogin) {
      setReady(true);
      return;
    }
    const tok = getToken();
    if (!tok) {
      router.replace('/login');
      return;
    }
    setReady(true);
  }, [pathname, isLogin, router]);

  if (isLogin) {
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
        <main className="flex-1 p-6 lg:p-8 overflow-x-auto">{children}</main>
      </div>
    </div>
  );
}
