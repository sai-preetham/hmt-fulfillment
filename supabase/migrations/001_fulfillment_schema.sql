create extension if not exists pgcrypto;

create table if not exists staff_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  role text not null default 'operator',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  wix_contact_id text unique,
  name text,
  email text,
  phone text,
  tax_id text,
  tax_id_type text,
  raw_customer jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  address_type text not null,
  name text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  raw_address jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  wix_order_id text unique not null,
  order_number text,
  status text,
  payment_status text,
  fulfillment_status text,
  currency text,
  subtotal numeric,
  shipping_amount numeric,
  tax_amount numeric,
  discount_amount numeric,
  total_amount numeric,
  customer_id uuid references customers(id),
  shipping_address_id uuid references customer_addresses(id),
  billing_address_id uuid references customer_addresses(id),
  selected_shipping_title text,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  raw_order jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists order_source_versions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) not null,
  source text not null default 'wix',
  raw_order jsonb not null,
  observed_at timestamptz not null default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) not null,
  wix_line_item_id text,
  catalog_item_id text,
  variant_id text,
  sku text,
  product_name text,
  quantity numeric not null default 1,
  item_price numeric,
  total_price numeric,
  weight numeric,
  hsn_code text,
  tax_info jsonb not null default '{}'::jsonb,
  raw_line_item jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, wix_line_item_id)
);

create table if not exists payment_refs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) not null,
  payment_status text,
  payment_method text,
  transaction_ref text,
  paid_amount numeric,
  refunded_amount numeric,
  authorized_amount numeric,
  currency text,
  raw_payment jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id)
);

create table if not exists courier_partners (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  active boolean not null default true,
  capabilities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists courier_accounts (
  id uuid primary key default gen_random_uuid(),
  courier_partner_id uuid references courier_partners(id) not null,
  account_name text not null,
  credential_ref text,
  pickup_config jsonb not null default '{}'::jsonb,
  return_config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists courier_services (
  id uuid primary key default gen_random_uuid(),
  courier_partner_id uuid references courier_partners(id) not null,
  service_code text not null,
  display_name text not null,
  direction text not null,
  flow text not null,
  mode_type text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(courier_partner_id, service_code)
);

create table if not exists warehouses (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  address text,
  city text,
  state text,
  pincode text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,
  product_name text,
  hsn_code text,
  default_weight_grams numeric,
  default_length_cm numeric,
  default_width_cm numeric,
  default_height_cm numeric,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists stock_locations (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid references warehouses(id) not null,
  bin_code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(warehouse_id, bin_code)
);

create table if not exists stock_balances (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid references inventory_items(id) not null,
  stock_location_id uuid references stock_locations(id) not null,
  available numeric not null default 0,
  reserved numeric not null default 0,
  damaged numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique(inventory_item_id, stock_location_id)
);

create table if not exists shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id),
  legacy_order_id text,
  order_number text,
  direction text not null default 'forward',
  flow text not null default 'domestic',
  courier_code text not null default 'delhivery',
  courier_service_code text,
  service_mode text,
  status text not null,
  waybill text,
  upload_wbn text,
  pickup_location text,
  ship_to_address_id uuid references customer_addresses(id),
  ship_from_address_id uuid references customer_addresses(id),
  length_cm numeric,
  width_cm numeric,
  height_cm numeric,
  weight_grams numeric,
  cod_amount numeric not null default 0,
  request_payload jsonb not null default '{}'::jsonb,
  carrier_response jsonb,
  error text,
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shipment_attempts (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references shipments(id) not null,
  attempt_number integer not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb,
  http_status integer,
  success boolean not null default false,
  error text,
  created_at timestamptz not null default now(),
  unique(shipment_id, attempt_number)
);

create table if not exists shipment_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references shipments(id) not null,
  event_status text,
  normalized_status text,
  carrier_location text,
  message text,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  raw_event jsonb not null default '{}'::jsonb
);

create table if not exists shipment_labels (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references shipments(id) not null,
  label_url text,
  file_ref text,
  format text,
  raw_label jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now()
);

create table if not exists returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id),
  shipment_id uuid references shipments(id),
  reason text,
  requested_by text,
  status text not null default 'requested',
  refund_ref text,
  reverse_waybill text,
  raw_return jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shipment_supersessions (
  id uuid primary key default gen_random_uuid(),
  old_shipment_id uuid references shipments(id) not null,
  new_shipment_id uuid references shipments(id) not null,
  reason text,
  actor_user_id uuid references staff_users(id),
  created_at timestamptz not null default now()
);

