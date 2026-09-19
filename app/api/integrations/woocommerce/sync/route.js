import { NextResponse } from 'next/server';
import { runWooOrderSync, syncState } from '@/lib/crm/woo-sync';

export async function GET() {
  const state = syncState();
  return NextResponse.json({
    ok: true,
    integration: 'woocommerce',
    endpoint: '/api/integrations/woocommerce/sync',
    enabled: process.env.WOO_ORDER_SYNC_ENABLED === 'true',
    state: {
      running: state.running,
      lastStartedAt: state.lastStartedAt,
      lastFinishedAt: state.lastFinishedAt,
      lastError: state.lastError,
      watermarkModifiedAfter: state.watermarkModifiedAfter,
      lastResult: state.lastResult
        ? {
            ok: state.lastResult.ok,
            skipped: state.lastResult.skipped,
            reason: state.lastResult.reason,
            pages: state.lastResult.pages,
            pulled: state.lastResult.pulled,
            persisted: state.lastResult.persisted,
            created: state.lastResult.created,
            updated: state.lastResult.updated,
            errors: state.lastResult.errors,
            stoppedByMaxPages: state.lastResult.stoppedByMaxPages
          }
        : null
    },
    auth: 'session cookie and/or Authorization: Bearer <AUTOMATION_SECRET>'
  });
}

export async function POST(request) {
  const body = await safeJson(request);
  const result = await runWooOrderSync({
    reason: body.reason || 'manual',
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
