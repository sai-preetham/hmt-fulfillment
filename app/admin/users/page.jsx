import { AppShell } from '@/components/app-shell';
import { UserManagement } from '@/components/user-management';
import { createServiceClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/current-user';
export const dynamic = 'force-dynamic';
export default async function UsersPage(){ await requirePermission('admin'); const db=createServiceClient(); const [{data:users},{data:audit}]=await Promise.all([db.from('users').select('*').order('created_at'),db.from('user_access_audit').select('*').order('created_at',{ascending:false}).limit(50)]); const auth=await db.auth.admin.listUsers({page:1,perPage:200}); const byId=new Map((auth.data?.users||[]).map(user=>[user.id,user])); return <AppShell><header className="pageHeader"><div><p className="eyebrow">Administration</p><h1>User management</h1><p className="muted">Control CRM access, roles, custom permissions, and password recovery.</p></div></header><UserManagement initialUsers={(users||[]).map(user=>({...user,last_sign_in_at:byId.get(user.auth_user_id)?.last_sign_in_at||null}))} audit={audit||[]}/></AppShell>; }
