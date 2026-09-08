import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ status: 'ok', commit: process.env.APP_RELEASE_SHA || 'development' }, {
    headers: { 'Cache-Control': 'no-store' }
  });
}
