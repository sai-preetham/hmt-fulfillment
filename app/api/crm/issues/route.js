import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/current-user';
import { createIssue, listIssues } from '@/lib/crm/issues';

export async function GET(request) {
  await requirePermission('issues.view');
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  return NextResponse.json({ ok: true, issues: await listIssues(params) });
}

export async function POST(request) {
  const actor = await requirePermission('issues.edit');
  const result = await createIssue(await request.json().catch(() => ({})), actor);
  return NextResponse.json(result, { status: result.ok ? 201 : result.status || 400 });
}
