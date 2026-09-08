import { NextResponse } from 'next/server';
import { downloadShipmentLabelFile } from '@/lib/crm/data';
import { printLabelPdf } from '@/lib/crm/label-printer';

export const runtime = 'nodejs';

export async function POST(_request, { params }) {
  const { id } = await params;
  const label = await downloadShipmentLabelFile(id);
  if (!label.ok) return NextResponse.json({ ok: false, error: label.error || 'Label download failed.' }, { status: 400 });

  const result = await printLabelPdf(label.body, label.filename);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
