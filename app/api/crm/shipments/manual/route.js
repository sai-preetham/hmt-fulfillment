import { NextResponse } from 'next/server';
import { bookShipment, createManualOrder, uploadManualShipmentLabel } from '@/lib/crm/data';

export async function POST(request) {
  const formData = await request.formData();
  const payload = Object.fromEntries(formData.entries());
  const labelFile = formData.get('label_file');
  const order = await createManualOrder({ ...payload, source: 'manual', external_order_id: payload.order_number, payment_status: 'PAID', quantity: 1 });
  if (!order.ok) return NextResponse.json(order, { status: 409 });
  if (order.demo) return NextResponse.json({ ok: true, demo: true });
  const shipment = await bookShipment(order.id, { ...payload, booking_action: 'save_manual_awb', country: payload.country || 'IN', pickup_location: payload.pickup_location || 'Manual shipment' });
  if (shipment.ok && labelFile?.size) {
    const uploaded = await uploadManualShipmentLabel(shipment.shipment.id, labelFile);
    if (!uploaded.ok) return NextResponse.json(uploaded, { status: 400 });
    shipment.label_url = uploaded.label_url;
  }
  return NextResponse.json(shipment, { status: shipment.ok ? 201 : 400 });
}
