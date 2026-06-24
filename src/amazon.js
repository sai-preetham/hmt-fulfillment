import { getConfig } from './config.js';

// Map Amazon Marketplace IDs to their corresponding regional SP-API endpoints.
const ENDPOINTS = {
  // North America (NA)
  ATVPDKIKX0DER: 'https://sellingpartnerapi-na.amazon.com',
  A2EUQ1WTGCTBG2: 'https://sellingpartnerapi-na.amazon.com',
  A1AM78C64UM0Y8: 'https://sellingpartnerapi-na.amazon.com',
  A2Q3Y263D4YZ2: 'https://sellingpartnerapi-na.amazon.com',
  // Europe (EU / India)
  A1F83G8C2ARO7P: 'https://sellingpartnerapi-eu.amazon.com',
  A1PA6795UKMFR9: 'https://sellingpartnerapi-eu.amazon.com',
  A1RKKUPIHCS9HS: 'https://sellingpartnerapi-eu.amazon.com',
  A13V1IB3VIYZZH: 'https://sellingpartnerapi-eu.amazon.com',
  APJ6JRA9LQQ2V: 'https://sellingpartnerapi-eu.amazon.com',
  A21TJRUUN4KGV: 'https://sellingpartnerapi-eu.amazon.com', // India
  A1805IZ52V1B5B: 'https://sellingpartnerapi-eu.amazon.com',
  A2NODRK35UZF0U: 'https://sellingpartnerapi-eu.amazon.com',
  A1C3SOZRCH2KV3: 'https://sellingpartnerapi-eu.amazon.com',
  A2VIGQ35RCS4C5: 'https://sellingpartnerapi-eu.amazon.com',
  A33LQD8UX5L159: 'https://sellingpartnerapi-eu.amazon.com',
  A17E79C6D83EP3: 'https://sellingpartnerapi-eu.amazon.com',
  A27P43NTAFOHF: 'https://sellingpartnerapi-eu.amazon.com',
  A12V7H1V5DJ957: 'https://sellingpartnerapi-eu.amazon.com',
  // Far East (FE)
  A1VC38T7YXB528: 'https://sellingpartnerapi-fe.amazon.com',
  A39IBJ37TRP1C6: 'https://sellingpartnerapi-fe.amazon.com',
  A19VA1J185WY5F: 'https://sellingpartnerapi-fe.amazon.com'
};

function getSpApiEndpoint(marketplaceId) {
  return ENDPOINTS[marketplaceId] || 'https://sellingpartnerapi-eu.amazon.com';
}

/**
 * Exchanges the refresh token for a Login with Amazon (LWA) access token.
 */
export async function fetchAmazonAccessToken(config) {
  const { clientId, clientSecret, refreshToken } = config.amazon;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Amazon SP-API LWA credentials (client ID, client secret, or refresh token).');
  }

  const response = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    }).toString()
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Amazon LWA token exchange failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return body.access_token;
}

/**
 * Requests a Restricted Data Token (RDT) from the Tokens API to access PII fields.
 */
export async function createRestrictedDataToken(accessToken, orderId, config) {
  const endpoint = getSpApiEndpoint(config.amazon.marketplaceId);
  const response = await fetch(`${endpoint}/tokens/2021-03-01/restrictedDataToken`, {
    method: 'POST',
    headers: {
      'x-amz-access-token': accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      restrictedResources: [
        {
          method: 'GET',
          path: `/orders/v0/orders/${orderId}/address`,
          dataElements: ['shippingAddress']
        },
        {
          method: 'GET',
          path: `/orders/v0/orders/${orderId}/buyerInfo`,
          dataElements: ['buyerInfo']
        }
      ]
    })
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Amazon RDT request failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return body.restrictedDataToken;
}

/**
 * Fetches recent orders from Amazon SP-API.
 */
export async function fetchAmazonOrders(config, options = {}) {
  const accessToken = await fetchAmazonAccessToken(config);
  const endpoint = getSpApiEndpoint(config.amazon.marketplaceId);
  const url = new URL(`${endpoint}/orders/v0/orders`);

  url.searchParams.set('MarketplaceIds', config.amazon.marketplaceId);
  url.searchParams.set('MaxResultsPerPage', String(options.limit || config.amazon.orderSync.pageSize || 25));

  if (options.cursor) {
    url.searchParams.set('NextToken', options.cursor);
  } else {
    // Default to last 3 days if no timestamp is provided
    const defaultDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    url.searchParams.set('LastUpdatedAfter', options.lastUpdatedAfter || defaultDate);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'x-amz-access-token': accessToken,
      Accept: 'application/json'
    }
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Amazon fetch orders failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return {
    orders: body.payload?.Orders || [],
    nextToken: body.payload?.NextToken || null
  };
}

/**
 * Fetches order items for a specific Amazon order.
 */
export async function fetchAmazonOrderItems(orderId, config) {
  const accessToken = await fetchAmazonAccessToken(config);
  const endpoint = getSpApiEndpoint(config.amazon.marketplaceId);
  const url = new URL(`${endpoint}/orders/v0/orders/${orderId}/orderItems`);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'x-amz-access-token': accessToken,
      Accept: 'application/json'
    }
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Amazon fetch order items failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return body.payload?.OrderItems || [];
}

/**
 * Fetches shipping address for a specific order using an RDT.
 */
export async function fetchAmazonOrderAddress(accessToken, orderId, config) {
  const rdtToken = await createRestrictedDataToken(accessToken, orderId, config);
  const endpoint = getSpApiEndpoint(config.amazon.marketplaceId);
  const url = new URL(`${endpoint}/orders/v0/orders/${orderId}/address`);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'x-amz-access-token': rdtToken,
      Accept: 'application/json'
    }
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Amazon fetch order address failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return body.payload?.ShippingAddress || null;
}

/**
 * Fetches buyer info for a specific order using an RDT.
 */
export async function fetchAmazonOrderBuyerInfo(accessToken, orderId, config) {
  const rdtToken = await createRestrictedDataToken(accessToken, orderId, config);
  const endpoint = getSpApiEndpoint(config.amazon.marketplaceId);
  const url = new URL(`${endpoint}/orders/v0/orders/${orderId}/buyerInfo`);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'x-amz-access-token': rdtToken,
      Accept: 'application/json'
    }
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Amazon fetch order buyer info failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return body.payload || null;
}

/**
 * Confirms order fulfillment/shipment by uploading tracking information.
 */
export async function confirmAmazonShipment(orderId, waybill, carrierCode, shippingMethod, items, config) {
  const accessToken = await fetchAmazonAccessToken(config);
  const endpoint = getSpApiEndpoint(config.amazon.marketplaceId);
  const url = new URL(`${endpoint}/orders/v0/orders/${orderId}/shipmentConfirmation`);

  const packageDetail = {
    packageReferenceId: "1",
    carrierCode: carrierCode || 'Delhivery',
    carrierName: carrierCode || 'Delhivery',
    shippingMethod: shippingMethod || 'Express',
    trackingNumber: waybill,
    shipDate: new Date().toISOString(),
    orderItems: items.map(item => ({
      orderItemId: item.OrderItemId || item.wix_line_item_id,
      quantity: Number(item.QuantityOrdered || item.quantity || 1)
    }))
  };

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'x-amz-access-token': accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      marketplaceId: config.amazon.marketplaceId,
      packageDetail
    })
  });

  const responseText = await response.text();
  const body = responseText ? JSON.parse(responseText) : {};
  if (!response.ok) {
    throw new Error(`Amazon shipment confirmation failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return body;
}
