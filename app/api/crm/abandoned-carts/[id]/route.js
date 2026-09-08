import { NextResponse } from 'next/server';
import { getAbandonedCartLead, updateAbandonedCartLead } from '@/lib/crm/abandoned-carts';

export async function GET(_request, { params }) {
  const { id } = await params;
  const lead = await getAbandonedCartLead(id);
  return lead
    ? NextResponse.json({ ok: true, lead })
    : NextResponse.json({ ok: false, error: 'Lead not found.' }, { status: 404 });
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  const result = await updateAbandonedCartLead(id, await request.json());
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
