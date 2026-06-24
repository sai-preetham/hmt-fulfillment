import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(request, { params }) {
  const { courier } = await params;
  const payload = await request.json();
  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ accepted: true, demo: true, courier });
  }

  const awb = payload.awb || payload.waybill || payload.tracking_number;
  const normalized = payload.normalized_status || payload.status || 'in_transit';
  const { data: shipment } = await supabase.from('shipments').select('id,order_id').eq('waybill', awb).maybeSingle();
  if (!shipment) {
    await supabase.from('integration_errors').insert({
      integration: courier,
      operation: 'courier-webhook',
      status: 'open',
      message: `Webhook received for unknown AWB ${awb || 'missing'}`,
      payload
    });
    return NextResponse.json({ accepted: true, matched: false });
  }

  await supabase.from('courier_events').insert({
    shipment_id: shipment.id,
    courier,
    awb_number: awb,
    status: normalized,
    event_time: payload.event_time || new Date().toISOString(),
    payload
  });
  await supabase.from('shipments').update({ status: normalized, updated_at: new Date().toISOString() }).eq('id', shipment.id);
  await supabase.from('orders').update({
    shipment_status: normalized,
    internal_status: normalized === 'delivered' ? 'installation_pending' : normalized,
    updated_at: new Date().toISOString()
  }).eq('id', shipment.order_id);

  return NextResponse.json({ accepted: true, matched: true });
}
