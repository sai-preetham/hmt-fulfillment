import { buildFedexBatchUploadRow } from './internationalExport.js';

let cachedRateToken = '';
let rateTokenExpiresAt = 0;

export async function fetchFedexRateQuote(order, config) {
  validateFedexRateConfig(config);
  const row = buildFedexBatchUploadRow(order, config);
  const token = await getFedexRateToken(config);
  const url = `${config.fedex.baseUrl.replace(/\/$/, '')}/rate/v1/rates/quotes`;
  const payload = buildFedexRatePayload(row, config);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const body = await safeJson(response);
  if (!response.ok) {
    throw new Error(`FedEx rate API failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return {
    ok: true,
    request: payload,
    raw: body,
    quotes: parseFedexRateQuotes(body)
  };
}

export function buildFedexRatePayload(row, config) {
  const accountNumber = String(config.fedex.accountNumber || '');
  const packageWeight = positiveNumber(row.packageWeight, 0.5);
  const length = positiveNumber(row.length, 23);
  const width = positiveNumber(row.width, 16);
  const height = positiveNumber(row.height, 6);
  const customsValue = positiveNumber(row.customsValue, 1);
  const commodityWeight = positiveNumber(row.commodityWeight, packageWeight);
  const commodityQuantity = Math.max(1, Math.trunc(positiveNumber(row.commodityQuantity, 1)));
  const weightUnits = fedexWeightUnits(row.weightUnits);

  return {
    accountNumber: { value: accountNumber },
    rateRequestControlParameters: {
      returnTransitTimes: true
    },
    requestedShipment: {
      shipper: {
        address: {
          streetLines: [row.senderLine1, row.senderLine2].filter(Boolean),
          city: row.senderCity,
          stateOrProvinceCode: row.senderState,
          postalCode: String(row.senderPostcode || ''),
          countryCode: row.senderCountry
        }
      },
      recipient: {
        address: {
          streetLines: [row.recipientLine1, row.recipientLine2].filter(Boolean),
          city: row.recipientCity,
          stateOrProvinceCode: fedexStateCode(row.recipientState),
          postalCode: String(row.recipientPostcode || ''),
          countryCode: row.recipientCountry
        }
      },
      pickupType: 'USE_SCHEDULED_PICKUP',
      serviceType: row.serviceType || 'FEDEX_INTERNATIONAL_PRIORITY',
      packagingType: row.packageType || 'YOUR_PACKAGING',
      rateRequestType: ['ACCOUNT', 'LIST'],
      preferredCurrency: row.currencyType || 'INR',
      customsClearanceDetail: {
        dutiesPayment: {
          paymentType: 'SENDER',
          payor: {
            responsibleParty: {
              accountNumber: { value: accountNumber }
            }
          }
        },
        commodities: [
          {
            description: row.itemDescription || 'Hold My Throttle',
            countryOfManufacture: row.manufacturingCountry || 'IN',
            quantity: commodityQuantity,
            quantityUnits: row.commodityMeasureUnit || 'BOX',
            unitPrice: {
              amount: roundMoney(customsValue / commodityQuantity),
              currency: row.currencyType || 'INR'
            },
            customsValue: {
              amount: roundMoney(customsValue),
              currency: row.currencyType || 'INR'
            },
            weight: {
              units: weightUnits,
              value: commodityWeight
            }
          }
        ]
      },
      requestedPackageLineItems: [
        {
          groupPackageCount: Number(row.numberOfPackages || 1),
          weight: {
            units: weightUnits,
            value: packageWeight
          },
          dimensions: {
            length,
            width,
            height,
            units: 'CM'
          }
        }
      ]
    }
  };
}

export function parseFedexRateQuotes(body = {}) {
  const details = body?.output?.rateReplyDetails || [];
  return details.map(detail => {
    const rated = detail.ratedShipmentDetails || [];
    const preferred =
      rated.find(item => item.rateType === 'ACCOUNT') ||
      rated.find(item => String(item.rateType || '').includes('ACCOUNT')) ||
      rated[0] ||
      {};
    const shipmentRate = preferred.shipmentRateDetail || {};
    const total = moneyValue(
      preferred.totalNetChargeWithDutiesAndTaxes ??
        preferred.totalNetCharge ??
        shipmentRate.totalNetCharge ??
        preferred.totalNetFedExCharge ??
        shipmentRate.totalNetFedExCharge ??
        preferred.totalBaseCharge ??
        shipmentRate.totalBaseCharge
    );
    return {
      serviceType: detail.serviceType || '',
      serviceName: detail.serviceName || detail.serviceType || '',
      rateType: preferred.rateType || '',
      currency: total.currency || shipmentRate.currency || '',
      amount: total.amount ?? '',
      transitTime: detail.transitTime || '',
      commitmentDate: detail.operationalDetail?.deliveryDate || detail.commit?.dateDetail?.dayFormat || '',
      ratedShipmentDetails: rated
    };
  });
}

function moneyValue(value) {
  if (value && typeof value === 'object') return value;
  if (value !== undefined && value !== null && value !== '') return { amount: value };
  return {};
}

function validateFedexRateConfig(config) {
  if (!config?.fedex?.clientId || !config?.fedex?.clientSecret) {
    throw new Error('FedEx rate estimates require FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET.');
  }
  if (!config?.fedex?.accountNumber) {
    throw new Error('FedEx rate estimates require FEDEX_ACCOUNT_NUMBER.');
  }
}

async function getFedexRateToken(config) {
  const now = Date.now();
  if (cachedRateToken && rateTokenExpiresAt > now + 60000) return cachedRateToken;

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', config.fedex.clientId);
  params.append('client_secret', config.fedex.clientSecret);

  const response = await fetch(`${config.fedex.baseUrl.replace(/\/$/, '')}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  const body = await safeJson(response);
  if (!response.ok || !body?.access_token) {
    throw new Error(`FedEx auth failed (${response.status}): ${JSON.stringify(body)}`);
  }

  cachedRateToken = body.access_token;
  rateTokenExpiresAt = Date.now() + Number(body.expires_in || 3600) * 1000;
  return cachedRateToken;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function fedexWeightUnits(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'KGS' || normalized === 'KILOGRAMS') return 'KG';
  return normalized || 'KG';
}

function fedexStateCode(value) {
  const code = String(value || '').replace(/^[A-Z]{2}-/, '').trim();
  return code && code.length <= 2 ? code : undefined;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
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
