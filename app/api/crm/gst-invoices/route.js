import { NextResponse } from 'next/server';
import { gstInvoiceCsv, listGstInvoiceRows } from '@/lib/crm/gst-invoice-export';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');
  const today = new Date().toISOString().slice(0, 10);
  const startDate = searchParams.get('start') || `${today.slice(0, 7)}-01`;
  const endDate = searchParams.get('end') || today;
  try {
    const rows = await listGstInvoiceRows(month || { startDate, endDate });
    if (searchParams.get('format') === 'json') return NextResponse.json({ startDate, endDate, rows });
    return new NextResponse(gstInvoiceCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sales-gst-${month || `${startDate}-to-${endDate}`}.csv"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not create the sales and GST CSV.' }, { status: 400 });
  }
}
