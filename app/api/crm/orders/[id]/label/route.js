import { NextResponse } from 'next/server';
import { generateShipmentLabel } from '@/lib/crm/data';

export async function POST(_request, { params }) {
  const { id } = await params;
  const result = await generateShipmentLabel(id);
  if (!(_request.headers.get('content-type') || '').includes('application/json')) {
    const url = new URL(`/orders/${id}`, _request.url);
    url.searchParams.set('label', result.ok ? 'generated' : 'failed');
    if (!result.ok) url.searchParams.set('error', result.error || 'Label generation failed');
    return NextResponse.redirect(url, { status: 303 });
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
