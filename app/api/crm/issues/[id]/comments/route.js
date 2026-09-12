import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/current-user';
import { addIssueComment } from '@/lib/crm/issues';

export async function POST(request, { params }) {
  const actor = await requirePermission('issues.edit');
  const { id } = await params;
  const input = await request.json().catch(() => ({}));
  const result = await addIssueComment(id, input.body, actor);
  return NextResponse.json(result, { status: result.ok ? 201 : result.status || 400 });
}
