-- Turn imported Wix abandoned carts into an operator-facing recovery queue.
alter table abandoned_cart_leads
  add column if not exists last_contacted_at timestamptz,
  add column if not exists call_outcome text,
  add column if not exists recovered_order_id uuid references orders(id),
  add column if not exists recovered_at timestamptz,
  add column if not exists recovery_match_method text;

alter table abandoned_cart_leads
  drop constraint if exists abandoned_cart_leads_lead_status_check;

alter table abandoned_cart_leads
  add constraint abandoned_cart_leads_lead_status_check
  check (lead_status in ('new', 'contacted', 'follow_up', 'not_interested', 'closed'));

create index if not exists idx_abandoned_cart_leads_recovery
  on abandoned_cart_leads(recovered_at desc nulls last);
create index if not exists idx_abandoned_cart_leads_follow_up
  on abandoned_cart_leads(next_follow_up_at asc nulls last);
create index if not exists idx_abandoned_cart_leads_email
  on abandoned_cart_leads(lower(email));
create index if not exists idx_abandoned_cart_leads_phone
  on abandoned_cart_leads(phone);
create index if not exists idx_orders_customer_created
  on orders(customer_id, source_created_at asc);
