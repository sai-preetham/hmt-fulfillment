import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(request, { params }) {
  const { courier } = await params;
  const rawBody = await request.clone().text();
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ accepted: true, demo: true, courier });
  }

  let awb = payload.awb || payload.waybill || payload.tracking_number;
  let normalized = payload.normalized_status || payload.status || 'in_transit';
  let eventTime = payload.event_time || new Date().toISOString();
  let location = payload.location || null;
  let message = payload.message || null;

  if (courier === 'fedex') {
    const secret = process.env.FEDEX_WEBHOOK_SECRET;
    if (secret) {
      const signature = request.headers.get('x-fdx-sc-signature') || request.headers.get('X-Fdx-Sc-Signature');
      if (signature) {
        const crypto = await import('node:crypto');
        const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
        if (computed !== signature) {
          return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }
      }
    }

    const data = payload.data || {};
    awb = data.trackingNumber || awb;
    const fedexStatus = data.status || payload.eventName || '';

    const { normalizeFedexStatus } = await import('@/src/fedexTracking.js');
    normalized = normalizeFedexStatus(fedexStatus);
    eventTime = payload.occurredAt || eventTime;

    if (data.location) {
      location = [data.location.city, data.location.state || data.location.stateOrProvinceCode || data.location.countryCode]
        .filter(Boolean)
        .join(', ');
    }
    message = data.statusDescription || payload.eventName || null;
  }

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
    location,
    message,
    event_time: eventTime,
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
