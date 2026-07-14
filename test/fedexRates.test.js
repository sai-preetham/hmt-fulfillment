import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFedexRatePayload, parseFedexRateQuotes } from '../src/fedexRates.js';

test('builds FedEx rate request payload from batch upload row', () => {
  const payload = buildFedexRatePayload(
    {
      serviceType: 'FEDEX_INTERNATIONAL_PRIORITY',
      senderLine1: '815, 23rd Cross Rd',
      senderLine2: '7th Sector, HSR Layout',
      senderCity: 'Bengaluru',
      senderState: 'KA',
      senderPostcode: '560102',
      senderCountry: 'IN',
      recipientLine1: 'Via Vittorio Veneto, 28',
      recipientCity: 'Voghera',
      recipientState: 'IT-25',
      recipientPostcode: '27058',
      recipientCountry: 'IT',
      packageType: 'YOUR_PACKAGING',
      currencyType: 'INR',
      itemDescription: 'Hold My Throttle',
      manufacturingCountry: 'IN',
      commodityQuantity: 1,
      commodityMeasureUnit: 'BOX',
      commodityWeight: 0.4,
      customsValue: 18998,
      numberOfPackages: 1,
      packageWeight: 0.4,
      weightUnits: 'KGS',
      length: 23,
      width: 14,
      height: 6
    },
    {
      fedex: {
        accountNumber: '210264166'
      }
    }
  );

  assert.equal(payload.accountNumber.value, '210264166');
  assert.equal(payload.requestedShipment.serviceType, 'FEDEX_INTERNATIONAL_PRIORITY');
  assert.equal(payload.requestedShipment.shipper.address.countryCode, 'IN');
  assert.equal(payload.requestedShipment.recipient.address.countryCode, 'IT');
  assert.equal(payload.requestedShipment.requestedPackageLineItems[0].weight.value, 0.4);
  assert.equal(payload.requestedShipment.requestedPackageLineItems[0].dimensions.width, 14);
  assert.equal(payload.requestedShipment.customsClearanceDetail.commodities[0].customsValue.amount, 18998);
});

test('parses FedEx rate quotes from response body', () => {
  const quotes = parseFedexRateQuotes({
    output: {
      rateReplyDetails: [
        {
          serviceType: 'FEDEX_INTERNATIONAL_PRIORITY',
          serviceName: 'FedEx International Priority',
          transitTime: 'THREE_DAYS',
          operationalDetail: { deliveryDate: '2026-07-17' },
          ratedShipmentDetails: [
            {
              rateType: 'ACCOUNT',
              shipmentRateDetail: {
                totalNetCharge: {
                  amount: 6126,
                  currency: 'INR'
                }
              }
            }
          ]
        }
      ]
    }
  });

  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].serviceType, 'FEDEX_INTERNATIONAL_PRIORITY');
  assert.equal(quotes[0].currency, 'INR');
  assert.equal(quotes[0].amount, 6126);
  assert.equal(quotes[0].transitTime, 'THREE_DAYS');
});
