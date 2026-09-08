import { NextResponse } from 'next/server';
import { uploadOrderShippingLabel } from '@/lib/crm/data';

export async function POST(request, { params }) {
  const { id } = await params;
  const formData = await request.formData();
  const result = await uploadOrderShippingLabel(id, formData.get('shipping_label'), String(formData.get('shipment_id') || ''));
  return NextResponse.json(result, { status: result.ok ? 201 : 400 });
}
