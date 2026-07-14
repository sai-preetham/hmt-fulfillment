alter table shipments
  add column if not exists shipment_type text not null default 'original'
  check (shipment_type in ('original', 'replacement', 'reverse', 'rto'));

create index if not exists idx_shipments_order_type_created
  on shipments(order_id, shipment_type, created_at desc);
