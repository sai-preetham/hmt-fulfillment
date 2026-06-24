import { NextResponse } from 'next/server';
import { getOrder, updateOrder } from '@/lib/crm/data';

export async function GET(_request, { params }) {
  const { id } = await params;
  const detail = await getOrder(id);
  return NextResponse.json(detail);
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  const payload = await request.json();
  const result = await updateOrder(id, payload);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
