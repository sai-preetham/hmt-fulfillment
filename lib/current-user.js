import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/access-control';

export async function currentUserProfile() {
  const jar = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const auth = createServerClient(url, key, { cookies: { getAll: () => jar.getAll(), setAll: () => {} } });
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return null;
  const db = createServiceClient();
  const { data } = await db.from('users').select('*').eq('auth_user_id', user.id).maybeSingle();
  return data ? { ...data, auth_user: user } : null;
}
export async function requirePermission(permission) {
  const profile = await currentUserProfile();
  if (!hasPermission(profile, permission)) throw new Error('FORBIDDEN');
  return profile;
}
