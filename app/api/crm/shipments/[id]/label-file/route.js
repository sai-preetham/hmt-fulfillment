import { NextResponse } from 'next/server';
import { downloadShipmentLabelFile } from '@/lib/crm/data';

export async function GET(_request, { params }) {
  const { id } = await params;
  const result = await downloadShipmentLabelFile(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'Label download failed.' }, { status: 400 });
  }

  return new NextResponse(result.body, {
    status: 200,
    headers: {
      'content-type': result.contentType,
      'content-disposition': `inline; filename="${result.filename}"`
    }
  });
}
