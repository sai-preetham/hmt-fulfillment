import { notFound } from 'next/navigation';
import { getOrder } from '@/lib/crm/data';
import { buildInvoicePdf, invoiceFilename } from '@/lib/crm/invoice-pdf';

export async function GET(_request, { params }) {
  const { id } = await params;
  const detail = await getOrder(id);
  if (!detail) notFound();

  const body = buildInvoicePdf(detail);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${invoiceFilename(detail)}"`,
      'Cache-Control': 'no-store'
    }
  });
}