create table if not exists pick_pack_tasks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) not null,
  assigned_user_id uuid references staff_users(id),
  status text not null default 'open',
  picked_at timestamptz,
  packed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pick_pack_task_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references pick_pack_tasks(id) not null,
  order_item_id uuid references order_items(id) not null,
  sku text,
  quantity_required numeric not null default 1,
  quantity_picked numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid references inventory_items(id) not null,
  from_location_id uuid references stock_locations(id),
  to_location_id uuid references stock_locations(id),
  quantity numeric not null,
  movement_type text not null,
  reason text,
  related_order_id uuid references orders(id),
  related_shipment_id uuid references shipments(id),
  actor_user_id uuid references staff_users(id),
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid,
  action text not null,
  actor_user_id uuid references staff_users(id),
  before_json jsonb,
  after_json jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_addresses_customer_id on customer_addresses(customer_id);
create index if not exists idx_orders_customer_id on orders(customer_id);
create index if not exists idx_orders_order_number on orders(order_number);
create index if not exists idx_orders_payment_status on orders(payment_status);
create index if not exists idx_orders_fulfillment_status on orders(fulfillment_status);
create index if not exists idx_order_items_order_id on order_items(order_id);
create index if not exists idx_payment_refs_order_id on payment_refs(order_id);
create index if not exists idx_shipments_order_id on shipments(order_id);
create index if not exists idx_shipments_legacy_order_id on shipments(legacy_order_id);
create index if not exists idx_shipments_waybill on shipments(waybill);
create index if not exists idx_shipments_status on shipments(status);
create index if not exists idx_shipment_attempts_shipment_id on shipment_attempts(shipment_id);
create index if not exists idx_shipment_events_shipment_id on shipment_events(shipment_id);
create index if not exists idx_audit_log_table_record on audit_log(table_name, record_id);

alter table staff_users enable row level security;
alter table customers enable row level security;
alter table customer_addresses enable row level security;
alter table orders enable row level security;
alter table order_source_versions enable row level security;
alter table order_items enable row level security;
alter table payment_refs enable row level security;
alter table courier_partners enable row level security;
alter table courier_accounts enable row level security;
alter table courier_services enable row level security;
alter table warehouses enable row level security;
alter table inventory_items enable row level security;
alter table stock_locations enable row level security;
alter table stock_balances enable row level security;
alter table shipments enable row level security;
alter table shipment_attempts enable row level security;
alter table shipment_events enable row level security;
alter table shipment_labels enable row level security;
alter table returns enable row level security;
alter table shipment_supersessions enable row level security;
alter table pick_pack_tasks enable row level security;
alter table pick_pack_task_items enable row level security;
alter table stock_movements enable row level security;
alter table audit_log enable row level security;

insert into courier_partners(code, name, capabilities)
values
  ('delhivery', 'Delhivery', '{"forward":true,"reverse":true,"domestic":true,"international_pending":true}'::jsonb),
  ('shree_maruti', 'Shree Maruti', '{"forward":false,"reverse":false,"domestic":false,"international":false,"not_configured":true}'::jsonb)
on conflict(code) do nothing;

insert into courier_services(courier_partner_id, service_code, display_name, direction, flow, mode_type)
select id, 'express', 'Express', 'forward', 'domestic', 'air'
from courier_partners where code = 'delhivery'
on conflict do nothing;

insert into courier_services(courier_partner_id, service_code, display_name, direction, flow, mode_type)
select id, 'surface', 'Surface', 'forward', 'domestic', 'surface'
from courier_partners where code = 'delhivery'
on conflict do nothing;

insert into courier_services(courier_partner_id, service_code, display_name, direction, flow, mode_type)
select id, 'reverse_pickup', 'Reverse Pickup', 'reverse', 'domestic', 'pickup'
from courier_partners where code = 'delhivery'
on conflict do nothing;

insert into courier_services(courier_partner_id, service_code, display_name, direction, flow, mode_type)
select id, 'dlv_saver', 'DLV Saver', 'forward', 'international', 'international'
from courier_partners where code = 'delhivery'
on conflict do nothing;

insert into courier_services(courier_partner_id, service_code, display_name, direction, flow, mode_type)
select id, 'deferred_express', 'Deferred Express', 'forward', 'international', 'international'
from courier_partners where code = 'delhivery'
on conflict do nothing;
