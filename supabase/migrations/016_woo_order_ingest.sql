-- Additive WooCommerce order identity. Wix/Amazon paths unchanged.
-- Idempotent upsert key for woocombot ingest: woo_order_id (also mirrored to
-- external_order_id with source=woocommerce via existing unique index).

alter table orders add column if not exists woo_order_id text;

create unique index if not exists idx_orders_woo_order_id
  on orders(woo_order_id)
  where woo_order_id is not null;

comment on column orders.woo_order_id is 'WooCommerce order id (REST id). Null for non-Woo sources.';
