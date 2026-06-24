import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({
    accepted: true,
    integration: 'amazon',
    operation: 'fetch-orders',
    stateStorage: 'Supabase orders/customers/order_items/status_history',
    nextStep: 'Connect SP-API credentials and normalize incomplete Amazon address fields for operator correction.'
  }, { status: 202 });
}
