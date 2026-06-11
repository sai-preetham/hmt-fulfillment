-- Add buyer call tracking columns to orders table
alter table orders add column if not exists buyer_call_status text default 'pending';
alter table orders add column if not exists buyer_call_notes text;
alter table orders add column if not exists buyer_called_at timestamptz;

-- Create buyer_calls table for recording call logs
create table if not exists buyer_calls (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) not null,
  staff_user_id uuid references staff_users(id),
  call_status text not null, -- 'answered_confirmed', 'no_answer', 'wrong_number', 'rejected'
  notes text,
  called_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Index for fast lookup by order id
create index if not exists idx_orders_buyer_call_status on orders(buyer_call_status);
create index if not exists idx_buyer_calls_order_id on buyer_calls(order_id);

-- Enable Row Level Security (RLS) on buyer_calls
alter table buyer_calls enable row level security;

grant select, insert, update, delete on buyer_calls to service_role;
