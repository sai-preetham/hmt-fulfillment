import { isSupabaseConfigured } from './supabase.js';
import { upsertWixOrders } from './store.js';
import { searchWixOrders } from './wix.js';

export function createWixOrderSync(config, options = {}) {
  const logger = options.logger || console;
  const setTimer = options.setTimer || setInterval;
  const clearTimer = options.clearTimer || clearInterval;
  const searchOrders = options.searchOrders || searchWixOrders;
  const upsertOrders = options.upsertOrders || upsertWixOrders;
  let timer = null;

  const state = {
    enabled: Boolean(config.wix.orderSync.enabled),
    running: false,
    lastReason: '',
    lastStartedAt: null,
    lastFinishedAt: null,
    lastError: null,
    lastPulled: 0,
    lastPersisted: 0,
    lastPages: 0,
    nextRunAt: null
  };

  async function run(reason = 'manual') {
    if (!state.enabled) return { skipped: true, reason: 'disabled', ...snapshot() };
    if (state.running) return { skipped: true, reason: 'already-running', ...snapshot() };
    if (!config.wix.authToken || !config.wix.siteId) return failSkip('missing-wix-config');
    if (!isSupabaseConfigured(config)) return failSkip('missing-supabase-config');

    state.running = true;
    state.lastReason = reason;
    state.lastStartedAt = new Date().toISOString();
    state.lastError = null;
    state.lastPulled = 0;
    state.lastPersisted = 0;
    state.lastPages = 0;

    try {
      let cursor = '';
      do {
        state.lastPages += 1;
        const result = await searchOrders(
          {
            limit: config.wix.orderSync.pageSize,
            cursor,
            sortField: 'updatedDate',
            sortOrder: 'DESC'
          },
          config
        );
        const orders = result.orders || [];
        const saved = await upsertOrders(orders);
        state.lastPulled += orders.length;
        state.lastPersisted += saved.length;
        cursor = result.pagingMetadata?.cursors?.next || '';
      } while (cursor && state.lastPages < config.wix.orderSync.maxPages);
    } catch (error) {
      state.lastError = error.message;
      logger.error?.(`Wix order sync failed: ${error.message}`);
    } finally {
      state.running = false;
      state.lastFinishedAt = new Date().toISOString();
      state.nextRunAt = nextRunTimestamp(config);
    }

    return snapshot();
  }

  function start() {
    if (!state.enabled) return snapshot();
    if (timer) return snapshot();
    state.nextRunAt = nextRunTimestamp(config, 5_000);
    setTimeout(() => run('startup'), 5_000);
    timer = setTimer(() => run('interval'), config.wix.orderSync.intervalMs);
    timer.unref?.();
    logger.log?.(
      `Wix order sync enabled: every ${Math.round(config.wix.orderSync.intervalMs / 60_000)} min, ` +
        `${config.wix.orderSync.maxPages} page(s) of ${config.wix.orderSync.pageSize}`
    );
    return snapshot();
  }

  function stop() {
    if (timer) clearTimer(timer);
    timer = null;
    state.nextRunAt = null;
    return snapshot();
  }

  function snapshot() {
    return { ...state };
  }

  function failSkip(reason) {
    state.lastError = reason;
    return { skipped: true, reason, ...snapshot() };
  }

  return { run, start, stop, snapshot };
}

function nextRunTimestamp(config, delayMs = config.wix.orderSync.intervalMs) {
  return new Date(Date.now() + delayMs).toISOString();
}
