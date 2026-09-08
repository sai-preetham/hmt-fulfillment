import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/current-user';
import { ROLE_TEMPLATES } from '@/lib/access-control';

export async function GET() {
  await requirePermission('admin');
  const db = createServiceClient();
  const [{ data: profiles, error }, authResult] = await Promise.all([
    db.from('users').select('*').order('created_at', { ascending: true }), db.auth.admin.listUsers({ page: 1, perPage: 200 })
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  const authById = new Map((authResult.data?.users || []).map(user => [user.id, user]));
  return NextResponse.json({ ok: true, users: (profiles || []).map(profile => ({ ...profile, last_sign_in_at: authById.get(profile.auth_user_id)?.last_sign_in_at || null })) });
}

export async function POST(request) {
  const actor = await requirePermission('admin');
  const body = await request.json();
  const email = String(body.email || '').trim().toLowerCase();
  const role = String(body.role || 'viewer');
  if (!email || !ROLE_TEMPLATES[role]) return NextResponse.json({ ok: false, error: 'Enter a valid email and role.' }, { status: 400 });
  const password = temporaryPassword();
  const db = createServiceClient();
  const { data: authData, error: authError } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: String(body.full_name || '').trim() } });
  if (authError) return NextResponse.json({ ok: false, error: authError.message }, { status: 400 });
  const profile = { auth_user_id: authData.user.id, email, full_name: String(body.full_name || '').trim() || null, role, active: true, custom_permissions: body.custom_permissions || {}, password_generated_at: new Date().toISOString() };
  const { data, error } = await db.from('users').insert(profile).select('*').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  await audit(db, data.id, actor.auth_user_id, 'user_created', { email, role });
  return NextResponse.json({ ok: true, user: data, temporary_password: password }, { status: 201 });
}

function temporaryPassword() { return `Hmt!${crypto.randomUUID().replaceAll('-', '').slice(0, 14)}9`; }
async function audit(db, target_user_id, actor_auth_user_id, action, metadata) { await db.from('user_access_audit').insert({ target_user_id, actor_auth_user_id, action, metadata }); }
