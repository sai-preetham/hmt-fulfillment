-- Additive WooCommerce order identity. Wix/Amazon paths unchanged.
-- Idempotent upsert key for woocombot ingest / Ops pull: woo_order_id
-- (also mirrored to external_order_id with source=woocommerce via existing unique index).
-- Non-partial unique index so PostgREST ON CONFLICT (woo_order_id) works.

alter table orders add column if not exists woo_order_id text;

drop index if exists idx_orders_woo_order_id;

create unique index if not exists idx_orders_woo_order_id
  on orders(woo_order_id);

comment on column orders.woo_order_id is 'WooCommerce order id (REST id). Null for non-Woo sources.';
