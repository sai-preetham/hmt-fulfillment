create extension if not exists pg_trgm;

create index if not exists idx_orders_source_created_at_desc
  on orders(source_created_at desc);

create index if not exists idx_orders_internal_status_created_at_desc
  on orders(internal_status, source_created_at desc);

create index if not exists idx_orders_source_created_at_desc
  on orders(source, source_created_at desc);

create index if not exists idx_shipments_active_waybill_status_updated
  on shipments(status, updated_at)
  where waybill is not null
    and coalesce(waybill, '') <> ''
    and status not in ('delivered', 'rto', 'cancelled', 'failed');

create index if not exists idx_courier_accounts_courier_partner_id
  on courier_accounts(courier_partner_id);

create index if not exists idx_order_source_versions_order_observed
  on order_source_versions(order_id, observed_at desc);

create index if not exists idx_orders_shipping_address_id
  on orders(shipping_address_id);

create index if not exists idx_orders_billing_address_id
  on orders(billing_address_id);

create index if not exists idx_pick_pack_task_items_order_item_id
  on pick_pack_task_items(order_item_id);

create index if not exists idx_pick_pack_task_items_task_id
  on pick_pack_task_items(task_id);

create index if not exists idx_pick_pack_tasks_assigned_user_id
  on pick_pack_tasks(assigned_user_id);

create index if not exists idx_pick_pack_tasks_order_id
  on pick_pack_tasks(order_id);

create index if not exists idx_returns_order_id
  on returns(order_id);

create index if not exists idx_returns_shipment_id
  on returns(shipment_id);

create index if not exists idx_shipment_labels_shipment_id
  on shipment_labels(shipment_id);

create index if not exists idx_shipment_supersessions_actor_user_id
  on shipment_supersessions(actor_user_id);

create index if not exists idx_shipment_supersessions_new_shipment_id
  on shipment_supersessions(new_shipment_id);

create index if not exists idx_shipment_supersessions_old_shipment_id
  on shipment_supersessions(old_shipment_id);

create index if not exists idx_shipments_ship_from_address_id
  on shipments(ship_from_address_id);

create index if not exists idx_shipments_ship_to_address_id
  on shipments(ship_to_address_id);

create index if not exists idx_stock_movements_actor_user_id
  on stock_movements(actor_user_id);

create index if not exists idx_stock_movements_from_location_id
  on stock_movements(from_location_id);

create index if not exists idx_stock_movements_inventory_item_id
  on stock_movements(inventory_item_id);

create index if not exists idx_stock_movements_related_order_id
  on stock_movements(related_order_id);

create index if not exists idx_stock_movements_related_shipment_id
  on stock_movements(related_shipment_id);

create index if not exists idx_stock_movements_to_location_id
  on stock_movements(to_location_id);

create index if not exists idx_attachments_customer_id
  on attachments(customer_id);

create index if not exists idx_attachments_uploaded_by
  on attachments(uploaded_by);

create index if not exists idx_courier_events_shipment_id
  on courier_events(shipment_id);

create index if not exists idx_feedback_created_by
  on feedback(created_by);

create index if not exists idx_installation_status_updated_by
  on installation_status(updated_by);

create index if not exists idx_integration_errors_resolved_by
  on integration_errors(resolved_by);

create index if not exists idx_notes_actor_user_id
  on notes(actor_user_id);

create index if not exists idx_notes_customer_id
  on notes(customer_id);

create index if not exists idx_packing_checklists_checked_by
  on packing_checklists(checked_by);

create index if not exists idx_status_history_actor_user_id
  on status_history(actor_user_id);

create index if not exists idx_tasks_assigned_user_id
  on tasks(assigned_user_id);

create index if not exists idx_tasks_created_by
  on tasks(created_by);

create index if not exists idx_orders_order_number_trgm
  on orders using gin(order_number gin_trgm_ops);

create index if not exists idx_orders_external_order_id_trgm
  on orders using gin(external_order_id gin_trgm_ops);

create index if not exists idx_orders_awb_number_trgm
  on orders using gin(awb_number gin_trgm_ops);

create index if not exists idx_orders_bike_model_trgm
  on orders using gin(bike_model gin_trgm_ops);

