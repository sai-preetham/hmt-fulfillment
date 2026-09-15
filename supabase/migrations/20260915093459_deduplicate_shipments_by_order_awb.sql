-- Collapse repeated rows for the same order/AWB, then make that
-- identity atomic so concurrent manual saves and Wix imports cannot recreate
-- the duplicate. Whitespace and letter case in carrier tracking numbers are
-- intentionally ignored.

create temporary table shipment_dedup_map on commit drop as
with ranked as (
  select
    id,
    first_value(id) over (
      partition by order_id, lower(regexp_replace(waybill, '\s+', '', 'g'))
      order by
        (nullif(trim(label_url), '') is not null) desc,
        ((carrier_response ->> 'manual_label_storage_path') is not null) desc,
        updated_at desc,
        created_at desc,
        id desc
    ) as keep_id,
    row_number() over (
      partition by order_id, lower(regexp_replace(waybill, '\s+', '', 'g'))
      order by
        (nullif(trim(label_url), '') is not null) desc,
        ((carrier_response ->> 'manual_label_storage_path') is not null) desc,
        updated_at desc,
        created_at desc,
        id desc
    ) as duplicate_rank
  from shipments
  where order_id is not null and nullif(regexp_replace(waybill, '\s+', '', 'g'), '') is not null
)
select id as drop_id, keep_id
from ranked
where duplicate_rank > 1;

-- A label-bearing manual row is usually the best parent to retain, while a
-- later tracking/import row may have the freshest state and better carrier
-- classification. Merge those fields before moving children.
with latest as (
  select distinct on (m.keep_id) m.keep_id, s.status, s.updated_at
  from shipment_dedup_map m
  join shipments s on s.id in (m.keep_id, m.drop_id)
  order by m.keep_id, s.updated_at desc, s.created_at desc, s.id desc
)
update shipments keep
set status = latest.status,
    updated_at = greatest(keep.updated_at, latest.updated_at)
from latest
where keep.id = latest.keep_id;

with imported_carrier as (
  select distinct on (m.keep_id) m.keep_id, s.courier_code
  from shipment_dedup_map m
  join shipments s on s.id in (m.keep_id, m.drop_id)
  where s.carrier_response ->> 'source' = 'wix'
  order by m.keep_id, s.updated_at desc, s.id desc
)
update shipments keep
set courier_code = imported_carrier.courier_code
from imported_carrier
where keep.id = imported_carrier.keep_id;

-- Preserve related operational history before removing duplicate parent rows.
update shipment_attempts a
set attempt_number = a.attempt_number + 1000000
where a.shipment_id in (
  select drop_id from shipment_dedup_map
  union
  select keep_id from shipment_dedup_map
);

with renumbered as (
  select
    a.id,
    coalesce(m.keep_id, a.shipment_id) as keep_id,
    row_number() over (
      partition by coalesce(m.keep_id, a.shipment_id)
      order by a.created_at, a.id
    ) as next_number
  from shipment_attempts a
  left join shipment_dedup_map m on m.drop_id = a.shipment_id
  where a.shipment_id in (
    select drop_id from shipment_dedup_map
    union
    select keep_id from shipment_dedup_map
  )
)
update shipment_attempts a
set shipment_id = r.keep_id, attempt_number = r.next_number
from renumbered r
where a.id = r.id;

with duplicate_events as (
  select id
  from (
    select
      e.id,
      row_number() over (
        partition by coalesce(m.keep_id, e.shipment_id), e.occurred_at, e.event_status
        order by e.received_at, e.id
      ) as duplicate_rank
    from shipment_events e
    left join shipment_dedup_map m on m.drop_id = e.shipment_id
    where e.shipment_id in (
      select drop_id from shipment_dedup_map
      union
      select keep_id from shipment_dedup_map
    )
  ) ranked
  where duplicate_rank > 1
)
delete from shipment_events e using duplicate_events d where e.id = d.id;

update shipment_events e set shipment_id = m.keep_id from shipment_dedup_map m where e.shipment_id = m.drop_id;
update shipment_labels l set shipment_id = m.keep_id from shipment_dedup_map m where l.shipment_id = m.drop_id;
update returns r set shipment_id = m.keep_id from shipment_dedup_map m where r.shipment_id = m.drop_id;
update stock_movements s set related_shipment_id = m.keep_id from shipment_dedup_map m where s.related_shipment_id = m.drop_id;
update courier_events e set shipment_id = m.keep_id from shipment_dedup_map m where e.shipment_id = m.drop_id;

update shipment_supersessions s set old_shipment_id = m.keep_id from shipment_dedup_map m where s.old_shipment_id = m.drop_id;
update shipment_supersessions s set new_shipment_id = m.keep_id from shipment_dedup_map m where s.new_shipment_id = m.drop_id;
delete from shipment_supersessions where old_shipment_id = new_shipment_id;

do $$
begin
  if to_regclass('public.automation_action_attempts') is not null then
    execute 'update automation_action_attempts a set shipment_id = m.keep_id from shipment_dedup_map m where a.shipment_id = m.drop_id';
  end if;
  if to_regclass('public.customer_messages') is not null then
    execute 'update customer_messages c set shipment_id = m.keep_id from shipment_dedup_map m where c.shipment_id = m.drop_id';
  end if;
end $$;

delete from shipments s using shipment_dedup_map m where s.id = m.drop_id;

create unique index if not exists idx_shipments_order_awb_unique
  on shipments (
    order_id,
    lower(regexp_replace(waybill, '\s+', '', 'g'))
  )
  where order_id is not null and nullif(regexp_replace(waybill, '\s+', '', 'g'), '') is not null;
