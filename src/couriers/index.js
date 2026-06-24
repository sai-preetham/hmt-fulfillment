import { delhiveryAdapter } from './delhivery.js';
import { shreeMarutiAdapter } from './shreeMaruti.js';
import { shiprocketAdapter } from './shiprocket.js';
import { fedexAdapter } from './fedex.js';

const adapters = new Map([
  [delhiveryAdapter.code, delhiveryAdapter],
  [shiprocketAdapter.code, shiprocketAdapter],
  [shreeMarutiAdapter.code, shreeMarutiAdapter],
  [fedexAdapter.code, fedexAdapter]
]);

export function getCourierAdapter(code = 'delhivery') {
  const adapter = adapters.get(code);
  if (!adapter) throw new Error(`Unsupported courier partner: ${code}`);
  return adapter;
}

export function listCourierServices() {
  return Array.from(adapters.values()).map(adapter => ({
    code: adapter.code,
    name: adapter.name,
    services: adapter.getServices()
  }));
}
