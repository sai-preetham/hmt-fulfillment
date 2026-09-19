-- Ensure woo_order_id unique index is non-partial (PostgREST ON CONFLICT).
-- Safe to re-run: drops any prior partial/non-partial index with the same name.

drop index if exists idx_orders_woo_order_id;

create unique index if not exists idx_orders_woo_order_id
  on orders(woo_order_id);
