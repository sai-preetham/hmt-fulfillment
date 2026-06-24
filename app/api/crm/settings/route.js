import { NextResponse } from 'next/server';
import { getCrmSettings, saveCrmSettings } from '@/lib/crm/data';

export async function GET() {
  return NextResponse.json({ settings: await getCrmSettings() });
}

export async function POST(request) {
  const payload = await request.json();
  const result = await saveCrmSettings(payload);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
