export const shreeMarutiAdapter = {
  code: 'shree_maruti',
  name: 'Shree Maruti',

  getServices() {
    return [];
  },

  mapOrder() {
    throw new Error('Shree Maruti adapter is not configured. Add API credentials and request schema before booking.');
  },

  async getRates() {
    throw new Error('Shree Maruti rate API is not configured.');
  },

  async createShipment() {
    throw new Error('Shree Maruti booking API is not configured.');
  },

  normalizeStatus(rawStatus) {
    return String(rawStatus || 'unknown').toLowerCase();
  }
};
