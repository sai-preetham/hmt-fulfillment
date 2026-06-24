import { automationUnauthorizedResponse, isAuthorizedAutomationRequest } from '@/lib/crm/automation-auth';
import { exportFedexBatchCsv } from '@/lib/crm/automation';

export async function GET(request) {
  if (!isAuthorizedAutomationRequest(request)) return automationUnauthorizedResponse();
  const url = new URL(request.url);
  const batchId = url.searchParams.get('batchId');
  if (!batchId) return Response.json({ ok: false, error: 'batchId is required.' }, { status: 400 });
  const result = await exportFedexBatchCsv(batchId);
  if (!result.ok) return Response.json(result, { status: 404 });
  return new Response(result.csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${result.filename}"`
    }
  });
}
