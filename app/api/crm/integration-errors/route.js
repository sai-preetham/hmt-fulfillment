import { NextResponse } from 'next/server';
import { listIntegrationErrors } from '@/lib/crm/data';

export async function GET() {
  return NextResponse.json({ errors: await listIntegrationErrors() });
}
