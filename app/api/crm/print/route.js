import { NextResponse } from 'next/server';
import { printLabelPdf } from '@/lib/crm/label-printer';

export const runtime = 'nodejs';

const MAX_PDF_BYTES = 20 * 1024 * 1024;

export async function POST(request) {
  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: 'Choose a PDF to print.' }, { status: 400 });
  if (file.size === 0 || file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ ok: false, error: 'PDF files must be between 1 byte and 20 MB.' }, { status: 400 });
  }

  const body = Buffer.from(await file.arrayBuffer());
  if (!body.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    return NextResponse.json({ ok: false, error: 'Only valid PDF files can be sent to the label printer.' }, { status: 400 });
  }

  const result = await printLabelPdf(body, file.name || 'uploaded-label.pdf');
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
