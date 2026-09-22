import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCrmSettingsToConfig,
  mergeCrmSettings,
  settingsFromFormPayload
} from '../lib/crm/settings.js';

test('merges saved CRM shipment defaults over fallback settings', () => {
  const settings = mergeCrmSettings([
    {
      key: 'shipment_defaults',
      value: {
        domestic: { weightGrams: 450, heightCm: 7 },
        international: { heightCm: 9 },
        domesticServiceCode: 'surface'
      }
    }
  ]);

  assert.equal(settings.shipment_defaults.domestic.weightGrams, 450);
  assert.equal(settings.shipment_defaults.domestic.lengthCm, 23);
  assert.equal(settings.shipment_defaults.domestic.heightCm, 7);
  assert.equal(settings.shipment_defaults.international.weightGrams, 400);
  assert.equal(settings.shipment_defaults.international.heightCm, 9);
  assert.equal(settings.shipment_defaults.domesticServiceCode, 'surface');
});

test('normalizes settings form payload into typed settings', () => {
  const settings = settingsFromFormPayload({
    domestic_weight_grams: '400',
    domestic_length_cm: '23',
    domestic_width_cm: '15',
    domestic_height_cm: '5',
    international_weight_grams: '400',
    international_length_cm: '23',
    international_width_cm: '15',
    international_height_cm: '6',
    payment_mode: 'Prepaid',
    domestic_service_code: 'express',
    international_service_code: 'dlv_saver',
    pickup_location: 'HMT Warehouse',
    tracking_enabled: 'on',
    tracking_interval_minutes: '20',
    tracking_batch_size: '30',
    whatsapp_order_confirmation_enabled: 'on',
    whatsapp_order_confirmation_enabled_at: '2026-09-21T10:30:00.000Z',
    whatsapp_inbox_id: '1',
    whatsapp_order_template_name: 'order_management_no_cta_5',
    whatsapp_order_template_language: 'en_US',
    whatsapp_order_template_category: 'utility'
  });

  assert.equal(settings.shipment_defaults.domestic.weightGrams, 400);
  assert.equal(settings.shipment_defaults.international.heightCm, 6);
  assert.equal(settings.pickup_defaults.pickupLocation, 'HMT Warehouse');
  assert.equal(settings.automation_defaults.trackingEnabled, true);
  assert.equal(settings.automation_defaults.trackingIntervalMinutes, 20);
  assert.equal(settings.automation_defaults.trackingBatchSize, 30);
  assert.equal(settings.automation_defaults.whatsappOrderConfirmationEnabled, true);
  assert.equal(settings.automation_defaults.whatsappOrderConfirmationEnabledAt, '2026-09-21T10:30:00.000Z');
  assert.equal(settings.automation_defaults.whatsappOrderTemplateName, 'order_management_no_cta_5');
  assert.equal(settings.automation_defaults.whatsappOrderTemplateCategory, 'UTILITY');
});

test('applies CRM settings onto runtime courier config without replacing secrets', () => {
  const config = {
    wix: { authToken: 'wix-token', fulfillmentSyncEnabled: false },
    delhivery: {
      token: 'delhivery-token',
      pickupLocation: 'Env Pickup',
      pickupPincode: '110001',
      trackingEnabled: false,
      trackingIntervalMs: 30_000,
      trackingBatchSize: 10
    },
    defaults: {
      sellerGstTin: 'ENVGST',
      hsnCode: 'ENVHSN',
      weightGrams: 500,
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10
    }
  };
  const settings = mergeCrmSettings([
    { key: 'pickup_defaults', value: { pickupLocation: 'CRM Pickup', sellerGstTin: 'CRMGST', hsnCode: '87141090' } },
    { key: 'automation_defaults', value: { wixFulfillmentSyncEnabled: true, trackingEnabled: true, trackingIntervalMinutes: 15 } }
  ]);

  const updated = applyCrmSettingsToConfig(config, settings);

  assert.equal(updated.wix.authToken, 'wix-token');
  assert.equal(updated.wix.fulfillmentSyncEnabled, true);
  assert.equal(updated.delhivery.token, 'delhivery-token');
  assert.equal(updated.delhivery.pickupLocation, 'CRM Pickup');
  assert.equal(updated.delhivery.trackingEnabled, true);
  assert.equal(updated.delhivery.trackingIntervalMs, 900000);
  assert.equal(updated.defaults.sellerGstTin, 'CRMGST');
  assert.equal(updated.defaults.hsnCode, '87141090');
  assert.equal(updated.defaults.weightGrams, 400);
  assert.equal(updated.defaults.internationalHeightCm, 6);
});

test('keeps env pickup location when CRM pickup setting is blank', () => {
  const config = {
    wix: {},
    delhivery: {
      pickupLocation: 'Env Pickup',
      pickupPincode: '110001'
    },
    defaults: {}
  };
  const settings = mergeCrmSettings([]);

  const updated = applyCrmSettingsToConfig(config, settings);

  assert.equal(updated.delhivery.pickupLocation, 'Env Pickup');
});

test('uses environment-backed WhatsApp confirmation settings when CRM settings are unavailable', () => {
  const config = {
    wix: {}, delhivery: {}, defaults: {},
    chatwoot: {
      orderConfirmationEnabled: true,
      orderConfirmationEnabledAt: '2026-09-21T10:00:00.000Z',
      inboxId: '1',
      orderTemplateName: 'order_management_no_cta_5',
      orderTemplateLanguage: 'en_US',
      orderTemplateCategory: 'UTILITY'
    }
  };
  const updated = applyCrmSettingsToConfig(config, {});
  assert.equal(updated.chatwoot.orderConfirmationEnabled, true);
  assert.equal(updated.chatwoot.orderConfirmationEnabledAt, '2026-09-21T10:00:00.000Z');
  assert.equal(updated.chatwoot.orderTemplateName, 'order_management_no_cta_5');
});
