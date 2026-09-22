export const SETTINGS_KEYS = [
  'shipment_defaults',
  'pickup_defaults',
  'international_export_defaults',
  'automation_defaults'
];

export const DEFAULT_CRM_SETTINGS = Object.freeze({
  shipment_defaults: {
    domestic: {
      weightGrams: 400,
      lengthCm: 23,
      widthCm: 14,
      heightCm: 6
    },
    international: {
      weightGrams: 400,
      lengthCm: 24,
      widthCm: 15,
      heightCm: 6
    },
    paymentMode: 'Prepaid',
    domesticServiceCode: 'express',
    internationalServiceCode: 'dlv_saver'
  },
  pickup_defaults: {
    pickupLocation: '',
    pickupPincode: '',
    returnName: '',
    returnAddress: '',
    returnCity: '',
    returnState: '',
    returnPincode: '',
    returnPhone: '',
    sellerGstTin: '',
    hsnCode: ''
  },
  international_export_defaults: {
    shipmentType: 'Commercial',
    purposeOfBooking: 'Gift',
    invoiceTerms: 'FOB',
    productCategory: '',
    htsCode: '',
    productDescription: 'Hold My Throttle'
  },
  automation_defaults: {
    wixFulfillmentSyncEnabled: true,
    trackingEnabled: false,
    trackingIntervalMinutes: 30,
    trackingBatchSize: 25,
    whatsappOrderConfirmationEnabled: false,
    whatsappOrderConfirmationEnabledAt: '',
    whatsappInboxId: '1',
    whatsappOrderTemplateName: 'order_management_no_cta_5',
    whatsappOrderTemplateLanguage: 'en_US',
    whatsappOrderTemplateCategory: 'UTILITY'
  }
});

export function mergeCrmSettings(rows = [], base = DEFAULT_CRM_SETTINGS) {
  const settings = structuredCloneSafe(base);
  for (const row of rows || []) {
    if (!row?.key || !Object.hasOwn(settings, row.key)) continue;
    settings[row.key] = deepMerge(settings[row.key], row.value || {});
  }
  return normalizeCrmSettings(settings);
}

export function normalizeCrmSettings(settings = {}) {
  const merged = deepMerge(structuredCloneSafe(DEFAULT_CRM_SETTINGS), settings);
  const shipment = merged.shipment_defaults;
  shipment.domestic = normalizePackage(shipment.domestic, DEFAULT_CRM_SETTINGS.shipment_defaults.domestic);
  shipment.international = normalizePackage(shipment.international, DEFAULT_CRM_SETTINGS.shipment_defaults.international);
  shipment.paymentMode = ['COD', 'Prepaid'].includes(shipment.paymentMode) ? shipment.paymentMode : 'Prepaid';
  shipment.domesticServiceCode = String(shipment.domesticServiceCode || 'express');
  shipment.internationalServiceCode = String(shipment.internationalServiceCode || 'dlv_saver');

  merged.pickup_defaults = normalizeStrings(merged.pickup_defaults, DEFAULT_CRM_SETTINGS.pickup_defaults);
  merged.international_export_defaults = normalizeStrings(
    merged.international_export_defaults,
    DEFAULT_CRM_SETTINGS.international_export_defaults
  );
  merged.automation_defaults = {
    wixFulfillmentSyncEnabled: Boolean(merged.automation_defaults.wixFulfillmentSyncEnabled),
    trackingEnabled: Boolean(merged.automation_defaults.trackingEnabled),
    trackingIntervalMinutes: positiveNumber(merged.automation_defaults.trackingIntervalMinutes, 30),
    trackingBatchSize: positiveNumber(merged.automation_defaults.trackingBatchSize, 25),
    whatsappOrderConfirmationEnabled: Boolean(merged.automation_defaults.whatsappOrderConfirmationEnabled),
    whatsappOrderConfirmationEnabledAt: validIsoDate(merged.automation_defaults.whatsappOrderConfirmationEnabledAt),
    whatsappInboxId: String(merged.automation_defaults.whatsappInboxId || '1'),
    whatsappOrderTemplateName: String(merged.automation_defaults.whatsappOrderTemplateName || 'order_management_no_cta_5'),
    whatsappOrderTemplateLanguage: String(merged.automation_defaults.whatsappOrderTemplateLanguage || 'en_US'),
    whatsappOrderTemplateCategory: String(merged.automation_defaults.whatsappOrderTemplateCategory || 'UTILITY').toUpperCase()
  };
  return merged;
}

