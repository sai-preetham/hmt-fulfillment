import { NextResponse } from 'next/server';
import { syncAbandonedCartLeads } from '@/lib/crm/abandoned-carts';
export async function POST() { const result = await syncAbandonedCartLeads(); return NextResponse.json(result, { status: result.ok ? 200 : 400 }); }
