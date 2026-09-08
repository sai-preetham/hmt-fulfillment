import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/server';
import { applyCrmSettingsToConfig } from '@/lib/crm/settings';
import { getConfig } from '@/src/config.js';
import { fetchFedexRateQuote } from '@/src/fedexRates.js';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const { id } = await params;
  const supabase = createServiceClient();
  if (!supabase) return Response.json({ ok: false, error: 'Supabase service client is not configured.' }, { status: 503 });

  const { data: order, error } = await supabase
    .from('orders')
    .select('*, customers(*), shipping_address:customer_addresses!orders_shipping_address_id_fkey(*)')
    .eq('id', id)
    .maybeSingle();

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!order) notFound();

  const body = await request.json().catch(() => ({}));
  const settings = await loadCrmSettings(supabase);
  const config = applyCrmSettingsToConfig(getConfig(), settings);

  try {
    const result = await fetchFedexRateQuote(
      {
        ...order,
        fedex_payload: {
          weightGrams: positiveNumber(body.weight_grams),
          lengthCm: positiveNumber(body.length_cm),
          widthCm: positiveNumber(body.width_cm),
          heightCm: positiveNumber(body.height_cm),
          declaredValue: positiveNumber(body.product_value)
        }
      },
      config
    );
    return Response.json({ ok: true, quotes: result.quotes, raw: result.raw });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 400 });
  }
}

async function loadCrmSettings(supabase) {
  const { data, error } = await supabase.from('crm_settings').select('key,value');
  if (error) return {};
  return Object.fromEntries((data || []).map(row => [row.key, row.value]));
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
