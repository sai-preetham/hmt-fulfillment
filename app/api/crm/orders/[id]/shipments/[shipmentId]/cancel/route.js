import { NextResponse } from 'next/server';
import { cancelCourierShipment } from '@/lib/crm/data';

export async function POST(_request, { params }) {
  const { id, shipmentId } = await params;
  const result = await cancelCourierShipment(id, shipmentId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
