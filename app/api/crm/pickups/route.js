import { NextResponse } from 'next/server';
import { createDelhiveryLocationPickupRequest } from '@/lib/crm/data';

export async function POST(request) {
  const input = await request.json().catch(() => ({}));
  const result = await createDelhiveryLocationPickupRequest(input);
  return NextResponse.json(result, { status: result.ok ? 201 : 400 });
}
