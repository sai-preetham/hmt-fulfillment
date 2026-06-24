import { NextResponse } from 'next/server';
import { runWixOrderSync, syncState } from '@/lib/crm/wix-sync';

export async function GET() {
  return NextResponse.json({ ok: true, integration: 'wix', state: syncState() });
}

export async function POST(request) {
  const body = await safeJson(request);
  const result = await runWixOrderSync({
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
