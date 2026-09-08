import { NextResponse } from 'next/server';
import { markShipmentPickedUp } from '@/lib/crm/data';

export async function POST(_request, { params }) {
  const { id, shipmentId } = await params;
  const result = await markShipmentPickedUp(id, shipmentId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
