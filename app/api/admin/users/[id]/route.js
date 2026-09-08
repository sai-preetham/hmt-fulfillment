import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/current-user';
import { ROLE_TEMPLATES } from '@/lib/access-control';

export async function PATCH(request, { params }) {
  const actor = await requirePermission('admin');
  const { id } = await params;
  const body = await request.json(); const db = createServiceClient();
  const { data: target } = await db.from('users').select('*').eq('id', id).maybeSingle();
  if (!target) return NextResponse.json({ ok: false, error: 'User not found.' }, { status: 404 });
  if (body.action === 'reset_password') {
    const { error } = await db.auth.resetPasswordForEmail(target.email, { redirectTo: `${new URL(request.url).origin}/reset-password` });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    await audit(db, target.id, actor.auth_user_id, 'password_reset_sent', {});
    return NextResponse.json({ ok: true });
  }
  const role = String(body.role || target.role); if (!ROLE_TEMPLATES[role]) return NextResponse.json({ ok: false, error: 'Invalid role.' }, { status: 400 });
  if (target.auth_user_id === actor.auth_user_id && body.active === false) return NextResponse.json({ ok: false, error: 'You cannot deactivate your own Admin account.' }, { status: 400 });
  const patch = { full_name: String(body.full_name || '').trim() || null, role, active: body.active !== false, custom_permissions: body.custom_permissions || {}, updated_at: new Date().toISOString() };
  const { data, error } = await db.from('users').update(patch).eq('id', id).select('*').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  await audit(db, target.id, actor.auth_user_id, 'access_updated', { role, active: patch.active, custom_permissions: patch.custom_permissions });
  return NextResponse.json({ ok: true, user: data });
}
async function audit(db, target_user_id, actor_auth_user_id, action, metadata) { await db.from('user_access_audit').insert({ target_user_id, actor_auth_user_id, action, metadata }); }
