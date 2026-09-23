import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveTrackingRedirect } from '@/lib/tracking-redirect';

export async function GET(_request, { params }) {
  const { trackingId } = await params;
  const result = await resolveTrackingRedirect(createServiceClient(), trackingId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.redirect(result.url, 307);
}
