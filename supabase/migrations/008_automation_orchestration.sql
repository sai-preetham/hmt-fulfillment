create extension if not exists pgcrypto;

alter table orders add column if not exists automation_hold boolean not null default false;
alter table orders add column if not exists automation_hold_reason text;
alter table orders add column if not exists last_automation_status text;
alter table orders add column if not exists last_automation_error text;
alter table orders add column if not exists last_automation_at timestamptz;
alter table orders add column if not exists customer_message_status text;
alter table orders add column if not exists customer_message_error text;
alter table orders add column if not exists customer_message_sent_at timestamptz;

create index if not exists idx_orders_automation_hold on orders(automation_hold);
create index if not exists idx_orders_last_automation_status on orders(last_automation_status);
create index if not exists idx_orders_customer_message_status on orders(customer_message_status);

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null default 'manual',
  status text not null default 'running' check (status in ('running', 'success', 'failed', 'partial')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  counters jsonb not null default '{}'::jsonb,
  error_summary text,
  raw_result jsonb not null default '{}'::jsonb
);

create table if not exists automation_action_attempts (
  id uuid primary key default gen_random_uuid(),
  action_key text not null unique,
  action_type text not null,
  order_id uuid references orders(id) on delete cascade,
  shipment_id uuid references shipments(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'running', 'success', 'failed', 'blocked', 'skipped')),
  attempts integer not null default 0,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_automation_action_attempts_order on automation_action_attempts(order_id, action_type);
create index if not exists idx_automation_action_attempts_status on automation_action_attempts(status, next_retry_at);

create table if not exists customer_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  shipment_id uuid references shipments(id) on delete set null,
  message_type text not null,
  channel text not null default 'chatwoot',
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  recipient_ref text,
  provider_message_id text,
  content text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, message_type, channel)
);

create index if not exists idx_customer_messages_order on customer_messages(order_id);
create index if not exists idx_customer_messages_status on customer_messages(status);

create table if not exists fedex_export_batches (
  id uuid primary key default gen_random_uuid(),
  batch_number text unique not null,
  status text not null default 'open' check (status in ('open', 'exported', 'closed')),
  exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists fedex_export_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references fedex_export_batches(id) on delete cascade,
  order_id uuid references orders(id) on delete cascade,
  status text not null default 'pending_awb' check (status in ('pending_awb', 'awb_received', 'cancelled')),
  awb_number text,
  csv_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id)
);

create index if not exists idx_fedex_export_items_batch on fedex_export_items(batch_id);
create index if not exists idx_fedex_export_items_status on fedex_export_items(status);
