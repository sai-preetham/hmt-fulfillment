import { NextResponse } from 'next/server';
import { gstInvoiceCsv, listGstInvoiceRows } from '@/lib/crm/gst-invoice-export';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);
  try {
    const rows = await listGstInvoiceRows(month);
    if (searchParams.get('format') === 'json') return NextResponse.json({ month, rows });
    return new NextResponse(gstInvoiceCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="gst-invoices-${month}.csv"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not create the GST invoice CSV.' }, { status: 400 });
  }
}
