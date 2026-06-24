create extension if not exists pgcrypto;

alter table orders alter column wix_order_id drop not null;

alter table orders add column if not exists external_order_id text;
alter table orders add column if not exists source text not null default 'wix';
alter table orders add column if not exists internal_status text not null default 'new';
alter table orders add column if not exists installation_status text not null default 'not_contacted';
alter table orders add column if not exists installation_method text not null default 'unknown'
  check (installation_method in ('unknown', 'diy', 'hmt_bengaluru_store', 'nearby_garage'));
alter table orders add column if not exists install_location text;
alter table orders add column if not exists garage_name text;
alter table orders add column if not exists garage_contact_person text;
alter table orders add column if not exists garage_phone text;
alter table orders add column if not exists garage_email text;
alter table orders add column if not exists garage_address text;
alter table orders add column if not exists garage_city text;
alter table orders add column if not exists garage_state text;
alter table orders add column if not exists garage_pincode text;
alter table orders add column if not exists feedback_status text not null default 'feedback_pending';
alter table orders add column if not exists bike_model text;
alter table orders add column if not exists product_variant text;
alter table orders add column if not exists quantity numeric not null default 1;
alter table orders add column if not exists assigned_operator text;
alter table orders add column if not exists tags text[] not null default '{}'::text[];
alter table orders add column if not exists notes text;
alter table orders add column if not exists courier text;
alter table orders add column if not exists awb_number text;
alter table orders add column if not exists tracking_url text;
alter table orders add column if not exists package_weight_grams numeric;
alter table orders add column if not exists package_length_cm numeric;
alter table orders add column if not exists package_width_cm numeric;
alter table orders add column if not exists package_height_cm numeric;
alter table orders add column if not exists packing_photo_url text;
alter table orders add column if not exists chatwoot_contact_id text;
alter table orders add column if not exists chatwoot_conversation_id text;
alter table orders add column if not exists whatsapp_number text;
alter table orders add column if not exists last_communication_at timestamptz;
alter table orders add column if not exists last_message_type text;

create unique index if not exists idx_orders_source_external_id
  on orders(source, external_order_id)
  where external_order_id is not null;

create index if not exists idx_orders_source on orders(source);
create index if not exists idx_orders_internal_status on orders(internal_status);
create index if not exists idx_orders_installation_status on orders(installation_status);
create index if not exists idx_orders_installation_method on orders(installation_method);
create index if not exists idx_orders_feedback_status on orders(feedback_status);
create index if not exists idx_orders_awb_number on orders(awb_number);
create index if not exists idx_orders_bike_model on orders using gin(to_tsvector('simple', coalesce(bike_model, '')));
create index if not exists idx_orders_tags on orders using gin(tags);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text unique not null,
  full_name text,
  role text not null default 'viewer' check (role in ('admin', 'operations_manager', 'packing_operator', 'support_operator', 'viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists packing_checklists (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  item_name text not null,
  is_packed boolean not null default false,
  checked_by uuid references users(id),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, item_name)
);

create table if not exists installation_status (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  status text not null default 'not_contacted',
  installation_method text not null default 'unknown'
    check (installation_method in ('unknown', 'diy', 'hmt_bengaluru_store', 'nearby_garage')),
  install_location text,
  garage_name text,
  garage_contact_person text,
  garage_phone text,
  garage_email text,
  garage_address text,
  garage_city text,
  garage_state text,
  garage_pincode text,
  installer_name text,
  installation_date date,
  bike_photo_url text,
  issue_ticket_id uuid,
  notes text,
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  status text not null default 'feedback_pending',
  rating integer check (rating between 1 and 5),
  feedback_text text,
  review_url text,
  ugc_url text,
  issue_escalated boolean not null default false,
  next_followup_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  order_id uuid references orders(id) on delete cascade,
  assigned_user_id uuid references users(id),
  assigned_operator text,
  due_date timestamptz,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'blocked', 'done', 'cancelled')),
  notes text,
  created_by uuid references users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,
  body text not null,
  note_type text not null default 'internal',
  actor_user_id uuid references users(id),
  actor_name text,
  created_at timestamptz not null default now()
);

create table if not exists status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  field_name text not null,
  old_value text,
  new_value text,
  notes text,
  actor_user_id uuid references users(id),
  actor_name text,
  created_at timestamptz not null default now()
);

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,
  attachment_type text not null,
  bucket text not null default 'crm-attachments',
  object_path text not null,
  public_url text,
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists integrations (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  status text not null default 'active',
  config jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider)
);

create table if not exists integration_errors (
  id uuid primary key default gen_random_uuid(),
  integration text not null,
  operation text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  occurred_at timestamptz not null default now()
);

create table if not exists courier_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references shipments(id) on delete cascade,
  courier text not null,
  awb_number text,
  status text not null,
  location text,
  message text,
  event_time timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table courier_accounts add column if not exists provider text;
alter table courier_accounts add column if not exists account_code text;
alter table courier_accounts add column if not exists environment text not null default 'production';
alter table courier_accounts add column if not exists webhook_secret_ref text;

create index if not exists idx_packing_checklists_order_id on packing_checklists(order_id);
create index if not exists idx_installation_status_order_id on installation_status(order_id);
create index if not exists idx_feedback_order_id on feedback(order_id);
create index if not exists idx_tasks_order_status_due on tasks(order_id, status, due_date);
create index if not exists idx_notes_order_id on notes(order_id);
create index if not exists idx_status_history_order_id on status_history(order_id, created_at desc);
create index if not exists idx_attachments_order_id on attachments(order_id);
create index if not exists idx_integration_errors_status on integration_errors(status, occurred_at desc);
create index if not exists idx_courier_events_awb on courier_events(awb_number);

