/**
 * WooCommerce REST client for Ops-native order pull/sync.
 * WC REST API v3 + HTTP Basic auth (consumer key:secret).
 */

export async function fetchWooCommerceOrders(config, options = {}) {
  const woo = config.woocommerce || {};
  if (!woo.baseUrl) throw new Error('WOO_BASE_URL is required to pull WooCommerce orders.');
  if (!woo.consumerKey || !woo.consumerSecret) {
    throw new Error('WOO_CONSUMER_KEY and WOO_CONSUMER_SECRET are required to pull WooCommerce orders.');
  }

  const page = Math.max(1, Number(options.page || 1));
  const perPage = clamp(Number(options.perPage || woo.orderSync?.pageSize || 25), 1, 100);
  const url = new URL(`${String(woo.baseUrl).replace(/\/$/, '')}/wp-json/wc/v3/orders`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('orderby', 'modified');
  url.searchParams.set('order', 'desc');
  if (options.modifiedAfter) url.searchParams.set('modified_after', toWooIso(options.modifiedAfter));
  if (options.after) url.searchParams.set('after', toWooIso(options.after));
  if (options.status) url.searchParams.set('status', options.status);

  const response = await (options.fetchImpl || globalThis.fetch)(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: wooBasicAuthHeader(woo.consumerKey, woo.consumerSecret)
    }
  });

  const body = await safeJson(response);
  if (!response.ok) {
    throw new Error(`WooCommerce orders fetch failed (${response.status}): ${JSON.stringify(body)}`);
  }

  const orders = Array.isArray(body) ? body : [];
  const totalPages = Number(header(response, 'x-wp-totalpages') || 0) || null;
  const total = Number(header(response, 'x-wp-total') || 0) || null;

  return {
    orders,
    page,
    perPage,
    totalPages,
    total,
    hasMore: totalPages != null ? page < totalPages : orders.length >= perPage
  };
}

export async function fetchWooCommerceAbandonedCarts(config, options = {}) {
  return fetchWooCommerceOrders(config, {
    ...options,
    status: 'checkout-draft'
  });
}

export function wooBasicAuthHeader(consumerKey, consumerSecret) {
  const token = Buffer.from(`${consumerKey}:${consumerSecret}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

export function resolveWooModifiedAfterWatermark(state, config, { force = false } = {}) {
  if (force) return null;
  if (state?.watermarkModifiedAfter) return state.watermarkModifiedAfter;
  const intervalMs = config.woocommerce?.orderSync?.intervalMs || 15 * 60_000;
  const lookbackMs = Math.max(intervalMs * 2, 30 * 60_000);
  return new Date(Date.now() - lookbackMs).toISOString();
}

export function nextWooWatermarkFromOrders(orders, previousWatermark) {
  let maxMs = previousWatermark ? Date.parse(previousWatermark) : 0;
  for (const order of orders || []) {
    const candidate = order.date_modified_gmt || order.date_modified || order.date_created_gmt || order.date_created;
    if (!candidate) continue;
    const normalized = String(candidate).endsWith('Z') || String(candidate).includes('+') ? candidate : `${candidate}Z`;
    const ms = Date.parse(normalized);
    if (Number.isFinite(ms) && ms > maxMs) maxMs = ms;
  }
  if (!maxMs) return previousWatermark || null;
  return new Date(maxMs - 1000).toISOString();
}

function header(response, name) {
  return response.headers?.get?.(name) || response.headers?.get?.(name.toUpperCase()) || null;
}

function toWooIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toISOString().replace(/\.\d{3}Z$/, '');
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return { raw: await response.text().catch(() => '') };
  }
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
