import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/current-user';
import { financeOverview } from '@/lib/finance/data';
import { buildCaPack, csv } from '@/lib/finance/exports';

export async function GET(request) {
  await requirePermission('finance.view');
  const type = new URL(request.url).searchParams.get('type') || 'pnl';
  const pack = buildCaPack(await financeOverview());
  if (!pack[type]) return NextResponse.json({ error: 'Unknown export type.' }, { status: 404 });
  return new NextResponse(csv(pack[type]), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="finance-${type}.csv"` } });
}
