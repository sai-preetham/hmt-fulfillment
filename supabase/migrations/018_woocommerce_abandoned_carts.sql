alter table abandoned_cart_leads
  alter column wix_abandoned_checkout_id drop not null,
  add column if not exists source text not null default 'wix',
  add column if not exists external_cart_id text,
  add column if not exists follow_up_status text,
  add column if not exists follow_up_sent_at timestamptz,
  add column if not exists follow_up_error text,
  add column if not exists follow_up_provider_message_id text;

update abandoned_cart_leads
set source = 'wix', external_cart_id = wix_abandoned_checkout_id
where external_cart_id is null;

alter table abandoned_cart_leads
  alter column external_cart_id set not null;

create unique index if not exists idx_abandoned_cart_leads_source_external
  on abandoned_cart_leads(source, external_cart_id);

create index if not exists idx_abandoned_cart_leads_follow_up_message
  on abandoned_cart_leads(source, follow_up_sent_at)
  where recovered_order_id is null;

create or replace function claim_woo_abandoned_cart_follow_up()
returns setof abandoned_cart_leads
language plpgsql
as $$
begin
  return query
  update abandoned_cart_leads
  set follow_up_status = 'sending', follow_up_error = null, updated_at = now()
  where id = (
    select id
    from abandoned_cart_leads
    where source = 'woocommerce'
      and recovered_order_id is null
      and follow_up_sent_at is null
      and nullif(trim(phone), '') is not null
      and (
        follow_up_status is null
        or follow_up_status in ('failed', 'skipped')
        or (follow_up_status = 'sending' and updated_at < now() - interval '15 minutes')
      )
    order by wix_created_at asc nulls last
    for update skip locked
    limit 1
  )
  returning *;
end;
$$;

revoke all on function claim_woo_abandoned_cart_follow_up() from public;
grant execute on function claim_woo_abandoned_cart_follow_up() to service_role;
