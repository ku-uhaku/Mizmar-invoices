import { redirect } from 'next/navigation';
import { readSession } from '@/lib/session';

export default async function Home() {
  const { refreshToken } = await readSession();
  redirect(refreshToken ? '/dashboard' : '/login');
}
