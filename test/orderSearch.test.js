import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findOrderIdsMatchingQuery,
  matchesOpsSearch,
  searchVariants,
  shipmentSearchOrFilter,
  sanitizeSearchQuery
} from '../lib/crm/order-search.js';

const rayon = {
  order_number: '10577',
  customer_name: 'Rayon Almeida',
  phone: '+91 89041-23456',
  whatsapp_number: '8904123456',
  shipping_phone: '089041 23456',
  awb_number: 'DL345832435XB',
  shipment_waybill: 'DL345832435XB',
  waybill: 'DL345832435XB',
  bike_model: 'Hornet 750'
};

test('trims whitespace and ignores PostgREST special characters', () => {
  assert.equal(sanitizeSearchQuery('  Rayon,Almeida  '), 'Rayon Almeida');
  assert.equal(sanitizeSearchQuery(' 10577 '), '10577');
});

test('name search is case-insensitive and allows partial matches', () => {
  assert.equal(matchesOpsSearch(rayon, 'Rayon'), true);
  assert.equal(matchesOpsSearch(rayon, 'almeida'), true);
  assert.equal(matchesOpsSearch(rayon, '  RAYON ALMEIDA  '), true);
  assert.equal(matchesOpsSearch(rayon, 'nope'), false);
});

test('phone search ignores spaces and dashes', () => {
  assert.equal(matchesOpsSearch(rayon, '8904123456'), true);
  assert.equal(matchesOpsSearch(rayon, '89041-23456'), true);
  assert.equal(matchesOpsSearch(rayon, '89041 23456'), true);
  assert.equal(matchesOpsSearch({ phone: '8904123456' }, '+91-89041-23456'), true);
});

test('AWB search matches DL waybills and numeric domestic numbers', () => {
  assert.equal(matchesOpsSearch(rayon, 'DL345832435XB'), true);
  assert.equal(matchesOpsSearch(rayon, 'dl345832435xb'), true);
  assert.equal(matchesOpsSearch(rayon, '345832435'), true);
  assert.equal(matchesOpsSearch({ waybill: '123456789012' }, '123456789012'), true);
});

test('existing order-number search still matches', () => {
  assert.equal(matchesOpsSearch(rayon, '10577'), true);
  assert.equal(matchesOpsSearch(rayon, ' 10577 '), true);
});

test('search variants include compact AWB and digit-only phone forms', () => {
  assert.deepEqual(searchVariants(' DL345832435XB ').variants.sort(), ['345832435', 'DL345832435XB', 'dl345832435xb'].sort());
  assert.ok(searchVariants('89041-23456').variants.includes('8904123456'));
});

test('shipment or-filter keeps AWB, order number, and matching order ids', () => {
  const filter = shipmentSearchOrFilter('DL345832435XB', ['abc-1']);
  assert.ok(filter.includes('waybill.ilike.%DL345832435XB%'));
  assert.ok(filter.includes('order_number.ilike.%DL345832435XB%'));
  assert.ok(filter.includes('order_id.in.(abc-1)'));
});

function mockSupabase(tables) {
  const ilike = (value, pattern) => {
    const needle = String(pattern).replaceAll('%', '').toLowerCase();
    return String(value || '').toLowerCase().includes(needle);
  };
  return {
    from(table) {
      const rows = tables[table] || [];
      const q = { table };
      const api = {
        select() { return api; },
        or(expr) { q.or = expr; return api; },
        ilike(field, pattern) { q.ilike = { field, pattern }; return api; },
        in(field, values) { q.in = { field, values }; return api; },
        limit() {
          let data = rows;
          if (q.ilike) data = data.filter(row => ilike(row[q.ilike.field], q.ilike.pattern));
          if (q.in) data = data.filter(row => q.in.values.includes(row[q.in.field]));
          if (q.or) {
            const clauses = q.or.split(',').map(part => part.trim());
            data = data.filter(row => clauses.some(clause => {
              const inMatch = clause.match(/^(\w+)\.in\.\((.+)\)$/);
              if (inMatch) return inMatch[2].split(',').includes(String(row[inMatch[1]]));
              const likeMatch = clause.match(/^(\w+)\.ilike\.%(.+)%$/);
              if (likeMatch) return ilike(row[likeMatch[1]], likeMatch[2]);
              return false;
            }));
          }
          return Promise.resolve({ data, error: null });
        }
      };
      return api;
    }
  };
}

test('findOrderIdsMatchingQuery matches name, phone, AWB, and order number', async () => {
  const supabase = mockSupabase({
    orders: [{ id: 'o1', customer_id: 'c1', shipping_address_id: 'a1', order_number: '10577', awb_number: 'DL345832435XB', shipment_waybill: 'DL345832435XB', whatsapp_number: '8904123456', bike_model: 'Hornet 750', external_order_id: 'wix-10577' }],
    customers: [{ id: 'c1', name: 'Rayon Almeida', phone: '+91 89041-23456' }],
    customer_addresses: [{ id: 'a1', name: 'Rayon Almeida', phone: '089041 23456' }],
    shipments: [{ order_id: 'o1', waybill: 'DL345832435XB' }]
  });
  assert.deepEqual(await findOrderIdsMatchingQuery(supabase, 'Rayon'), ['o1']);
  assert.deepEqual(await findOrderIdsMatchingQuery(supabase, 'Almeida'), ['o1']);
  assert.deepEqual(await findOrderIdsMatchingQuery(supabase, '8904123456'), ['o1']);
  assert.deepEqual(await findOrderIdsMatchingQuery(supabase, 'DL345832435XB'), ['o1']);
  assert.deepEqual(await findOrderIdsMatchingQuery(supabase, '10577'), ['o1']);
});
