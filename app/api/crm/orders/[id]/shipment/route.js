import { NextResponse } from 'next/server';
import { bookShipment } from '@/lib/crm/data';

export async function POST(request, { params }) {
  const { id } = await params;
  const { payload, nativeForm } = await parsePayload(request);
  const result = await bookShipment(id, payload);
  if (nativeForm) {
    const url = new URL(`/orders/${id}`, request.url);
    url.searchParams.set('shipment', result.ok ? 'booked' : 'failed');
    if (!result.ok) url.searchParams.set('error', result.error || result.validation?.join(', ') || 'Shipment booking failed');
    return NextResponse.redirect(url, { status: 303 });
  }
  return NextResponse.json(result, { status: result.ok ? 201 : 400 });
}

async function parsePayload(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return { payload: await request.json(), nativeForm: false };
  const formData = await request.formData();
  return { payload: Object.fromEntries(formData.entries()), nativeForm: true };
}
