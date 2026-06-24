import { NextResponse } from 'next/server';
import { automationUnauthorizedResponse, isAuthorizedAutomationRequest } from '@/lib/crm/automation-auth';
import { getAutomationDashboardData } from '@/lib/crm/automation';

export async function GET(request) {
  if (!isAuthorizedAutomationRequest(request)) return automationUnauthorizedResponse();
  const data = await getAutomationDashboardData();
  return NextResponse.json(data, { status: data.ok ? 200 : 500 });
}
