-- Finance, inventory, BOM and manufacturing foundation.
-- Existing inventory_items/warehouses remain compatible with order and shipment flows.

alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in (
  'admin', 'operations_manager', 'packing_operator', 'support_operator', 'viewer',
  'finance_admin', 'accountant', 'finance_approver', 'manager', 'employee',
  'warehouse_operator', 'production_operator', 'quality_operator', 'auditor'
));

create table if not exists finance_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  account_type text not null check (account_type in ('asset','liability','equity','income','expense')),
  parent_id uuid references finance_accounts(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists finance_periods (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status text not null default 'open' check (status in ('open','closing','locked')),
  locked_by uuid references users(id),
  locked_at timestamptz,
  close_notes text,
  created_at timestamptz not null default now(),
  unique(period_start, period_end),
  check (period_end >= period_start)
);

create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  gstin text,
  pan text,
  email text,
  phone text,
  address jsonb not null default '{}'::jsonb,
  payment_terms_days integer not null default 30 check (payment_terms_days >= 0),
  preferred_currency text not null default 'INR',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists finance_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (document_type in ('sales_invoice','credit_note','purchase_order','purchase_bill','expense','payroll','bank_statement','reimbursement','payment_batch','tax_pack')),
  status text not null default 'draft' check (status in ('draft','submitted','approved','verified','scheduled','paid','reconciled','cancelled','void')),
  document_number text,
  vendor_id uuid references vendors(id),
  order_id uuid references orders(id),
  document_date date not null default current_date,
  due_date date,
  currency text not null default 'INR',
  exchange_rate numeric not null default 1 check (exchange_rate > 0),
  subtotal numeric not null default 0,
  tax_amount numeric not null default 0,
  tds_amount numeric not null default 0,
  total_amount numeric not null default 0,
  base_total_amount numeric not null default 0,
  tax_details jsonb not null default '{}'::jsonb,
  source_ref text,
  notes text,
  created_by uuid references users(id),
  approved_by uuid references users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(document_type, document_number)
);

create table if not exists finance_document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references finance_documents(id) on delete cascade,
  line_number integer not null,
  description text not null,
  account_id uuid references finance_accounts(id),
  inventory_item_id uuid references inventory_items(id),
  quantity numeric not null default 1,
  unit_price numeric not null default 0,
  tax_rate numeric not null default 0,
  tax_amount numeric not null default 0,
  amount numeric not null default 0,
  dimensions jsonb not null default '{}'::jsonb,
  unique(document_id, line_number)
);

create table if not exists finance_attachments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references finance_documents(id) on delete cascade,
  object_path text not null unique,
  original_name text not null,
  content_type text,
  bytes bigint,
  checksum text,
  scan_status text not null default 'pending' check (scan_status in ('pending','clean','quarantined','rejected')),
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_number text not null unique,
  entry_date date not null,
  source_document_id uuid references finance_documents(id),
  reversal_of_id uuid references journal_entries(id),
  status text not null default 'posted' check (status in ('draft','posted','reversed')),
  memo text,
  created_by uuid references users(id),
  posted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references journal_entries(id) on delete cascade,
  line_number integer not null,
  account_id uuid not null references finance_accounts(id),
  debit numeric not null default 0 check (debit >= 0),
  credit numeric not null default 0 check (credit >= 0),
  currency text not null default 'INR',
  foreign_amount numeric,
  dimensions jsonb not null default '{}'::jsonb,
  memo text,
  unique(journal_entry_id, line_number),
  check ((debit = 0) <> (credit = 0))
);

create table if not exists bank_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bank_name text,
  account_last4 text,
  currency text not null default 'INR',
  account_id uuid references finance_accounts(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references bank_accounts(id),
  filename text not null,
  file_checksum text not null,
  source_type text not null check (source_type in ('csv','xlsx','pdf','manual')),
  status text not null default 'draft' check (status in ('draft','review','imported','rejected')),
  imported_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique(bank_account_id, file_checksum)
);

create table if not exists bank_transactions (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references bank_accounts(id),
  statement_import_id uuid references bank_statement_imports(id),
  transaction_date date not null,
  value_date date,
  description text not null,
  bank_reference text,
  debit numeric not null default 0 check (debit >= 0),
  credit numeric not null default 0 check (credit >= 0),
  balance numeric,
  currency text not null default 'INR',
  status text not null default 'unreconciled' check (status in ('unreconciled','matched','reconciled','ignored')),
  fingerprint text not null,
  created_at timestamptz not null default now(),
  unique(bank_account_id, fingerprint),
  check ((debit = 0) <> (credit = 0))
);

