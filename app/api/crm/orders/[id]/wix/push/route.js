import { NextResponse } from 'next/server';
import { applyCrmSettingsToConfig } from '@/lib/crm/settings';
import { getCrmSettings } from '@/lib/crm/data-settings';
import { getConfig } from '@/src/config.js';
import { findLatestShipmentForOrder, findOrderById } from '@/src/store.js';
import { markOrderPackedInWix, syncShipmentTrackingToWix } from '@/src/wixShipmentSync.js';

export async function POST(request, { params }) {
  const { id } = await params;
  const body = await safeJson(request);
  const mode = body.mode === 'fulfilled' ? 'fulfilled' : 'tracking';
  const order = await findOrderById(id);
  if (!order) return NextResponse.json({ ok: false, error: 'Order not found.' }, { status: 404 });

  const settings = await getCrmSettings();
  const config = applyCrmSettingsToConfig(getConfig(), settings);

  if (mode === 'fulfilled') {
    const result = await markOrderPackedInWix(id, config);
    if (!result) return NextResponse.json({ ok: false, error: 'Booked shipment with AWB is required.' }, { status: 400 });
    return NextResponse.json({ ok: true, mode, result, order: await findOrderById(id) });
  }

  const shipment = await findLatestShipmentForOrder(order);
  if (!shipment?.waybill) return NextResponse.json({ ok: false, error: 'Booked shipment with AWB is required.' }, { status: 400 });
  const result = await syncShipmentTrackingToWix(order, shipment, config);
  return NextResponse.json({ ok: true, mode, result, order: await findOrderById(id), shipment });
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
