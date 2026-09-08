import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/server';
import { applyCrmSettingsToConfig } from '@/lib/crm/settings';
import { getConfig } from '@/src/config.js';
import { buildFedexBatchUploadWorkbook, fedexBatchUploadFilename } from '@/src/internationalExport.js';

export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  const { id } = await params;
  const searchParams = new URL(_request.url).searchParams;
  const supabase = createServiceClient();
  if (!supabase) return Response.json({ ok: false, error: 'Supabase service client is not configured.' }, { status: 503 });

  const { data: order, error } = await supabase
    .from('orders')
    .select('*, customers(*), shipping_address:customer_addresses!orders_shipping_address_id_fkey(*)')
    .eq('id', id)
    .maybeSingle();

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!order) notFound();

  const settings = await loadCrmSettings(supabase);
  const config = applyCrmSettingsToConfig(getConfig(), settings);
  const workbook = buildFedexBatchUploadWorkbook([{ ...order, fedex_payload: fedexPayloadOverrides(searchParams) }], config);
  const filename = fedexBatchUploadFilename(`fedex-order-${order.order_number || order.external_order_id || id}-${timestampForFilename()}`);

  return new Response(workbook, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store'
    }
  });
}

function timestampForFilename() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '').replace('T', '-').replace('Z', '');
}

function fedexPayloadOverrides(searchParams) {
  return {
    weightGrams: numberParam(searchParams, 'weight_grams'),
    lengthCm: numberParam(searchParams, 'length_cm'),
    widthCm: numberParam(searchParams, 'width_cm'),
    heightCm: numberParam(searchParams, 'height_cm'),
    declaredValue: numberParam(searchParams, 'product_value')
  };
}

function numberParam(searchParams, key) {
  const value = Number(searchParams.get(key));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

async function loadCrmSettings(supabase) {
  const { data, error } = await supabase.from('crm_settings').select('key,value');
  if (error) return {};
  return Object.fromEntries((data || []).map(row => [row.key, row.value]));
}
