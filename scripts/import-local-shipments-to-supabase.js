import { readFile } from 'node:fs/promises';
import { upsertShipment } from '../src/store.js';

const fileUrl = new URL('../data/shipments.json', import.meta.url);
const raw = await readFile(fileUrl, 'utf8');
const shipments = JSON.parse(raw);

let imported = 0;
for (const shipment of shipments) {
  await upsertShipment(shipment);
  imported += 1;
}

console.log(`Imported ${imported} local shipment records into the configured store.`);
