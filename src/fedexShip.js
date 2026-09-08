import { buildFedexBatchUploadRow } from './internationalExport.js';

let cachedShipToken = '';
let shipTokenExpiresAt = 0;

export function mapWixOrderToFedexShipment(order, config, options = {}) {
  const delivery = options.deliveryOverride || {};
  const contact = delivery.contact || {};
  return buildFedexShipmentPayload({
    raw_order: order,
    fedex_payload: options.fedexPayload || {},
    // The CRM shipping address is the authoritative destination when present.
    // Do not use billing information for a shipment recipient.
    shipping_address: {
      name: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
      phone: contact.phone,
      address_line1: delivery.address?.addressLine,
      address_line2: delivery.address?.addressLine2,
      city: delivery.address?.city,
      state: delivery.address?.subdivision,
      postal_code: delivery.address?.postalCode,
      country: delivery.address?.country
    }
  }, config, {
    orderNumber: options.orderNumberOverride || order?.number || order?.id || ''
  });
}

export async function createFedexShipment(payload, config) {
  validateFedexShipConfig(config);
  const token = await getFedexShipToken(config);
  const response = await fetch(`${config.fedex.baseUrl.replace(/\/$/, '')}/ship/v1/shipments`, {
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
    throw new Error(`FedEx Ship API failed (${response.status}): ${JSON.stringify(body)}`);
  }

  return body;
}

export function buildFedexShipmentPayload(order, config, options = {}) {
  const row = buildFedexBatchUploadRow(order, config);
  const accountNumber = String(config.fedex.accountNumber || '');
  const packageWeight = positiveNumber(row.packageWeight, 0.5);
  const commodityWeight = positiveNumber(row.commodityWeight, packageWeight);
  const customsValue = positiveNumber(row.customsValue, 1);
  const commodityQuantity = Math.max(1, Math.trunc(positiveNumber(row.commodityQuantity, 1)));
  const currency = row.currencyType || 'INR';

  return {
    labelResponseOptions: 'LABEL',
    accountNumber: { value: accountNumber },
    requestedShipment: {
      shipDatestamp: new Date().toISOString().slice(0, 10),
      pickupType: 'USE_SCHEDULED_PICKUP',
      serviceType: row.serviceType || 'FEDEX_INTERNATIONAL_PRIORITY',
      packagingType: row.packageType || 'YOUR_PACKAGING',
      blockInsightVisibility: false,
      shipper: {
        contact: {
          personName: row.senderContactName,
          companyName: row.senderCompany,
          phoneNumber: String(row.senderContactNumber || ''),
          emailAddress: row.senderEmail || undefined
        },
        address: {
          streetLines: [row.senderLine1, row.senderLine2].filter(Boolean),
          city: row.senderCity,
          stateOrProvinceCode: fedexStateCode(row.senderState),
          postalCode: String(row.senderPostcode || ''),
          countryCode: row.senderCountry
        }
      },
      recipients: [
        {
          contact: {
            personName: row.recipientContactName,
            companyName: row.recipientCompany || undefined,
            phoneNumber: String(row.recipientContactNumber || ''),
            emailAddress: row.recipientEmail || undefined
          },
          address: {
            streetLines: [row.recipientLine1, row.recipientLine2].filter(Boolean),
            city: row.recipientCity,
            stateOrProvinceCode: fedexStateCode(row.recipientState),
            postalCode: String(row.recipientPostcode || ''),
            countryCode: row.recipientCountry,
            residential: false
          }
        }
      ],
      shippingChargesPayment: {
        paymentType: 'SENDER',
        payor: {
          responsibleParty: {
            accountNumber: { value: accountNumber }
          }
        }
      },
      customsClearanceDetail: {
        dutiesPayment: {
          paymentType: 'RECIPIENT'
        },
        commodities: [
          {
            description: row.itemDescription || 'Hold My Throttle',
            countryOfManufacture: row.manufacturingCountry || 'IN',
            quantity: commodityQuantity,
            quantityUnits: row.commodityMeasureUnit || 'BOX',
            unitPrice: {
              amount: roundMoney(customsValue / commodityQuantity),
              currency
            },
            customsValue: {
              amount: roundMoney(customsValue),
              currency
            },
            weight: {
              units: fedexWeightUnits(row.weightUnits),
              value: commodityWeight
            }
          }
        ],
        commercialInvoice: {
          shipmentPurpose: row.purposeOfShipment || 'SOLD'
        }
      },
      labelSpecification: {
        labelStockType: 'PAPER_4X6',
        imageType: 'PDF'
      },
      requestedPackageLineItems: [
        {
          customerReferences: options.orderNumber
            ? [{ customerReferenceType: 'CUSTOMER_REFERENCE', value: String(options.orderNumber) }]
            : undefined,
          weight: {
            units: fedexWeightUnits(row.weightUnits),
            value: packageWeight
          },
          dimensions: {
            length: positiveNumber(row.length, 23),
            width: positiveNumber(row.width, 16),
            height: positiveNumber(row.height, 6),
            units: 'CM'
          }
        }
      ]
    }
  };
}

export function parseFedexShipmentResponse(body = {}) {
  const shipment = body?.output?.transactionShipments?.[0] || {};
  const piece = shipment.pieceResponses?.[0] || {};
  const label = piece.packageDocuments?.[0] || shipment.shipmentDocuments?.[0] || {};
  const labelBase64 = label.encodedLabel || label.parts?.[0]?.image || '';
  return {
    waybill: shipment.masterTrackingNumber || piece.trackingNumber || '',
    labelBase64,
    labelFormat: label.contentType || label.docType || 'PDF',
    raw: body
  };
}

function validateFedexShipConfig(config) {
  if (!config?.fedex?.clientId || !config?.fedex?.clientSecret) {
    throw new Error('FedEx booking requires FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET.');
  }
  if (!config?.fedex?.accountNumber) {
    throw new Error('FedEx booking requires FEDEX_ACCOUNT_NUMBER.');
  }
}

async function getFedexShipToken(config) {
  const now = Date.now();
  if (cachedShipToken && shipTokenExpiresAt > now + 60000) return cachedShipToken;

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', config.fedex.clientId);
  params.append('client_secret', config.fedex.clientSecret);

  const response = await fetch(`${config.fedex.baseUrl.replace(/\/$/, '')}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  const body = await safeJson(response);
  if (!response.ok || !body?.access_token) {
    throw new Error(`FedEx auth failed (${response.status}): ${JSON.stringify(body)}`);
  }

  cachedShipToken = body.access_token;
  shipTokenExpiresAt = Date.now() + Number(body.expires_in || 3600) * 1000;
  return cachedShipToken;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
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

async function safeJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
