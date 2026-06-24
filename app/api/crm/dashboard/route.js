import { NextResponse } from 'next/server';
import { getDashboardSummary } from '@/lib/crm/data';

export async function GET() {
  return NextResponse.json({ summary: await getDashboardSummary() });
}