alter table users enable row level security;
alter table packing_checklists enable row level security;
alter table installation_status enable row level security;
alter table feedback enable row level security;
alter table tasks enable row level security;
alter table notes enable row level security;
alter table status_history enable row level security;
alter table attachments enable row level security;
alter table integrations enable row level security;
alter table integration_errors enable row level security;
alter table courier_events enable row level security;

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on
  users,
  customers,
  customer_addresses,
  orders,
  order_items,
  shipments,
  courier_events,
  packing_checklists,
  installation_status,
  feedback,
  tasks,
  notes,
  status_history,
  attachments,
  integrations,
  integration_errors,
  courier_accounts
to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

drop policy if exists "crm users can view users" on users;
create policy "crm users can view users" on users
for select to authenticated
using (
  auth_user_id = (select auth.uid())
  or ((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('admin', 'operations_manager')
);

drop policy if exists "admins can manage users" on users;
create policy "admins can manage users" on users
for all to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "crm users can view customers" on customers;
create policy "crm users can view customers" on customers
for select to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));

drop policy if exists "crm managers can edit customers" on customers;
create policy "crm managers can edit customers" on customers
for all to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager', 'support_operator')))
with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager', 'support_operator')));

drop policy if exists "crm users can view addresses" on customer_addresses;
create policy "crm users can view addresses" on customer_addresses
for select to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));

drop policy if exists "crm managers can edit addresses" on customer_addresses;
create policy "crm managers can edit addresses" on customer_addresses
for all to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager', 'support_operator')))
with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager', 'support_operator')));

drop policy if exists "crm users can view orders" on orders;
create policy "crm users can view orders" on orders
for select to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));

drop policy if exists "ops managers can edit orders" on orders;
create policy "ops managers can edit orders" on orders
for update to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager')))
with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager')));

drop policy if exists "admins and managers can create orders" on orders;
create policy "admins and managers can create orders" on orders
for insert to authenticated
with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager')));

drop policy if exists "packing operators can update packing fields" on packing_checklists;
create policy "packing operators can update packing fields" on packing_checklists
for all to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager', 'packing_operator')))
with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager', 'packing_operator')));

drop policy if exists "support can manage installation" on installation_status;
create policy "support can manage installation" on installation_status
for all to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager', 'support_operator')))
with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager', 'support_operator')));

drop policy if exists "support can manage feedback" on feedback;
create policy "support can manage feedback" on feedback
for all to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager', 'support_operator')))
with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager', 'support_operator')));

drop policy if exists "crm users can manage tasks" on tasks;
create policy "crm users can manage tasks" on tasks
for all to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager', 'packing_operator', 'support_operator')))
with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager', 'packing_operator', 'support_operator')));

drop policy if exists "crm users can manage notes" on notes;
create policy "crm users can manage notes" on notes
for all to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager', 'packing_operator', 'support_operator')))
with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager', 'packing_operator', 'support_operator')));

drop policy if exists "crm users can view audit trails" on status_history;
create policy "crm users can view audit trails" on status_history
for select to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));

drop policy if exists "crm users can append audit trails" on status_history;
create policy "crm users can append audit trails" on status_history
for insert to authenticated
with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager', 'packing_operator', 'support_operator')));

drop policy if exists "crm users can manage attachments" on attachments;
create policy "crm users can manage attachments" on attachments
for all to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager', 'packing_operator', 'support_operator')))
with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager', 'packing_operator', 'support_operator')));

drop policy if exists "admins can manage integrations" on integrations;
create policy "admins can manage integrations" on integrations
for all to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager')))
with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager')));

drop policy if exists "crm users can view integration errors" on integration_errors;
create policy "crm users can view integration errors" on integration_errors
for select to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));

drop policy if exists "ops managers can resolve integration errors" on integration_errors;
create policy "ops managers can resolve integration errors" on integration_errors
for all to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager')))
with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager')));

drop policy if exists "crm users can view courier events" on courier_events;
create policy "crm users can view courier events" on courier_events
for select to authenticated
using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));

insert into storage.buckets(id, name, public)
values ('crm-attachments', 'crm-attachments', false)
on conflict (id) do nothing;

drop policy if exists "crm users can read crm attachments" on storage.objects;
create policy "crm users can read crm attachments" on storage.objects
for select to authenticated
using (
  bucket_id = 'crm-attachments'
  and exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active)
);

drop policy if exists "crm users can upload crm attachments" on storage.objects;
create policy "crm users can upload crm attachments" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'crm-attachments'
  and exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin', 'operations_manager', 'packing_operator', 'support_operator'))
);

insert into integrations(provider, status, config)
values
  ('wix', 'active', '{"pull_paid_orders": true, "push_tracking": true}'::jsonb),
  ('amazon', 'pending_credentials', '{"pull_orders": true, "manual_correction": true}'::jsonb),
  ('chatwoot', 'pending_credentials', '{"conversation_system": "external"}'::jsonb),
  ('delhivery', 'active', '{"booking": true, "tracking": true}'::jsonb),
  ('fedex', 'pending_credentials', '{"booking": true, "tracking": true}'::jsonb),
  ('shree_maruti', 'pending_credentials', '{"booking": true, "tracking": true}'::jsonb)
on conflict(provider) do update set config = excluded.config, updated_at = now();
