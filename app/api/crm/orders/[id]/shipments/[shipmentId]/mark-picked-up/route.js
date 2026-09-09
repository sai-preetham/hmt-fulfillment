import { NextResponse } from 'next/server';
import { markShipmentPickedUp } from '@/lib/crm/data';

export async function POST(_request, { params }) {
  try {
    const { id, shipmentId } = await params;
    const result = await markShipmentPickedUp(id, shipmentId);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Pickup could not be completed. Refresh and retry.' }, { status: 500 });
  }
}
