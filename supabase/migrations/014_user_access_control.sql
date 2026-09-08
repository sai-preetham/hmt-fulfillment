alter table users add column if not exists custom_permissions jsonb not null default '{}'::jsonb;
alter table users add column if not exists password_generated_at timestamptz;

create table if not exists user_access_audit (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid references users(id) on delete set null,
  actor_auth_user_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_user_access_audit_target_created on user_access_audit(target_user_id, created_at desc);
alter table user_access_audit enable row level security;

drop policy if exists "admins can read access audit" on user_access_audit;
create policy "admins can read access audit" on user_access_audit
for select to authenticated using (
  exists (select 1 from users u where u.auth_user_id = auth.uid() and u.active and u.role = 'admin')
);
