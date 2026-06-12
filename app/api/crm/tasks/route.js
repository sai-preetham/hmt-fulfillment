import { NextResponse } from 'next/server';
import { listTasks } from '@/lib/crm/data';

export async function GET() {
  return NextResponse.json({ tasks: await listTasks() });
}
