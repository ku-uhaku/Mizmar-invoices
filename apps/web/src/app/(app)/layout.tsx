import { redirect } from 'next/navigation';
import { readSession } from '@/lib/session';
import { AppShell } from '@/components/app-shell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { refreshToken } = await readSession();
  // No session cookie at all: there is nothing to refresh, so go straight to
  // sign-in rather than letting every query 401 on the client.
  if (!refreshToken) redirect('/login');

  return <AppShell>{children}</AppShell>;
}
