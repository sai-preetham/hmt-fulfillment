export const fedexAdapter = {
  code: 'fedex',
  name: 'FedEx',

  getServices() {
    return [{ code: 'international_express', displayName: 'International Express', direction: 'forward', flow: 'international' }];
  },

  mapOrder() {
    throw new Error('FedEx API booking is not configured. Use the FedEx CSV Export option to book shipments.');
  },

  async getRates() {
    throw new Error('FedEx rate API is not configured.');
  },

  async createShipment() {
    throw new Error('FedEx API booking is not configured.');
  },

  normalizeStatus(rawStatus) {
    return String(rawStatus || 'unknown').toLowerCase();
  }
};
