import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAmazonOrder } from '../src/fulfillment.js';
import { mapAmazonOrderToDelhivery } from '../src/delhivery.js';

test('normalizes Amazon order payload correctly', () => {
  const payload = sampleAmazonPayload();
  const normalized = normalizeAmazonOrder(payload, { defaults: { hsnCode: '90328910', weightGrams: 400 } });

  assert.equal(normalized.customer.name, 'Sneha Kulkarni');
  assert.equal(normalized.customer.email, 'sneha@example.com');
  assert.equal(normalized.customer.phone, '+919988776655');
  assert.equal(normalized.shippingAddress.address_line1, 'A-503 Green Park Society, Baner Road');
  assert.equal(normalized.shippingAddress.city, 'Pune');
  assert.equal(normalized.shippingAddress.postal_code, '411045');
  assert.equal(normalized.order.source, 'amazon');
  assert.equal(normalized.order.external_order_id, 'AMZ-406-1234567');
  assert.equal(normalized.order.total_amount, 13999);
  assert.equal(normalized.items[0].sku, 'HMT-390-ADV-KIT');
  assert.equal(normalized.items[0].product_name, 'HMT Cruise Kit - KTM 390 Adv');
  assert.equal(normalized.items[0].quantity, 1);
});

test('maps Amazon order to Delhivery structure correctly', () => {
  const payload = sampleAmazonPayload();
  const config = {
    defaults: {
      widthCm: 10,
      heightCm: 10,
      lengthCm: 20,
      weightGrams: 500,
      sellerGstTin: 'GST-TIN',
      hsnCode: '90328910',
      shippingMode: 'E'
    },
    delhivery: {
      pickupLocation: 'HSR GDP'
    }
  };

  const mapped = mapAmazonOrderToDelhivery(payload, config);
  assert.equal(mapped.pickup_location.name, 'HSR GDP');
  assert.equal(mapped.shipments[0].name, 'Sneha Kulkarni');
  assert.equal(mapped.shipments[0].add, 'A-503 Green Park Society, Baner Road, Near Green Park Hotel');
  assert.equal(mapped.shipments[0].city, 'Pune');
  assert.equal(mapped.shipments[0].pin, '411045');
  assert.equal(mapped.shipments[0].phone, '+919988776655');
  assert.equal(mapped.shipments[0].order, 'AMZ-406-1234567');
  assert.equal(mapped.shipments[0].payment_mode, 'Prepaid');
  assert.equal(mapped.shipments[0].cod_amount, 0);
  assert.equal(mapped.shipments[0].total_amount, 13999);
  assert.equal(mapped.shipments[0].products_desc, 'HMT Cruise Kit - KTM 390 Adv');
});

function sampleAmazonPayload() {
  return {
    order: {
      AmazonOrderId: 'AMZ-406-1234567',
      PurchaseDate: '2026-06-25T03:00:00.000Z',
      LastUpdateDate: '2026-06-25T03:05:00.000Z',
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
        OrderItemId: 'AMZ-LINE-1234567',
        QuantityOrdered: 1,
        ItemPrice: { Amount: '13999', CurrencyCode: 'INR' }
      }
    ]
  };
}