create table if not exists customer_address_cleanup_backup (
  cleanup_run_id uuid not null,
  backed_up_at timestamptz not null default now(),
  address_id uuid not null,
  customer_id uuid,
  address_type text,
  name text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  raw_address jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  primary key (cleanup_run_id, address_id)
);

create table if not exists customer_address_cleanup_map (
  cleanup_run_id uuid not null,
  duplicate_address_id uuid not null,
  canonical_address_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now(),
  primary key (cleanup_run_id, duplicate_address_id)
);

alter table customer_address_cleanup_backup enable row level security;
alter table customer_address_cleanup_map enable row level security;

do $$
declare
  v_cleanup_run_id uuid := gen_random_uuid();
begin
  insert into customer_address_cleanup_backup (
    cleanup_run_id,
    address_id,
    customer_id,
    address_type,
    name,
    phone,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    raw_address,
    created_at,
    updated_at
  )
  select
    v_cleanup_run_id,
    id,
    customer_id,
    address_type,
    name,
    phone,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    raw_address,
    created_at,
    updated_at
  from customer_addresses;

  with normalized as (
    select
      ca.*,
      lower(trim(coalesce(ca.name, ''))) as norm_name,
      regexp_replace(coalesce(ca.phone, ''), '\D', '', 'g') as norm_phone,
      lower(trim(coalesce(ca.address_line1, ''))) as norm_address_line1,
      lower(trim(coalesce(ca.address_line2, ''))) as norm_address_line2,
      lower(trim(coalesce(ca.city, ''))) as norm_city,
      lower(trim(coalesce(ca.state, ''))) as norm_state,
      regexp_replace(coalesce(ca.postal_code, ''), '\s', '', 'g') as norm_postal_code,
      upper(trim(coalesce(ca.country, ''))) as norm_country
    from customer_addresses ca
  ),
  ranked as (
    select
      n.*,
      first_value(id) over (
        partition by
          customer_id,
          address_type,
          norm_name,
          norm_phone,
          norm_address_line1,
          norm_address_line2,
          norm_city,
          norm_state,
          norm_postal_code,
          norm_country,
          raw_address
        order by
          case
            when exists (select 1 from orders o where o.shipping_address_id = n.id or o.billing_address_id = n.id) then 0
            when exists (select 1 from shipments s where s.ship_to_address_id = n.id or s.ship_from_address_id = n.id) then 1
            else 2
          end,
          updated_at desc nulls last,
          created_at desc nulls last,
          id
      ) as canonical_id
    from normalized n
  )
  insert into customer_address_cleanup_map (cleanup_run_id, duplicate_address_id, canonical_address_id, reason)
  select v_cleanup_run_id, id, canonical_id, 'exact normalized duplicate'
  from ranked
  where id <> canonical_id
  on conflict (cleanup_run_id, duplicate_address_id) do nothing;

  update orders o
  set shipping_address_id = m.canonical_address_id,
      updated_at = now()
  from customer_address_cleanup_map m
  where m.cleanup_run_id = v_cleanup_run_id
    and o.shipping_address_id = m.duplicate_address_id;

  update orders o
  set billing_address_id = m.canonical_address_id,
      updated_at = now()
  from customer_address_cleanup_map m
  where m.cleanup_run_id = v_cleanup_run_id
    and o.billing_address_id = m.duplicate_address_id;

  update shipments s
  set ship_to_address_id = m.canonical_address_id,
      updated_at = now()
  from customer_address_cleanup_map m
  where m.cleanup_run_id = v_cleanup_run_id
    and s.ship_to_address_id = m.duplicate_address_id;

  update shipments s
  set ship_from_address_id = m.canonical_address_id,
      updated_at = now()
  from customer_address_cleanup_map m
  where m.cleanup_run_id = v_cleanup_run_id
    and s.ship_from_address_id = m.duplicate_address_id;

  delete from customer_addresses ca
  using customer_address_cleanup_map m
  where m.cleanup_run_id = v_cleanup_run_id
    and ca.id = m.duplicate_address_id
    and not exists (select 1 from orders o where o.shipping_address_id = ca.id or o.billing_address_id = ca.id)
    and not exists (select 1 from shipments s where s.ship_to_address_id = ca.id or s.ship_from_address_id = ca.id);
end $$;
