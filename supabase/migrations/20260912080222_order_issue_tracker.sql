create table public.issues (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null check (char_length(btrim(description)) between 1 and 5000),
  category text not null check (category in ('shipping', 'product', 'installation', 'payment', 'customer_support', 'other')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'blocked', 'resolved')),
  assigned_user_id uuid references public.users(id) on delete set null,
  planned_resolution text check (planned_resolution is null or char_length(btrim(planned_resolution)) <= 5000),
  target_resolution_at timestamptz,
  final_resolution text check (final_resolution is null or char_length(btrim(final_resolution)) <= 5000),
  created_by uuid not null references public.users(id),
  resolved_by uuid references public.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint issues_resolution_state_check check (
    (status = 'resolved' and final_resolution is not null and char_length(btrim(final_resolution)) > 0 and resolved_by is not null and resolved_at is not null)
    or
    (status <> 'resolved' and final_resolution is null and resolved_by is null and resolved_at is null)
  )
);

create table public.issue_comments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create table public.issue_history (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  field_name text not null check (field_name in ('created', 'assigned_user_id', 'priority', 'status', 'target_resolution_at', 'planned_resolution', 'final_resolution')),
  old_value text,
  new_value text,
  actor_user_id uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create index issues_order_status_created_idx on public.issues(order_id, status, created_at desc);
create index issues_assignee_status_idx on public.issues(assigned_user_id, status) where assigned_user_id is not null;
create index issues_unresolved_target_idx on public.issues(target_resolution_at, created_at) where status <> 'resolved';
create index issues_unresolved_created_idx on public.issues(created_at) where status <> 'resolved';
create index issues_created_by_idx on public.issues(created_by);
create index issues_resolved_by_idx on public.issues(resolved_by) where resolved_by is not null;
create index issue_comments_issue_created_idx on public.issue_comments(issue_id, created_at);
create index issue_comments_created_by_idx on public.issue_comments(created_by);
create index issue_history_issue_created_idx on public.issue_history(issue_id, created_at);
create index issue_history_actor_idx on public.issue_history(actor_user_id);

alter table public.issues enable row level security;
alter table public.issue_comments enable row level security;
alter table public.issue_history enable row level security;

revoke all on table public.issues, public.issue_comments, public.issue_history from anon, authenticated;
grant select on table public.issues, public.issue_comments, public.issue_history to authenticated;
grant select, insert, update, delete on table public.issues, public.issue_comments, public.issue_history to service_role;

create policy "authorized users can view issues"
on public.issues for select to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.active
      and (
        u.role in ('admin', 'operations_manager', 'packing_operator', 'support_operator', 'viewer')
        or coalesce((u.custom_permissions ->> 'issues.view')::boolean, false)
        or coalesce((u.custom_permissions ->> 'issues.edit')::boolean, false)
      )
  )
);

create policy "authorized users can view issue comments"
on public.issue_comments for select to authenticated
using (exists (select 1 from public.issues i where i.id = issue_comments.issue_id));

create policy "authorized users can view issue history"
on public.issue_history for select to authenticated
using (exists (select 1 from public.issues i where i.id = issue_history.issue_id));