export function settingsFromFormPayload(payload = {}) {
  return normalizeCrmSettings({
    shipment_defaults: {
      domestic: {
        weightGrams: payload.domestic_weight_grams,
        lengthCm: payload.domestic_length_cm,
        widthCm: payload.domestic_width_cm,
        heightCm: payload.domestic_height_cm
      },
      international: {
        weightGrams: payload.international_weight_grams,
        lengthCm: payload.international_length_cm,
        widthCm: payload.international_width_cm,
        heightCm: payload.international_height_cm
      },
      paymentMode: payload.payment_mode,
      domesticServiceCode: payload.domestic_service_code,
      internationalServiceCode: payload.international_service_code
    },
    pickup_defaults: {
      pickupLocation: payload.pickup_location,
      pickupPincode: payload.pickup_pincode,
      returnName: payload.return_name,
      returnAddress: payload.return_address,
      returnCity: payload.return_city,
      returnState: payload.return_state,
      returnPincode: payload.return_pincode,
      returnPhone: payload.return_phone,
      sellerGstTin: payload.seller_gst_tin,
      hsnCode: payload.hsn_code
    },
    international_export_defaults: {
      shipmentType: payload.international_shipment_type,
      purposeOfBooking: payload.international_purpose_of_booking,
      invoiceTerms: payload.invoice_terms,
      productCategory: payload.international_product_category,
      htsCode: payload.hts_code,
      productDescription: payload.international_product_description
    },
    automation_defaults: {
      wixFulfillmentSyncEnabled: payload.wix_fulfillment_sync_enabled === 'on' || payload.wix_fulfillment_sync_enabled === true,
      trackingEnabled: payload.tracking_enabled === 'on' || payload.tracking_enabled === true,
      trackingIntervalMinutes: payload.tracking_interval_minutes,
      trackingBatchSize: payload.tracking_batch_size,
      whatsappOrderConfirmationEnabled: payload.whatsapp_order_confirmation_enabled === 'on' || payload.whatsapp_order_confirmation_enabled === true,
      whatsappOrderConfirmationEnabledAt:
        payload.whatsapp_order_confirmation_enabled_at ||
        ((payload.whatsapp_order_confirmation_enabled === 'on' || payload.whatsapp_order_confirmation_enabled === true) ? new Date().toISOString() : ''),
      whatsappInboxId: payload.whatsapp_inbox_id,
      whatsappOrderTemplateName: payload.whatsapp_order_template_name,
      whatsappOrderTemplateLanguage: payload.whatsapp_order_template_language,
      whatsappOrderTemplateCategory: payload.whatsapp_order_template_category
    }
  });
}

export function applyCrmSettingsToConfig(config, settings) {
  const normalized = normalizeCrmSettings(settings);
  const shipment = normalized.shipment_defaults;
  const pickup = normalized.pickup_defaults;
  const international = normalized.international_export_defaults;
  const automation = normalized.automation_defaults;
  const savedAutomation = settings?.automation_defaults || {};
  const savedConfirmationSetting = Object.hasOwn(savedAutomation, 'whatsappOrderConfirmationEnabled');

  return {
    ...config,
    wix: {
      ...config.wix,
      fulfillmentSyncEnabled: automation.wixFulfillmentSyncEnabled
    },
    chatwoot: {
      ...(config.chatwoot || {}),
      orderConfirmationEnabled: savedConfirmationSetting
        ? automation.whatsappOrderConfirmationEnabled
        : Boolean(config.chatwoot?.orderConfirmationEnabled),
      orderConfirmationEnabledAt: automation.whatsappOrderConfirmationEnabledAt || config.chatwoot?.orderConfirmationEnabledAt || '',
      inboxId: savedConfirmationSetting ? automation.whatsappInboxId : (config.chatwoot?.inboxId || automation.whatsappInboxId),
      orderTemplateName: savedConfirmationSetting ? automation.whatsappOrderTemplateName : (config.chatwoot?.orderTemplateName || automation.whatsappOrderTemplateName),
      orderTemplateLanguage: savedConfirmationSetting ? automation.whatsappOrderTemplateLanguage : (config.chatwoot?.orderTemplateLanguage || automation.whatsappOrderTemplateLanguage),
      orderTemplateCategory: savedConfirmationSetting ? automation.whatsappOrderTemplateCategory : (config.chatwoot?.orderTemplateCategory || automation.whatsappOrderTemplateCategory)
    },
    delhivery: {
      ...config.delhivery,
      pickupLocation: pickup.pickupLocation || config.delhivery.pickupLocation,
      pickupPincode: pickup.pickupPincode || config.delhivery.pickupPincode,
      returnName: pickup.returnName || config.delhivery.returnName,
      returnAddress: pickup.returnAddress || config.delhivery.returnAddress,
      returnCity: pickup.returnCity || config.delhivery.returnCity,
      returnState: pickup.returnState || config.delhivery.returnState,
      returnPincode: pickup.returnPincode || config.delhivery.returnPincode,
      returnPhone: pickup.returnPhone || config.delhivery.returnPhone,
      trackingEnabled: automation.trackingEnabled,
      trackingIntervalMs: automation.trackingIntervalMinutes * 60_000,
      trackingBatchSize: automation.trackingBatchSize
    },
    defaults: {
      ...config.defaults,
      sellerGstTin: pickup.sellerGstTin || config.defaults.sellerGstTin,
      hsnCode: pickup.hsnCode || config.defaults.hsnCode,
      weightGrams: shipment.domestic.weightGrams,
      lengthCm: shipment.domestic.lengthCm,
      widthCm: shipment.domestic.widthCm,
      heightCm: shipment.domestic.heightCm,
      internationalWeightGrams: shipment.international.weightGrams,
      internationalLengthCm: shipment.international.lengthCm,
      internationalWidthCm: shipment.international.widthCm,
      internationalHeightCm: shipment.international.heightCm,
      paymentMode: shipment.paymentMode,
      internationalShipmentType: international.shipmentType,
      internationalPurposeOfBooking: international.purposeOfBooking,
      invoiceTerms: international.invoiceTerms,
      internationalProductCategory: international.productCategory,
      htsCode: international.htsCode,
      internationalProductDescription: international.productDescription
    }
  };
}

function normalizePackage(value = {}, fallback) {
  return {
    weightGrams: positiveNumber(value.weightGrams, fallback.weightGrams),
    lengthCm: positiveNumber(value.lengthCm, fallback.lengthCm),
    widthCm: positiveNumber(value.widthCm, fallback.widthCm),
    heightCm: positiveNumber(value.heightCm, fallback.heightCm)
  };
}

function normalizeStrings(value = {}, fallback = {}) {
  const normalized = {};
  for (const key of Object.keys(fallback)) {
    normalized[key] = value[key] === undefined || value[key] === null ? fallback[key] : String(value[key]);
  }
  return normalized;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function validIsoDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function deepMerge(target, source) {
  const output = { ...target };
  for (const [key, value] of Object.entries(source || {})) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}
