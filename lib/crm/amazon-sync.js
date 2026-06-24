import { createServiceClient } from '../supabase/server.js';

let state = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  lastResult: null
};

export async function runAmazonOrderSync({ reason = 'manual', force = false } = {}) {
  const minIntervalMs = Math.max(Number(process.env.AMAZON_AUTO_SYNC_MIN_INTERVAL_SECONDS || 120), 15) * 1000;
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
    const [{ getConfig }, { isSupabaseConfigured }, { upsertAmazonOrders }, amazonApi] =
      await Promise.all([
        import('../../src/config.js'),
        import('../../src/supabase.js'),
        import('../../src/store.js'),
        import('../../src/amazon.js')
      ]);
    const config = getConfig();

    let pulled = 0;
    let persisted = 0;
    let pages = 0;
    let mode = 'production';

    const hasCredentials = config.amazon.clientId && config.amazon.clientSecret && config.amazon.refreshToken;

    if (!hasCredentials) {
      // Demo Mode: Mock Amazon Order Import
      mode = 'demo';
      console.log('Amazon credentials not configured. Running in Demo Mode.');
      if (!isSupabaseConfigured(config)) return finishWithSkip('missing-supabase-config');

      // Generate a mock Amazon order with a random ID
      const orderId = `AMZ-406-${Math.floor(1000000 + Math.random() * 9000000)}`;
      const mockOrder = {
        order: {
          AmazonOrderId: orderId,
          PurchaseDate: new Date().toISOString(),
          OrderStatus: 'Unshipped',
          OrderTotal: { Amount: '13999', CurrencyCode: 'INR' },
          ShipServiceLevel: 'Standard',
          PaymentMethod: 'Other'
        },
        address: {
          Name: 'Sneha Kulkarni',
          Phone: '+919988776655',
          AddressLine1: 'A-503 Green Park Society, Baner Road',
          AddressLine2: 'Near Green Park Hotel',
          City: 'Pune',
          StateOrRegion: 'Maharashtra',
          PostalCode: '411045',
          CountryCode: 'IN'
        },
        buyer: {
          BuyerEmail: 'sneha@example.com',
          BuyerName: 'Sneha Kulkarni'
        },
        items: [
          {
            ASIN: 'B08L5HM5TC',
            SellerSKU: 'HMT-390-ADV-KIT',
            Title: 'HMT Cruise Kit - KTM 390 Adv',
            OrderItemId: `AMZ-LINE-${Math.floor(1000000 + Math.random() * 9000000)}`,
            QuantityOrdered: 1,
            ItemPrice: { Amount: '13999', CurrencyCode: 'INR' }
          }
        ]
      };

      const saved = await upsertAmazonOrders([mockOrder]);
      pulled = 1;
      persisted = saved.length;
      pages = 1;
    } else {
      // Production Mode: Fetch real Amazon Orders via SP-API
      if (!isSupabaseConfigured(config)) return finishWithSkip('missing-supabase-config');

      const pageSize = clamp(Number(process.env.AMAZON_AUTO_SYNC_PAGE_SIZE || config.amazon.orderSync.pageSize || 25), 1, 100);
      const maxPages = clamp(Number(process.env.AMAZON_AUTO_SYNC_MAX_PAGES || config.amazon.orderSync.maxPages || 1), 1, 10);
      let cursor = '';

      const accessToken = await amazonApi.fetchAmazonAccessToken(config);

      do {
        pages += 1;
        const result = await amazonApi.fetchAmazonOrders(config, {
          limit: pageSize,
          cursor
        });
        const orders = result.orders || [];
        const fullOrders = [];

        for (const order of orders) {
          try {
            // Only sync paid/unshipped orders
            if (['Unshipped', 'PartiallyShipped'].includes(order.OrderStatus)) {
              const items = await amazonApi.fetchAmazonOrderItems(order.AmazonOrderId, config);
              const address = await amazonApi.fetchAmazonOrderAddress(accessToken, order.AmazonOrderId, config);
              const buyerInfo = await amazonApi.fetchAmazonOrderBuyerInfo(accessToken, order.AmazonOrderId, config);

              fullOrders.push({
                order,
                address,
                buyer: buyerInfo?.buyerInfo || buyerInfo,
                items
              });
            }
          } catch (err) {
            console.error(`Failed to fetch details for Amazon order ${order.AmazonOrderId}: ${err.message}`);
            await logIntegrationError('amazon', 'fetch-order-details', err, { orderId: order.AmazonOrderId });
          }
        }

        const saved = await upsertAmazonOrders(fullOrders);
        pulled += orders.length;
        persisted += saved.length;

        cursor = result.nextToken;
      } while (cursor && pages < maxPages);
    }

    const result = {
      ok: true,
      accepted: true,
      integration: 'amazon',
      mode,
      reason,
      pages,
      pulled,
      persisted,
      stoppedByMaxPages: false
    };
    state = { ...state, running: false, lastFinishedAt: new Date().toISOString(), lastResult: result };
    return { ...result, state: syncState() };
  } catch (error) {
    const message = error.message || 'Amazon sync failed.';
    await logIntegrationError('amazon', 'order-sync', error, { reason });
    state = { ...state, running: false, lastFinishedAt: new Date().toISOString(), lastError: message };
    return { ok: false, error: message, state: syncState() };
  }
}

export function syncState() {
  return { ...state };
}

async function finishWithSkip(reason) {
  const result = { ok: true, skipped: true, reason, integration: 'amazon' };
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

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
