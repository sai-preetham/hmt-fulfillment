import {
  calculateDelhiveryCharge,
  calculateInternationalCharge,
  createDelhiveryOrder,
  mapWixOrderToDelhivery
} from '../delhivery.js';

export const delhiveryAdapter = {
  code: 'delhivery',
  name: 'Delhivery',

  getServices() {
    return [
      { code: 'express', displayName: 'Express', direction: 'forward', flow: 'domestic' },
      { code: 'surface', displayName: 'Surface', direction: 'forward', flow: 'domestic' },
      { code: 'reverse_pickup', displayName: 'Reverse Pickup', direction: 'reverse', flow: 'domestic' },
      { code: 'dlv_saver', displayName: 'DLV Saver', direction: 'forward', flow: 'international' },
      { code: 'deferred_express', displayName: 'Deferred Express', direction: 'forward', flow: 'international' }
    ];
  },

  mapOrder(order, config, options) {
    return mapWixOrderToDelhivery(order, config, options);
  },

  async getRates(params, config) {
    if (params.flow === 'international') return calculateInternationalCharge(params, config);
    return calculateDelhiveryCharge(params, config);
  },

  async createShipment(payload, config) {
    return createDelhiveryOrder(payload, config);
  },

  normalizeStatus(rawStatus) {
    const normalized = String(rawStatus || '').toLowerCase();
    if (normalized.includes('success') || normalized.includes('delivered')) return 'booked';
    if (normalized.includes('fail') || normalized.includes('error')) return 'failed';
    return normalized || 'unknown';
  }
};
