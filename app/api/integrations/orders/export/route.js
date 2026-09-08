import { NextResponse } from 'next/server';
import { automationUnauthorizedResponse, isAuthorizedAutomationRequest } from '@/lib/crm/automation-auth';
import { runOrderExports } from '@/lib/crm/order-exports';

export async function POST(request) {
  if (!isAuthorizedAutomationRequest(request)) return automationUnauthorizedResponse();
  const body = await request.json().catch(() => ({}));
  const result = await runOrderExports({ trigger: body.trigger || 'manual' });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
