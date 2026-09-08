export function sanitizeSearchQuery(query = '') {
  return String(query || '')
    .trim()
    .replace(/[,()*%\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

export function phoneDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

export function compactAlphanumeric(value = '') {
  return String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

export function searchVariants(query = '') {
  const sanitized = sanitizeSearchQuery(query);
  const digits = phoneDigits(sanitized);
  const compact = compactAlphanumeric(sanitized);
  return {
    query: sanitized,
    digits,
    compact,
    variants: [...new Set([sanitized, compact, digits].filter(Boolean))]
  };
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

export function matchesOpsSearch(record = {}, query = '') {
  const raw = String(query || '').trim();
  if (!raw) return true;
  const { query: needle, digits, compact } = searchVariants(raw);
  const needleLower = needle.toLowerCase();
  const fields = [
    record.customer_name,
    record.name,
    record.phone,
    record.whatsapp_number,
    record.shipping_phone,
    record.billing_phone,
    record.customer_phone,
    record.order_number,
    record.external_order_id,
    record.wix_order_id,
    record.awb_number,
    record.shipment_waybill,
    record.waybill,
    record.bike_model,
    record.source
  ];
  for (const field of fields) {
    const text = String(field || '');
    if (!text) continue;
    if (text.toLowerCase().includes(needleLower)) return true;
    const fieldDigits = phoneDigits(text);
    if (digits.length >= 4 && fieldDigits.includes(digits)) return true;
    if (digits.length >= 6 && fieldDigits.length >= 10 && fieldDigits.slice(-10).includes(digits.slice(-Math.min(10, digits.length)))) return true;
    if (compact.length >= 4 && compactAlphanumeric(text).includes(compact)) return true;
  }
  return false;
}

function addIds(set, rows, key = 'id') {
  for (const row of rows || []) {
    const value = row?.[key];
    if (value) set.add(value);
  }
}

async function runQuery(builder) {
  try {
    const result = await builder;
    if (result?.error) return { data: [], error: result.error };
    return { data: result?.data || [], error: null };
  } catch (error) {
    return { data: [], error };
  }
}

function orIlike(fields, value) {
  return fields.map(field => `${field}.ilike.%${value}%`).join(',');
}

function phoneFragments(digits) {
  if (!digits) return [];
  if (digits.length < 5) return digits.length >= 4 ? [digits] : [];
  const national = digits.slice(-10);
  const fragments = [digits, national];
  for (let index = 0; index <= national.length - 5; index += 1) {
    fragments.push(national.slice(index, index + 5));
  }
  return unique(fragments);
}

export async function findOrderIdsMatchingQuery(supabase, query, { limit = 400 } = {}) {
  const parsed = searchVariants(query);
  if (!parsed.query) return [];
  const ids = new Set();
  const orderFieldSets = [
    ['order_number', 'external_order_id', 'awb_number', 'shipment_waybill', 'whatsapp_number', 'bike_model'],
    ['order_number', 'external_order_id', 'awb_number', 'shipment_waybill', 'bike_model'],
    ['order_number', 'external_order_id', 'awb_number', 'bike_model']
  ];

  for (const fields of orderFieldSets) {
    const found = new Set();
    let failed = false;
    for (const variant of parsed.variants) {
      const { data, error } = await runQuery(
        supabase.from('orders').select('id').or(orIlike(fields, variant)).limit(limit)
      );
      if (error) {
        failed = true;
        break;
      }
      addIds(found, data);
    }
    if (!failed) {
      found.forEach(id => ids.add(id));
      break;
    }
  }

  const customerFilters = unique([
    ...parsed.variants.flatMap(variant => [`name.ilike.%${variant}%`, `phone.ilike.%${variant}%`]),
    ...phoneFragments(parsed.digits).map(fragment => `phone.ilike.%${fragment}%`)
  ]).slice(0, 40);

  if (customerFilters.length) {
    const customers = (await runQuery(
      supabase.from('customers').select('id,name,phone').or(customerFilters.join(',')).limit(limit)
    )).data.filter(row => matchesOpsSearch(row, parsed.query));
    if (customers.length) {
      addIds(ids, (await runQuery(
        supabase.from('orders').select('id').in('customer_id', customers.map(row => row.id)).limit(limit)
      )).data);
    }

    const addresses = (await runQuery(
      supabase.from('customer_addresses').select('id,name,phone').or(customerFilters.join(',')).limit(limit)
    )).data.filter(row => matchesOpsSearch(row, parsed.query));
    if (addresses.length) {
      addIds(ids, (await runQuery(
        supabase.from('orders').select('id').in('shipping_address_id', addresses.map(row => row.id)).limit(limit)
      )).data);
    }
  }

  for (const variant of parsed.variants) {
    addIds(ids, (await runQuery(
      supabase.from('shipments').select('order_id').ilike('waybill', `%${variant}%`).limit(limit)
    )).data, 'order_id');
  }

  return [...ids];
}

export function shipmentSearchOrFilter(query, orderIds = []) {
  const parsed = searchVariants(query);
  const parts = [];
  for (const variant of parsed.variants) {
    parts.push(`waybill.ilike.%${variant}%`, `order_number.ilike.%${variant}%`);
  }
  const ids = unique(orderIds).slice(0, 200);
  if (ids.length) parts.push(`order_id.in.(${ids.join(',')})`);
  return parts.join(',');
}
