import { createServiceClient } from '../supabase/server.js';

let state = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  lastResult: null,
  watermarkModifiedAfter: null
};

export async function runWooOrderSync({ reason = 'manual', force = false, deps = {} } = {}) {
  const minIntervalMs = Math.max(Number(process.env.WOO_AUTO_SYNC_MIN_INTERVAL_SECONDS || 120), 15) * 1000;
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
    const [{ getConfig }, { isSupabaseConfigured }, storeMod, wooApi] = await Promise.all([
      import('../../src/config.js'),
      import('../../src/supabase.js'),
      import('../../src/store.js'),
      import('../../src/woocommerce.js')
    ]);
    const config = deps.getConfig ? deps.getConfig() : getConfig();
    const checkSupabase = deps.isSupabaseConfigured || isSupabaseConfigured;
    const upsertWooCommerceOrders = deps.upsertWooCommerceOrders || storeMod.upsertWooCommerceOrders;
    const fetchOrders = deps.fetchWooCommerceOrders || wooApi.fetchWooCommerceOrders;
    const resolveWatermark = deps.resolveWooModifiedAfterWatermark || wooApi.resolveWooModifiedAfterWatermark;
    const nextWatermark = deps.nextWooWatermarkFromOrders || wooApi.nextWooWatermarkFromOrders;

    if (!config.woocommerce?.orderSync?.enabled) return finishWithSkip('disabled');
    if (!config.woocommerce?.baseUrl || !config.woocommerce?.consumerKey || !config.woocommerce?.consumerSecret) {
      return finishWithSkip('missing-woo-config');
    }
    if (!checkSupabase(config)) return finishWithSkip('missing-supabase-config');

    const pageSize = clamp(
      Number(process.env.WOO_AUTO_SYNC_PAGE_SIZE || process.env.WOO_ORDER_SYNC_PAGE_SIZE || config.woocommerce.orderSync.pageSize || 25),
      1,
      100
    );
    const maxPages = clamp(
      Number(process.env.WOO_AUTO_SYNC_MAX_PAGES || process.env.WOO_ORDER_SYNC_MAX_PAGES || config.woocommerce.orderSync.maxPages || 3),
      1,
      20
    );

    const modifiedAfter = resolveWatermark(state, config, { force });
    let page = 0;
    let pulled = 0;
    let persisted = 0;
    let created = 0;
    let updated = 0;
    let errors = 0;
    let hasMore = false;
    const errorSamples = [];

    do {
      page += 1;
      const result = await fetchOrders(config, {
        page,
        perPage: pageSize,
        modifiedAfter
      });
      const orders = result.orders || [];
      pulled += orders.length;

      if (orders.length) {
        try {
          const saved = await upsertWooCommerceOrders(orders);
          persisted += saved.length;
          for (const row of saved) {
            if (row?.created) created += 1;
            if (row?.updated) updated += 1;
          }
        } catch (error) {
          for (const order of orders) {
            try {
              const saved = await upsertWooCommerceOrders([order]);
              const row = saved[0];
              if (row) {
                persisted += 1;
                if (row.created) created += 1;
                if (row.updated) updated += 1;
              }
            } catch (orderError) {
              errors += 1;
              if (errorSamples.length < 5) {
                errorSamples.push({ orderId: order?.id, message: orderError.message || String(orderError) });
              }
              await logIntegrationError('woocommerce', 'order-upsert', orderError, { orderId: order?.id, reason });
            }
          }
        }
      }

      state.watermarkModifiedAfter = nextWatermark(
        orders,
        state.watermarkModifiedAfter || modifiedAfter
      );
      hasMore = Boolean(result.hasMore);
    } while (hasMore && page < maxPages);

    const syncResult = {
      ok: errors === 0,
      accepted: true,
      integration: 'woocommerce',
      reason,
      pages: page,
      pulled,
      persisted,
      created,
      updated,
      errors,
      errorSamples,
      modifiedAfter: modifiedAfter || null,
      watermarkModifiedAfter: state.watermarkModifiedAfter,
      stoppedByMaxPages: Boolean(hasMore && page >= maxPages)
    };

    if (errors && !persisted) {
      state = {
        ...state,
        running: false,
        lastFinishedAt: new Date().toISOString(),
        lastError: errorSamples[0]?.message || 'Woo sync failed.',
        lastResult: syncResult
      };
      return { ...syncResult, error: state.lastError, state: syncState() };
    }

    state = {
      ...state,
      running: false,
      lastFinishedAt: new Date().toISOString(),
      lastResult: syncResult,
      lastError: errors ? `${errors} upsert error(s)` : null
    };
    return { ...syncResult, state: syncState() };
  } catch (error) {
    const message = error.message || 'WooCommerce sync failed.';
    await logIntegrationError('woocommerce', 'order-sync', error, { reason });
    state = { ...state, running: false, lastFinishedAt: new Date().toISOString(), lastError: message };
    return { ok: false, error: message, state: syncState() };
  }
}

export function syncState() {
  return {
    running: state.running,
    lastStartedAt: state.lastStartedAt,
    lastFinishedAt: state.lastFinishedAt,
    lastError: state.lastError,
    lastResult: state.lastResult,
    watermarkModifiedAfter: state.watermarkModifiedAfter
  };
}

async function finishWithSkip(reason) {
  const result = { ok: true, skipped: true, reason, integration: 'woocommerce' };
  state = {
    ...state,
    running: false,
    lastFinishedAt: new Date().toISOString(),
    lastResult: result,
    lastError: reason === 'disabled' ? null : reason
  };
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

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
