import { NextResponse } from 'next/server';
import { applyCrmSettingsToConfig } from '@/lib/crm/settings';
import { getCrmSettings } from '@/lib/crm/data-settings';
import { getConfig } from '@/src/config.js';
import { findLatestShipmentForOrder, findOrderById, findShipmentById } from '@/src/store.js';
import { fulfillManualShipmentInWix } from '@/src/wixShipmentSync.js';
import { sendPickupConfirmationOnce } from '@/lib/crm/whatsapp-notifications';

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (body.mode !== 'fulfilled') return NextResponse.json({ ok: false, error: 'After pickup, use Mark fulfilled on Wix to send tracking and fulfill the order.' }, { status: 400 });
    const order = await findOrderById(id);
    if (!order?.wix_order_id) return NextResponse.json({ ok: false, error: 'Wix order not found.' }, { status: 404 });
    const shipment = body.shipmentId ? await findShipmentById(body.shipmentId) : await findLatestShipmentForOrder(order);
    if (!shipment || shipment.order_id !== order.id || !shipment.waybill || shipment.direction === 'reverse' || ['cancelled', 'canceled', 'returned', 'rto', 'failed', 'pending', 'pending-zone', 'pending-international'].includes(String(shipment.status).toLowerCase())) {
      return NextResponse.json({ ok: false, error: 'An active outbound shipment with an AWB is required.' }, { status: 400 });
    }
    const config = applyCrmSettingsToConfig(getConfig(), await getCrmSettings());
    if (!config.wix.fulfillmentSyncEnabled) return NextResponse.json({ ok: false, error: 'Enable Wix fulfillment in settings to mark this shipment fulfilled.' }, { status: 400 });
    await fulfillManualShipmentInWix(order, shipment, config);
    const updated = await findOrderById(id);
    if (updated?.wix_fulfillment_status !== 'fulfilled') return NextResponse.json({ ok: false, error: updated?.wix_fulfillment_error || 'Wix fulfillment was not completed. Please retry.' }, { status: 502 });
    let whatsapp = null;
    try {
      whatsapp = await sendPickupConfirmationOnce(updated || order, shipment, { config });
    } catch (error) {
      whatsapp = { status: 'failed', error: error.message };
    }
    return NextResponse.json({ ok: true, message: 'Wix marked fulfilled and tracking sent.', order: updated, whatsapp });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Wix fulfillment failed.' }, { status: 500 });
  }
}
