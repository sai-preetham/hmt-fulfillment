import { getConfig } from '../src/config.js';
import { isSupabaseConfigured } from '../src/supabase.js';
import { upsertWixFulfillmentTracking, upsertWixOrders } from '../src/store.js';
import { fetchWixOrderFulfillments, searchWixOrders } from '../src/wix.js';

const config = getConfig();
const limit = clamp(Number(process.env.WIX_SYNC_PAGE_SIZE || 100), 1, 100);
const maxPages = Number(process.env.WIX_SYNC_MAX_PAGES || 0);
const sortField = process.env.WIX_SYNC_SORT_FIELD || 'createdDate';
const sortOrder = process.env.WIX_SYNC_SORT_ORDER || 'DESC';
const includeFulfillments = process.env.WIX_SYNC_FULFILLMENTS !== 'false';

if (!config.wix.authToken || !config.wix.siteId) {
  console.error('WIX_AUTH_TOKEN and WIX_SITE_ID are required.');
  process.exit(1);
}

if (!isSupabaseConfigured(config)) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to store orders in Supabase.');
  process.exit(1);
}

let cursor = '';
let page = 0;
let pulled = 0;
let persisted = 0;
let fulfillmentChecked = 0;
let fulfillmentShipments = 0;
let failedFulfillmentPulls = 0;

do {
  page += 1;
  const pageStartedAt = Date.now();
  console.log(`Pulling Wix page ${page} (${sortField} ${sortOrder}, limit ${limit})...`);

  const result = await searchWixOrders({ limit, cursor, sortField, sortOrder }, config);
  const orders = result.orders || [];
  const saved = await upsertWixOrders(orders);
  pulled += orders.length;
  persisted += saved.length;

  if (includeFulfillments) {
    const savedByWixId = new Map(saved.map(order => [order.wix_order_id, order]));
    for (const order of orders) {
      if (!shouldPullFulfillments(order)) continue;
      fulfillmentChecked += 1;
      try {
        const fulfillments = await fetchWixOrderFulfillments(order.id, config);
        const savedOrder = savedByWixId.get(order.id);
        if (savedOrder) {
          const result = await upsertWixFulfillmentTracking(savedOrder, fulfillments);
          fulfillmentShipments += result.persisted;
        }
      } catch (error) {
        failedFulfillmentPulls += 1;
        console.error(`Fulfillment pull failed for Wix order ${order.number || order.id}: ${error.message}`);
      }
    }
  }

  cursor = result.pagingMetadata?.cursors?.next || '';
  console.log(
    `Page ${page} done: pulled ${orders.length}, persisted ${saved.length}, ` +
      `fulfillment checks ${fulfillmentChecked}, fulfillment shipments ${fulfillmentShipments}, ` +
      `next=${Boolean(cursor)}, ${Date.now() - pageStartedAt}ms`
  );
} while (cursor && (!maxPages || page < maxPages));

console.log(
  JSON.stringify(
    {
      done: true,
      pages: page,
      pulled,
      persisted,
      fulfillmentChecked,
      fulfillmentShipments,
      failedFulfillmentPulls,
      stoppedByMaxPages: Boolean(cursor && maxPages && page >= maxPages)
    },
    null,
    2
  )
);

function shouldPullFulfillments(order) {
  return !['NOT_FULFILLED', ''].includes(String(order.fulfillmentStatus || '').trim());
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
