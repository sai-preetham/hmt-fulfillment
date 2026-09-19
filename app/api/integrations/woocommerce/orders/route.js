import { NextResponse } from 'next/server';
import {
  isAuthorizedWooIngestRequest,
  wooIngestMisconfiguredResponse,
  wooIngestUnauthorizedResponse
} from '@/lib/crm/woo-ingest-auth';
import { upsertWooCommerceOrder } from '@/src/store.js';

export async function GET() {
  return NextResponse.json({
    ok: true,
    integration: 'woocommerce',
    endpoint: '/api/integrations/woocommerce/orders',
    auth: 'x-ops-woo-secret or Authorization: Bearer <WOO_OPS_INGEST_SECRET>',
    note: 'POST a WooCommerce order.created / order.updated payload to upsert into Ops CRM. Does not send customer email/WhatsApp.'
  });
}

export async function POST(request) {
  if (!process.env.WOO_OPS_INGEST_SECRET) {
    return wooIngestMisconfiguredResponse();
  }
  if (!isAuthorizedWooIngestRequest(request)) {
    return wooIngestUnauthorizedResponse();
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    const result = await upsertWooCommerceOrder(body);
    if (!result?.order?.id) {
      return NextResponse.json(
        { ok: false, error: 'Upsert failed. Supabase may be unconfigured or returned no order.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      order_id: result.order.id,
      order_number: result.order.order_number || result.order.external_order_id || result.order.woo_order_id,
      woo_order_id: result.order.woo_order_id || result.order.external_order_id,
      created: result.created === true,
      updated: result.updated === true,
      action: result.created ? 'created' : 'updated'
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message || String(error) },
      { status: 400 }
    );
  }
}
