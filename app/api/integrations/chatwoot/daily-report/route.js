import { NextResponse } from 'next/server';
import { automationUnauthorizedResponse, isAuthorizedAutomationRequest } from '@/lib/crm/automation-auth';
import { postDiscordChatwootDailyTracker } from '@/lib/crm/chatwoot';
import { previousCalendarDayBounds } from '@/lib/crm/order-exports';

export async function POST(request) {
  if (!isAuthorizedAutomationRequest(request)) return automationUnauthorizedResponse();
  try {
    const result = await postDiscordChatwootDailyTracker(previousCalendarDayBounds());
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Chatwoot daily report failed.' }, { status: 500 });
  }
}
