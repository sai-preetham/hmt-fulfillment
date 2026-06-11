export const shiprocketAdapter = {
  code: 'shiprocket',
  name: 'Shiprocket',

  getServices() {
    return [{ code: 'standard', displayName: 'Standard', direction: 'forward', flow: 'domestic' }];
  },

  mapOrder() {
    throw new Error('Shiprocket booking is not configured. Tracking is supported for shipments that already have a Shiprocket AWB.');
  },

  async getRates() {
    throw new Error('Shiprocket rate API is not configured.');
  },

  async createShipment() {
    throw new Error('Shiprocket booking is not configured.');
  },

  normalizeStatus(rawStatus) {
    return String(rawStatus || 'unknown').toLowerCase();
  }
};
