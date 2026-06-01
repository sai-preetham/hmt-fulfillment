import { getConfig } from '../src/config.js';
import { isSupabaseConfigured } from '../src/supabase.js';
import { upsertWixOrders } from '../src/store.js';
import { searchWixOrders } from '../src/wix.js';

const config = getConfig();
const limit = Number(process.env.WIX_BACKFILL_PAGE_SIZE || 100);

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

do {
  page += 1;
  const result = await searchWixOrders({ limit, cursor }, config);
  const orders = result.orders || [];
  const saved = await upsertWixOrders(orders);

  pulled += orders.length;
  persisted += saved.length;
  cursor = result.pagingMetadata?.cursors?.next || '';

  console.log(`Page ${page}: pulled ${orders.length}, persisted ${saved.length}`);
} while (cursor);

console.log(`Done. Pulled ${pulled} Wix orders and persisted ${persisted} Supabase orders.`);
