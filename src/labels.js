export async function createShipmentLabel(shipment, config) {
  if (!config.delhivery.labelUrl) {
    throw new Error('DELHIVERY_LABEL_URL is not configured for label generation.');
  }
  if (!config.delhivery.token) {
    throw new Error('DELHIVERY_API_TOKEN is required to generate a Delhivery label.');
  }
  if (!shipment?.waybill) {
    throw new Error('AWB is required to generate a label.');
  }

  const url = new URL(config.delhivery.labelUrl);
  url.searchParams.set('waybill', shipment.waybill);

  const response = await fetch(url, {
    headers: {
      Authorization: `Token ${config.delhivery.token}`,
      Accept: 'application/json'
    }
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    throw new Error(`Delhivery label failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  const labelUrl = extractLabelUrl(payload);
  if (!labelUrl) {
    throw new Error(`Delhivery label response did not include a label URL: ${JSON.stringify(payload)}`);
  }

  return {
    label_url: labelUrl,
    label_format: inferFormat(labelUrl, payload),
    label_generated_at: new Date().toISOString(),
    label_error: null,
    raw: payload
  };
}

function extractLabelUrl(payload) {
  return (
    payload?.label_url ||
    payload?.labelUrl ||
    payload?.url ||
    payload?.pdf ||
    payload?.packages?.[0]?.label_url ||
    payload?.packages?.[0]?.labelUrl ||
    ''
  );
}

function inferFormat(labelUrl, payload) {
  if (payload?.format) return String(payload.format).toLowerCase();
  if (String(labelUrl).toLowerCase().includes('.pdf')) return 'pdf';
  return 'url';
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
