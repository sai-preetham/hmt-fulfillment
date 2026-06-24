import { NextResponse } from 'next/server';
import { applyCrmSettingsToConfig } from '@/lib/crm/settings';
import { getCrmSettings } from '@/lib/crm/data';
import { getConfig } from '@/src/config.js';
import { findOrderById, upsertWixOrders } from '@/src/store.js';
import { fetchWixOrder } from '@/src/wix.js';

export async function POST(_request, { params }) {
  const { id } = await params;
  const order = await findOrderById(id);
  if (!order) return NextResponse.json({ ok: false, error: 'Order not found.' }, { status: 404 });
  if (!order.wix_order_id) return NextResponse.json({ ok: false, error: 'No Wix order ID on record.' }, { status: 400 });

  const settings = await getCrmSettings();
  const config = applyCrmSettingsToConfig(getConfig(), settings);
  const fresh = await fetchWixOrder(order.wix_order_id, config);
  const updated = await upsertWixOrders([fresh]);
  return NextResponse.json({
    ok: true,
    pulled: true,
    persisted: updated.length,
    order: await findOrderById(id)
  });
}
