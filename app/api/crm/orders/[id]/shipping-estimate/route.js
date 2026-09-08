import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/server';
import { applyCrmSettingsToConfig } from '@/lib/crm/settings';
import { getConfig } from '@/src/config.js';
import { fetchFedexRateQuote } from '@/src/fedexRates.js';
import { calculateDelhiveryCharge } from '@/src/delhivery.js';

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

  const settings = await loadCrmSettings(supabase);
  const config = applyCrmSettingsToConfig(getConfig(), settings);
  const address = order.shipping_address || {};
  const country = String(address.country || 'IN').trim().toUpperCase();
  const body = await request.json().catch(() => ({}));
  const packageDefaults = {
    weight_grams: positiveNumber(body.weight_grams, 400),
    length_cm: positiveNumber(body.length_cm, 23),
    width_cm: positiveNumber(body.width_cm, 14),
    height_cm: positiveNumber(body.height_cm, 6),
    product_value: positiveNumber(body.product_value, Number(order.total_amount) || 1)
  };

  try {
    if (country && !['IN', 'INDIA'].includes(country)) {
      const result = await fetchFedexRateQuote({
        ...order,
        fedex_payload: {
          weightGrams: packageDefaults.weight_grams,
          lengthCm: packageDefaults.length_cm,
          widthCm: packageDefaults.width_cm,
          heightCm: packageDefaults.height_cm,
          declaredValue: packageDefaults.product_value
        }
      }, config);
      const quote = result.quotes?.[0];
      if (!quote || quote.amount === '') return Response.json({ ok: false, error: 'FedEx returned no rate quote.' }, { status: 404 });
      return Response.json({ ok: true, courier: 'fedex', quote: { amount: quote.amount, currency: quote.currency || 'INR', transit_time: quote.transitTime, service: quote.serviceName } });
    }

    const result = await calculateDelhiveryCharge({
      destinationPincode: address.postal_code,
      weightGrams: packageDefaults.weight_grams,
      mode: 'E',
      status: 'Delivered'
    }, config);
    const amount = delhiveryAmount(result);
    if (amount === null) return Response.json({ ok: false, error: 'Delhivery returned a charge response without a total.' }, { status: 404 });
    return Response.json({ ok: true, courier: 'delhivery', quote: { amount, currency: 'INR', service: 'Express' } });
  } catch (error) {
    return Response.json({ ok: false, error: error.message || 'Rate estimate failed.' }, { status: 400 });
  }
}

async function loadCrmSettings(supabase) {
  const { data, error } = await supabase.from('crm_settings').select('key,value');
  return error ? {} : Object.fromEntries((data || []).map(row => [row.key, row.value]));
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function delhiveryAmount(result) {
  const quote = Array.isArray(result) ? result[0] : result;
  for (const key of ['total_amount', 'total', 'amount', 'charge']) {
    const value = Number(quote?.[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}
