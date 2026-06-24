import { NextResponse } from 'next/server';
import { automationUnauthorizedResponse, isAuthorizedAutomationRequest } from '@/lib/crm/automation-auth';
import { runAutomationCycle } from '@/lib/crm/automation';

export async function POST(request) {
  if (!isAuthorizedAutomationRequest(request)) return automationUnauthorizedResponse();
  const body = await safeJson(request);
  const result = await runAutomationCycle({
    trigger: body.trigger || 'manual',
    force: body.force === true
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
