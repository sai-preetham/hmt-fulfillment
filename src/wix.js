import crypto from 'node:crypto';

export function decodeWixEvent(input, config) {
  const token = input.jwt || input.data || input.event || input;
  if (typeof token !== 'string') return { verified: false, payload: input };

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { verified: false, payload: input };
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = parseBase64UrlJson(headerPart);
  const payload = parseBase64UrlJson(payloadPart);
  const verified = verifyJwt(`${headerPart}.${payloadPart}`, signaturePart, header, config);

  return { verified, header, payload };
}

export function getOrderIdFromWixEvent(eventPayload) {
  return (
    eventPayload?.entityId ||
    eventPayload?.data?.entityId ||
    eventPayload?.createdEvent?.entityId ||
    eventPayload?.createdEvent?.entity?.id ||
    eventPayload?.order?.id ||
    eventPayload?.id
  );
}

export async function fetchWixOrder(orderId, config) {
  if (!config.wix.authToken) {
    throw new Error('WIX_AUTH_TOKEN is required to fetch Wix order details.');
  }

  const controller = createTimeoutController(config);
  const response = await fetch(`https://www.wixapis.com/ecom/v1/orders/${encodeURIComponent(orderId)}`, {
    headers: wixHeaders(config),
    signal: controller.signal
  });
  controller.clear();

  const body = await safeJson(response);
  if (!response.ok) {
    throw new Error(`Wix Get Order failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return body.order;
}

export async function fetchWixOrderFulfillments(orderId, config) {
  if (!config.wix.authToken) {
    throw new Error('WIX_AUTH_TOKEN is required to pull Wix fulfillments.');
  }

  const controller = createTimeoutController(config);
  const response = await fetch(
    `https://www.wixapis.com/ecom/v1/fulfillments/orders/${encodeURIComponent(orderId)}`,
    {
      headers: wixHeaders(config),
      signal: controller.signal
    }
  );
  controller.clear();

  const body = await safeJson(response);
  if (!response.ok) {
    throw new Error(`Wix List Fulfillments failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return body.orderWithFulfillments?.fulfillments || body.fulfillments || [];
}

export async function searchWixOrders(options = {}, config) {
  if (!config.wix.authToken) {
    throw new Error('WIX_AUTH_TOKEN is required to pull Wix orders.');
  }

  const requestBody = buildSearchOrdersRequest(options);
  const controller = createTimeoutController(config);
  const response = await fetch('https://www.wixapis.com/ecom/v1/orders/search', {
    method: 'POST',
    headers: wixHeaders(config),
    body: JSON.stringify(requestBody),
    signal: controller.signal
  });
  controller.clear();

  const body = await safeJson(response);
  if (!response.ok) {
    throw new Error(`Wix Search Orders failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return {
    orders: body.orders || [],
    pagingMetadata: body.pagingMetadata || body.metadata || {},
    raw: body
  };
}

export function buildSearchOrdersRequest(options = {}) {
  const limit = clamp(Number(options.limit || 50), 1, 100);
  const filter = removeEmpty({
    paymentStatus: options.paymentStatus,
    fulfillmentStatus: options.fulfillmentStatus,
    status: options.status,
    archived: options.archived
  });

  return {
    search: removeEmpty({
      cursorPaging: removeEmpty({
        limit,
        cursor: options.cursor
      }),
      filter: Object.keys(filter).length ? filter : undefined,
      sort: [
        {
          fieldName: options.sortField || 'createdDate',
          order: options.sortOrder === 'ASC' ? 'ASC' : 'DESC'
        }
      ]
    })
  };
}

function parseBase64UrlJson(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function wixHeaders(config) {
  return removeEmpty({
    Authorization: config.wix.authToken,
    'Content-Type': 'application/json',
    'wix-site-id': config.wix.siteId,
    'wix-account-id': config.wix.accountId
  });
}

function verifyJwt(signingInput, signaturePart, header, config) {
  if (header?.alg === 'RS256' && config.wix.webhookPublicKey) {
    return crypto.verify(
      'RSA-SHA256',
      Buffer.from(signingInput),
      config.wix.webhookPublicKey,
      Buffer.from(signaturePart, 'base64url')
    );
  }

  if (header?.alg === 'HS256' && config.wix.webhookSecret) {
    const expected = crypto
      .createHmac('sha256', config.wix.webhookSecret)
      .update(signingInput)
      .digest('base64url');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signaturePart));
  }

  return false;
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function removeEmpty(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

function createTimeoutController(config) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.wix.requestTimeoutMs || 30_000);
  timeout.unref?.();
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout)
  };
}
