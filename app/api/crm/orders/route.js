import { NextResponse } from 'next/server';
import { createManualOrder, listOrders } from '@/lib/crm/data';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const orders = await listOrders({
    query: searchParams.get('q') || '',
    status: searchParams.get('status') || '',
    source: searchParams.get('source') || '',
    limit: Number(searchParams.get('limit') || 100)
  });
  return NextResponse.json({ orders });
}

export async function POST(request) {
  const payload = await request.json();
  const result = await createManualOrder(payload);
  return NextResponse.json(result, { status: result.ok ? 201 : 409 });
}
