import { readFile } from 'node:fs/promises';

async function main() {
  loadEnv(await readFile('.env', 'utf8'));
  const projectRef = (await readFile('supabase/.temp/project-ref', 'utf8')).trim();
  const accessToken = requiredEnv('SUPABASE_ACCESS_TOKEN');
  const supabaseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');

  const [schema, counts, sqlAudit] = await Promise.all([
    fetchOpenApiSchema(supabaseUrl, serviceRoleKey),
    fetchTableCounts(supabaseUrl, serviceRoleKey),
    executeSql(projectRef, accessToken, auditSql())
  ]);

  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    project_ref: projectRef,
    postgrest_version: schema.info?.version || null,
    exposed_tables: Object.keys(schema.definitions || {}).sort(),
    table_counts: counts,
    sql_audit: sqlAudit
  }, null, 2));
}

function loadEnv(raw) {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index);
    if (process.env[key] !== undefined) continue;
    process.env[key] = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
  }
}

function requiredEnv(key) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

async function fetchOpenApiSchema(baseUrl, key) {
  const response = await fetch(`${baseUrl}/rest/v1/`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/openapi+json'
    }
  });
  if (!response.ok) throw new Error(`OpenAPI fetch failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function fetchTableCounts(baseUrl, key) {
  const tables = [
    'orders',
    'customers',
    'customer_addresses',
    'order_items',
    'shipments',
    'shipment_events',
    'courier_events',
    'tasks',
    'integration_errors',
    'status_history',
    'packing_checklists'
  ];
  const counts = {};
  for (const table of tables) {
    const response = await fetch(`${baseUrl}/rest/v1/${table}?select=id`, {
      method: 'HEAD',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'count=exact'
      }
    });
    counts[table] = response.ok
      ? parseContentRangeCount(response.headers.get('content-range'))
      : { error_status: response.status };
  }
  return counts;
}

function parseContentRangeCount(contentRange) {
  const count = contentRange?.split('/').at(-1);
  return count && count !== '*' ? Number(count) : null;
}

async function executeSql(projectRef, accessToken, query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });
  if (!response.ok) throw new Error(`SQL audit failed: ${response.status} ${await response.text()}`);
  return response.json();
}

function auditSql() {
  return `
with referenced_addresses as (
  select shipping_address_id as id from orders where shipping_address_id is not null
  union
  select billing_address_id from orders where billing_address_id is not null
  union
  select ship_to_address_id from shipments where ship_to_address_id is not null
  union
  select ship_from_address_id from shipments where ship_from_address_id is not null
),
normalized_addresses as (
  select
    id,
    customer_id,
    address_type,
    lower(trim(coalesce(name, ''))) as norm_name,
    regexp_replace(coalesce(phone, ''), '\\D', '', 'g') as norm_phone,
    lower(trim(coalesce(address_line1, ''))) as norm_address_line1,
    lower(trim(coalesce(address_line2, ''))) as norm_address_line2,
    lower(trim(coalesce(city, ''))) as norm_city,
    lower(trim(coalesce(state, ''))) as norm_state,
    regexp_replace(coalesce(postal_code, ''), '\\s', '', 'g') as norm_postal_code,
    upper(trim(coalesce(country, ''))) as norm_country,
    raw_address
  from customer_addresses
),
duplicate_address_groups as (
  select
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
    raw_address,
    count(*) as row_count
  from normalized_addresses
  group by
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
  having count(*) > 1
),
fk_indexes as (
  select
    conrelid::regclass::text as table_name,
    conname as constraint_name,
    pg_get_constraintdef(oid) as constraint_definition,
    exists (
      select 1
      from pg_index i
      where i.indrelid = c.conrelid
        and i.indisvalid
        and i.indkey::smallint[] @> c.conkey
    ) as has_covering_index
  from pg_constraint c
  where contype = 'f'
    and connamespace = 'public'::regnamespace
)
select 'address_totals' as section, jsonb_build_object(
  'customer_addresses', (select count(*) from customer_addresses),
  'referenced_addresses', (select count(*) from referenced_addresses),
  'unreferenced_addresses', (
    select count(*)
    from customer_addresses ca
    where not exists (select 1 from referenced_addresses ra where ra.id = ca.id)
  ),
  'duplicate_exact_groups', (select count(*) from duplicate_address_groups),
  'duplicate_exact_extra_rows', coalesce((select sum(row_count - 1) from duplicate_address_groups), 0)
) as result
union all
select 'missing_fk_indexes', coalesce(jsonb_agg(to_jsonb(fk_indexes) order by table_name, constraint_name), '[]'::jsonb)
from fk_indexes
where not has_covering_index
union all
select 'largest_public_tables', jsonb_agg(to_jsonb(t) order by total_bytes desc)
from (
  select
    relid::regclass::text as table_name,
    n_live_tup as estimated_live_rows,
    pg_total_relation_size(relid) as total_bytes
  from pg_stat_user_tables
  where schemaname = 'public'
  order by pg_total_relation_size(relid) desc
  limit 20
) t;
`;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
