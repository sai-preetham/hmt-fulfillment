import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/current-user';
import { getIssue, updateIssue } from '@/lib/crm/issues';

export async function GET(_request, { params }) {
  await requirePermission('issues.view');
  const { id } = await params;
  const issue = await getIssue(id);
  return issue ? NextResponse.json({ ok: true, issue }) : NextResponse.json({ ok: false, error: 'Issue not found.' }, { status: 404 });
}

export async function PATCH(request, { params }) {
  const actor = await requirePermission('issues.edit');
  const { id } = await params;
  const result = await updateIssue(id, await request.json().catch(() => ({})), actor);
  return NextResponse.json(result, { status: result.ok ? 200 : result.status || 400 });
}
