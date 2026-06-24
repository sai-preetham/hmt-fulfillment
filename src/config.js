import process from 'node:process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

loadEnvFile();

export function getConfig() {
  const delhiveryEnv = process.env.DELHIVERY_ENV === 'production' ? 'production' : 'staging';

  return {
    port: Number(process.env.PORT || 3000),
    publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
    autoBookWixWebhooks: process.env.AUTO_BOOK_WIX_WEBHOOKS === 'true',
    createAwbOnBook: process.env.CREATE_AWB_ON_BOOK !== 'false',
    wix: {
      authToken: process.env.WIX_AUTH_TOKEN || '',
      siteId: process.env.WIX_SITE_ID || '',
      accountId: process.env.WIX_ACCOUNT_ID || '',
      webhookPublicKey: normalizePem(process.env.WIX_WEBHOOK_PUBLIC_KEY || ''),
      webhookSecret: process.env.WIX_WEBHOOK_SECRET || '',
      requestTimeoutMs: positiveNumber(process.env.WIX_REQUEST_TIMEOUT_SECONDS, 30) * 1000,
      fulfillmentSyncEnabled: process.env.WIX_FULFILLMENT_SYNC_ENABLED !== 'false',
      trackingUrlTemplate:
        process.env.WIX_TRACKING_URL_TEMPLATE ||
        process.env.DELHIVERY_TRACKING_URL_TEMPLATE ||
        'https://www.delhivery.com/track/package/{waybill}',
      orderSync: {
        enabled: process.env.WIX_ORDER_SYNC_ENABLED === 'true',
        intervalMs: positiveNumber(process.env.WIX_ORDER_SYNC_INTERVAL_MINUTES, 5) * 60 * 1000,
        pageSize: clamp(Number(process.env.WIX_ORDER_SYNC_PAGE_SIZE || 25), 1, 100),
        maxPages: clamp(Number(process.env.WIX_ORDER_SYNC_MAX_PAGES || 1), 1, 20)
      }
    },
    supabase: {
      url: process.env.SUPABASE_URL || '',
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      anonKey: process.env.SUPABASE_ANON_KEY || ''
    },
    delhivery: {
      env: delhiveryEnv,
      token: process.env.DELHIVERY_API_TOKEN || '',
      clientName: process.env.DELHIVERY_CLIENT_NAME || '',
      pickupLocation: process.env.DELHIVERY_PICKUP_LOCATION || '',
      pickupPincode: process.env.DELHIVERY_PICKUP_PINCODE || '',
      returnName: process.env.DELHIVERY_RETURN_NAME || process.env.DELHIVERY_PICKUP_LOCATION || '',
      returnAddress: process.env.DELHIVERY_RETURN_ADDRESS || '',
      returnCity: process.env.DELHIVERY_RETURN_CITY || '',
      returnState: process.env.DELHIVERY_RETURN_STATE || '',
      returnPincode: process.env.DELHIVERY_RETURN_PINCODE || process.env.DELHIVERY_PICKUP_PINCODE || '',
      returnPhone: process.env.DELHIVERY_RETURN_PHONE || '',
      labelUrl:
        process.env.DELHIVERY_LABEL_URL ||
        (delhiveryEnv === 'production'
          ? 'https://track.delhivery.com/api/p/packing_slip'
          : 'https://staging-express.delhivery.com/api/p/packing_slip'),
      trackingUrlTemplate: process.env.DELHIVERY_TRACKING_URL_TEMPLATE || 'https://www.delhivery.com/track/package/{waybill}',
      trackingApiUrl: 'https://track.delhivery.com/api/v1/packages/json/',
      trackingEnabled: process.env.DELHIVERY_TRACKING_ENABLED === 'true',
      trackingIntervalMs: positiveNumber(process.env.DELHIVERY_TRACKING_INTERVAL_MINUTES, 30) * 60_000,
      trackingBatchSize: clamp(Number(process.env.DELHIVERY_TRACKING_BATCH_SIZE || 25), 1, 50),
      invoiceUrl:
        delhiveryEnv === 'production'
          ? 'https://track.delhivery.com/api/kinko/v1/invoice/charges/.json'
          : 'https://staging-express.delhivery.com/api/kinko/v1/invoice/charges/.json',
      createOrderUrl:
        delhiveryEnv === 'production'
          ? 'https://track.delhivery.com/api/cmu/create.json'
          : 'https://staging-express.delhivery.com/api/cmu/create.json'
    },
    shiprocket: {
      baseUrl: process.env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in/v1/external',
      token: process.env.SHIPROCKET_API_TOKEN || process.env.SHIPROCKET_AUTH_TOKEN || '',
      email: process.env.SHIPROCKET_EMAIL || '',
      password: process.env.SHIPROCKET_PASSWORD || '',
      trackingUrlTemplate: process.env.SHIPROCKET_TRACKING_URL_TEMPLATE || 'https://www.shiprocket.in/shipment-tracking/{waybill}',
      trackingEnabled: process.env.SHIPROCKET_TRACKING_ENABLED === 'true',
      trackingBatchSize: clamp(Number(process.env.SHIPROCKET_TRACKING_BATCH_SIZE || 10), 1, 25)
    },
    defaults: {
      sellerGstTin: process.env.DEFAULT_SELLER_GST_TIN || '',
      hsnCode: process.env.DEFAULT_HSN_CODE || '',
      weightGrams: Number(process.env.DEFAULT_WEIGHT_GRAMS || 500),
      lengthCm: Number(process.env.DEFAULT_LENGTH_CM || 10),
      widthCm: Number(process.env.DEFAULT_WIDTH_CM || 10),
      heightCm: Number(process.env.DEFAULT_HEIGHT_CM || 10),
      paymentMode: process.env.DEFAULT_PAYMENT_MODE || 'Prepaid',
      shippingMode: normalizeShippingMode(process.env.DEFAULT_SHIPPING_MODE || 'Express'),
      internationalShipmentType: process.env.DEFAULT_INTERNATIONAL_SHIPMENT_TYPE || 'Commercial',
      internationalRateCard: parseInternationalRateCard(process.env.INTERNATIONAL_RATE_CARD_JSON || '')
    }
  };
}

function loadEnvFile() {
  try {
    const raw = readFileSync(join(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) continue;
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function normalizePem(value) {
  return value.includes('\\n') ? value.replaceAll('\\n', '\n') : value;
}

function normalizeShippingMode(value) {
  const normalized = String(value).trim().toLowerCase();
  if (['s', 'surface'].includes(normalized)) return 'S';
  return 'E';
}

function parseInternationalRateCard(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
