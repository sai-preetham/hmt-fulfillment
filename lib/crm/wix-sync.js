import { createServiceClient } from '@/lib/supabase/server';

let state = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  lastResult: null
};

export async function runWixOrderSync({ reason = 'manual', force = false } = {}) {
  const minIntervalMs = Math.max(Number(process.env.WIX_AUTO_SYNC_MIN_INTERVAL_SECONDS || 120), 15) * 1000;
  const now = Date.now();
  const lastFinished = state.lastFinishedAt ? Date.parse(state.lastFinishedAt) : 0;

  if (state.running) return { ok: true, skipped: true, reason: 'already-running', state: syncState() };
  if (!force && lastFinished && now - lastFinished < minIntervalMs) {
    return { ok: true, skipped: true, reason: 'throttled', state: syncState() };
  }

  state = {
    ...state,
    running: true,
    lastStartedAt: new Date().toISOString(),
    lastError: null
  };

  try {
    const [{ getConfig }, { isSupabaseConfigured }, { upsertWixFulfillmentTracking, upsertWixOrders }, { fetchWixOrderFulfillments, searchWixOrders }] =
      await Promise.all([
        import('@/src/config.js'),
        import('@/src/supabase.js'),
        import('@/src/store.js'),
        import('@/src/wix.js')
      ]);
    const config = getConfig();
    if (!config.wix.authToken || !config.wix.siteId) return finishWithSkip('missing-wix-config');
    if (!isSupabaseConfigured(config)) return finishWithSkip('missing-supabase-config');

    const pageSize = clamp(Number(process.env.WIX_AUTO_SYNC_PAGE_SIZE || config.wix.orderSync.pageSize || 25), 1, 100);
    const maxPages = clamp(Number(process.env.WIX_AUTO_SYNC_MAX_PAGES || config.wix.orderSync.maxPages || 1), 1, 10);
    const includeFulfillments = process.env.WIX_AUTO_SYNC_FULFILLMENTS !== 'false';
    let cursor = '';
    let pages = 0;
    let pulled = 0;
    let persisted = 0;
    let fulfillmentChecked = 0;
    let fulfillmentShipments = 0;
    let failedFulfillmentPulls = 0;

    do {
      pages += 1;
      const result = await searchWixOrders(
        {
          limit: pageSize,
          cursor,
          sortField: 'updatedDate',
          sortOrder: 'DESC'
        },
        config
      );
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
              const fulfillmentResult = await upsertWixFulfillmentTracking(savedOrder, fulfillments);
              fulfillmentShipments += fulfillmentResult.persisted;
            }
          } catch (error) {
            failedFulfillmentPulls += 1;
            await logIntegrationError('wix', 'fulfillment-sync', error, { orderId: order.id, orderNumber: order.number });
          }
        }
      }

      cursor = result.pagingMetadata?.cursors?.next || '';
    } while (cursor && pages < maxPages);

    const result = {
      ok: true,
      accepted: true,
      integration: 'wix',
      reason,
      pages,
      pulled,
      persisted,
      fulfillmentChecked,
      fulfillmentShipments,
      failedFulfillmentPulls,
      stoppedByMaxPages: Boolean(cursor && pages >= maxPages)
    };
    state = { ...state, running: false, lastFinishedAt: new Date().toISOString(), lastResult: result };
    return { ...result, state: syncState() };
  } catch (error) {
    const message = error.message || 'Wix sync failed.';
    await logIntegrationError('wix', 'order-sync', error, { reason });
    state = { ...state, running: false, lastFinishedAt: new Date().toISOString(), lastError: message };
    return { ok: false, error: message, state: syncState() };
  }
}

export function syncState() {
  return { ...state };
}

async function finishWithSkip(reason) {
  const result = { ok: true, skipped: true, reason, integration: 'wix' };
  state = { ...state, running: false, lastFinishedAt: new Date().toISOString(), lastResult: result, lastError: reason };
  return { ...result, state: syncState() };
}

async function logIntegrationError(integration, operation, error, context) {
  const supabase = createServiceClient();
  if (!supabase) return;
  await supabase.from('integration_errors').insert({
    integration,
    operation,
    status: 'open',
    message: error.message || String(error),
    payload: context || {}
  });
}

function shouldPullFulfillments(order) {
  return !['NOT_FULFILLED', ''].includes(String(order.fulfillmentStatus || '').trim());
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