create table if not exists bank_matches (
  id uuid primary key default gen_random_uuid(),
  bank_transaction_id uuid not null references bank_transactions(id) on delete cascade,
  document_id uuid references finance_documents(id),
  journal_entry_id uuid references journal_entries(id),
  matched_amount numeric not null check (matched_amount > 0),
  match_type text not null default 'manual' check (match_type in ('suggested','manual','split')),
  matched_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists reimbursement_claims (
  id uuid primary key default gen_random_uuid(),
  claim_number text not null unique,
  employee_id uuid references users(id) not null,
  manager_id uuid references users(id),
  finance_document_id uuid not null unique references finance_documents(id),
  status text not null default 'submitted' check (status in ('submitted','manager_approved','finance_verified','scheduled','paid','reconciled','rejected')),
  business_purpose text not null,
  rejection_reason text,
  manager_approved_at timestamptz,
  finance_verified_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inventory_lots (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items(id),
  lot_number text not null,
  supplier_lot_number text,
  receipt_document_id uuid references finance_documents(id),
  manufactured_at date,
  expiry_date date,
  warranty_end_date date,
  quality_status text not null default 'approved' check (quality_status in ('quarantine','approved','rejected','expired')),
  created_at timestamptz not null default now(),
  unique(inventory_item_id, lot_number)
);

alter table inventory_items add column if not exists item_type text not null default 'finished_good' check (item_type in ('raw_material','consumable','packaging','subassembly','finished_good','service','non_stock'));
alter table inventory_items add column if not exists base_uom text not null default 'EA';
alter table inventory_items add column if not exists reorder_point numeric not null default 0;
alter table inventory_items add column if not exists safety_stock numeric not null default 0;
alter table inventory_items add column if not exists lead_time_days integer not null default 0;
alter table inventory_items add column if not exists average_cost numeric not null default 0;

create table if not exists inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items(id),
  stock_location_id uuid references stock_locations(id),
  lot_id uuid references inventory_lots(id),
  movement_type text not null check (movement_type in ('receipt','issue','reservation','release','transfer_out','transfer_in','adjustment','return_in','return_out','production_receipt','scrap')),
  quantity numeric not null check (quantity <> 0),
  unit_cost numeric not null default 0,
  source_document_id uuid references finance_documents(id),
  order_id uuid references orders(id),
  work_order_id uuid,
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- Legacy balances are retained for migration/reference only. New stock changes must be ledger-backed.
revoke insert, update, delete on stock_balances from authenticated;

create table if not exists inventory_counts (
  id uuid primary key default gen_random_uuid(),
  stock_location_id uuid not null references stock_locations(id),
  status text not null default 'draft' check (status in ('draft','counted','approved','posted')),
  counted_at timestamptz,
  approved_by uuid references users(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists inventory_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references inventory_counts(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id),
  lot_id uuid references inventory_lots(id),
  system_quantity numeric not null default 0,
  counted_quantity numeric,
  unique(count_id, inventory_item_id, lot_id)
);

create table if not exists boms (
  id uuid primary key default gen_random_uuid(),
  finished_item_id uuid not null references inventory_items(id),
  revision text not null,
  status text not null default 'draft' check (status in ('draft','approved','obsolete')),
  effective_from date,
  effective_to date,
  quantity_basis numeric not null default 1 check (quantity_basis > 0),
  expected_yield numeric not null default 1 check (expected_yield > 0),
  instructions text,
  approved_by uuid references users(id),
  approved_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique(finished_item_id, revision)
);

create table if not exists bom_lines (
  id uuid primary key default gen_random_uuid(),
  bom_id uuid not null references boms(id) on delete cascade,
  component_item_id uuid not null references inventory_items(id),
  quantity numeric not null check (quantity > 0),
  uom text not null default 'EA',
  scrap_percent numeric not null default 0 check (scrap_percent >= 0 and scrap_percent < 100),
  sequence integer not null default 10,
  notes text,
  unique(bom_id, component_item_id)
);

create table if not exists work_orders (
  id uuid primary key default gen_random_uuid(),
  work_order_number text not null unique,
  finished_item_id uuid not null references inventory_items(id),
  bom_id uuid not null references boms(id),
  bom_snapshot jsonb not null default '{}'::jsonb,
  warehouse_id uuid references warehouses(id),
  output_location_id uuid references stock_locations(id),
  planned_quantity numeric not null check (planned_quantity > 0),
  completed_quantity numeric not null default 0,
  scrap_quantity numeric not null default 0,
  status text not null default 'planned' check (status in ('planned','released','material_picked','in_progress','quality_check','completed','cancelled')),
  planned_start date,
  due_date date,
  actual_labour_cost numeric not null default 0,
  actual_overhead_cost numeric not null default 0,
  released_by uuid references users(id),
  completed_by uuid references users(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table inventory_movements add constraint inventory_movements_work_order_fk foreign key (work_order_id) references work_orders(id);

create table if not exists work_order_materials (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id) on delete cascade,
  component_item_id uuid not null references inventory_items(id),
  lot_id uuid references inventory_lots(id),
  required_quantity numeric not null,
  reserved_quantity numeric not null default 0,
  issued_quantity numeric not null default 0,
  returned_quantity numeric not null default 0,
  unit_cost numeric not null default 0,
  unique(work_order_id, component_item_id, lot_id)
);

create table if not exists quality_checks (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id) on delete cascade,
  status text not null check (status in ('pending','passed','failed')),
  disposition text check (disposition in ('rework','scrap','accept_with_deviation')),
  notes text,
  inspected_by uuid references users(id),
  inspected_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists finance_audit_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  before_value jsonb,
  after_value jsonb,
  actor_id uuid references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_finance_documents_status_date on finance_documents(status, document_date desc);
create index if not exists idx_bank_transactions_status_date on bank_transactions(status, transaction_date desc);
create index if not exists idx_inventory_movements_item_created on inventory_movements(inventory_item_id, created_at);
create index if not exists idx_inventory_movements_lot on inventory_movements(lot_id) where lot_id is not null;
create index if not exists idx_work_orders_status_due on work_orders(status, due_date);
create index if not exists idx_journal_lines_account on journal_lines(account_id);

insert into storage.buckets (id, name, public) values ('finance-documents', 'finance-documents', false) on conflict (id) do update set public = false;

alter table finance_accounts enable row level security;
alter table finance_periods enable row level security;
alter table vendors enable row level security;
alter table finance_documents enable row level security;
alter table finance_document_lines enable row level security;
alter table finance_attachments enable row level security;
alter table journal_entries enable row level security;
alter table journal_lines enable row level security;
alter table bank_accounts enable row level security;
alter table bank_statement_imports enable row level security;
alter table bank_transactions enable row level security;
alter table bank_matches enable row level security;
alter table reimbursement_claims enable row level security;
alter table inventory_lots enable row level security;
alter table inventory_movements enable row level security;
alter table inventory_counts enable row level security;
alter table inventory_count_lines enable row level security;
alter table boms enable row level security;
alter table bom_lines enable row level security;
alter table work_orders enable row level security;
alter table work_order_materials enable row level security;
alter table quality_checks enable row level security;
alter table finance_audit_events enable row level security;

grant select, insert, update, delete on finance_accounts, finance_periods, vendors, finance_documents, finance_document_lines, finance_attachments, journal_entries, journal_lines, bank_accounts, bank_statement_imports, bank_transactions, bank_matches, reimbursement_claims, inventory_lots, inventory_movements, inventory_counts, inventory_count_lines, boms, bom_lines, work_orders, work_order_materials, quality_checks, finance_audit_events to authenticated, service_role;

-- App routes use service_role. Direct authenticated access is limited to active staff;
-- reimbursement claim visibility also includes the submitting employee.
create policy "finance staff read accounts" on finance_accounts for select to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));
create policy "finance staff read periods" on finance_periods for select to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));
create policy "finance staff read vendors" on vendors for select to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));
create policy "finance staff read documents" on finance_documents for select to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));
create policy "finance staff read document lines" on finance_document_lines for select to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));
create policy "finance staff read attachments" on finance_attachments for select to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));
create policy "finance staff read journals" on journal_entries for select to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));
create policy "finance staff read journal lines" on journal_lines for select to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));
create policy "finance staff read bank" on bank_transactions for select to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));
create policy "finance staff read stock" on inventory_movements for select to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));
create policy "finance staff read lots" on inventory_lots for select to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));
create policy "finance staff read boms" on boms for select to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));
create policy "finance staff read bom lines" on bom_lines for select to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));
create policy "finance staff read work orders" on work_orders for select to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));
create policy "finance staff read materials" on work_order_materials for select to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));
create policy "finance staff read quality" on quality_checks for select to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));
create policy "finance staff read reimbursement" on reimbursement_claims for select to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));

create policy "finance documents write" on finance_documents for all to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin','finance_admin','accountant','finance_approver'))) with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin','finance_admin','accountant','finance_approver')));
create policy "inventory write" on inventory_movements for insert to authenticated with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin','warehouse_operator','production_operator','finance_admin')));
create policy "bom write" on boms for all to authenticated using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin','production_operator','finance_admin'))) with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active and u.role in ('admin','production_operator','finance_admin')));

create policy "private finance documents" on storage.objects for select to authenticated using (bucket_id = 'finance-documents' and exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));
create policy "finance document uploads" on storage.objects for insert to authenticated with check (bucket_id = 'finance-documents' and exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active));
