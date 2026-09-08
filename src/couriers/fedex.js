import { createFedexShipment, mapWixOrderToFedexShipment, parseFedexShipmentResponse } from '../fedexShip.js';

export const fedexAdapter = {
  code: 'fedex',
  name: 'FedEx',

  getServices() {
    return [{ code: 'international_express', displayName: 'International Express', direction: 'forward', flow: 'international' }];
  },

  mapOrder(order, config, options = {}) {
    return {
      flow: 'international',
      provider: 'fedex',
      ...mapWixOrderToFedexShipment(order, config, options)
    };
  },

  async getRates() {
    throw new Error('FedEx rate API is not configured.');
  },

  async createShipment(payload, config) {
    const response = await createFedexShipment(payload, config);
    const parsed = parseFedexShipmentResponse(response);
    return {
      ...response,
      waybill: parsed.waybill,
      label_url: parsed.labelBase64 ? `data:application/pdf;base64,${parsed.labelBase64}` : '',
      label_format: parsed.labelFormat || 'PDF'
    };
  },

  normalizeStatus(rawStatus) {
    return String(rawStatus || 'unknown').toLowerCase();
  }
};
