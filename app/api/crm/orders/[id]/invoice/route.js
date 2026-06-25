import { notFound } from 'next/navigation';
import { getOrder } from '@/lib/crm/data';
import { buildInvoicePdf, invoiceFilename } from '@/lib/crm/invoice-pdf';

export async function GET(_request, { params }) {
  const { id } = await params;
  const detail = await getOrder(id);
  if (!detail) notFound();
  const format = new URL(_request.url).searchParams.get('format') || '';

  const body = buildInvoicePdf(detail, { format });
  return new Response(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${invoiceFilename(detail, { format })}"`,
      'Cache-Control': 'no-store'
    }
  });
}
