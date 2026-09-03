import { NextResponse } from 'next/server';
import { raiseDelhiveryPickup } from '@/lib/crm/data';

export async function POST(request, { params }) {
  const { id, shipmentId } = await params;
  const input = await request.json().catch(() => ({}));
  const result = await raiseDelhiveryPickup(id, shipmentId, input);
  return NextResponse.json(result, { status: result.ok ? 201 : 400 });
}
