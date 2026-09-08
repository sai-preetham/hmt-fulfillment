create table if not exists abandoned_cart_leads (
  id uuid primary key default gen_random_uuid(),
  wix_abandoned_checkout_id text not null unique,
  customer_id uuid references customers(id),
  customer_name text,
  email text,
  phone text,
  cart_value numeric,
  currency text,
  checkout_url text,
  items jsonb not null default '[]'::jsonb,
  wix_status text,
  lead_status text not null default 'new' check (lead_status in ('new','contacted','follow_up','converted','closed')),
  assigned_to text,
  notes text,
  next_follow_up_at timestamptz,
  wix_created_at timestamptz,
  wix_updated_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_abandoned_cart_leads_status on abandoned_cart_leads(lead_status, wix_updated_at desc);
create index if not exists idx_abandoned_cart_leads_customer on abandoned_cart_leads(customer_id);
alter table abandoned_cart_leads enable row level security;
