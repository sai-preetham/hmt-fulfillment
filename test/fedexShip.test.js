import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFedexShipmentPayload, parseFedexShipmentResponse } from '../src/fedexShip.js';

test('builds FedEx Ship API payload for international shipment', () => {
  const payload = buildFedexShipmentPayload(
    {
      raw_order: {
        id: 'wix-order-id',
        number: '10446',
        currency: 'INR',
        buyerInfo: { email: 'buyer@example.com' },
        priceSummary: { total: { amount: '18498' } },
        shippingInfo: {
          logistics: {
            shippingDestination: {
              address: {
                addressLine: 'Main Street 1',
                city: 'Berlin',
                subdivision: 'DE-BE',
                postalCode: '10115',
                country: 'DE'
              },
              contactDetails: {
                firstName: 'Ada',
                lastName: 'Buyer',
                phone: '4912345678'
              }
            }
          }
        },
        lineItems: [
          {
            productName: { original: 'Hold My Throttle' },
            quantity: 1,
            physicalProperties: { weight: 0.4 }
          }
        ]
      }
    },
    {
      fedex: { accountNumber: '210264166' },
      defaults: { weightGrams: 400, lengthCm: 23, widthCm: 14, heightCm: 6, internationalShipmentType: 'Commercial' }
    },
    { orderNumber: '10446' }
  );

  assert.equal(payload.labelResponseOptions, 'LABEL');
  assert.equal(payload.accountNumber.value, '210264166');
  assert.equal(payload.requestedShipment.serviceType, 'FEDEX_INTERNATIONAL_PRIORITY');
  assert.equal(payload.requestedShipment.shipper.contact.personName, 'Sai Preetham');
  assert.equal(payload.requestedShipment.recipients[0].address.countryCode, 'DE');
  assert.equal(payload.requestedShipment.recipients[0].address.stateOrProvinceCode, 'BE');
  assert.equal(payload.requestedShipment.requestedPackageLineItems[0].weight.units, 'KG');
  assert.equal(payload.requestedShipment.customsClearanceDetail.commercialInvoice.shipmentPurpose, 'SOLD');
  assert.equal(payload.requestedShipment.labelSpecification.imageType, 'PDF');
});

test('parses FedEx Ship API response tracking and label', () => {
  const parsed = parseFedexShipmentResponse({
    output: {
      transactionShipments: [
        {
          masterTrackingNumber: '794612345678',
          pieceResponses: [
            {
              trackingNumber: '794612345678',
              packageDocuments: [
                {
                  contentType: 'PDF',
                  encodedLabel: 'JVBERi0x'
                }
              ]
            }
          ]
        }
      ]
    }
  });

  assert.equal(parsed.waybill, '794612345678');
  assert.equal(parsed.labelBase64, 'JVBERi0x');
  assert.equal(parsed.labelFormat, 'PDF');
});
