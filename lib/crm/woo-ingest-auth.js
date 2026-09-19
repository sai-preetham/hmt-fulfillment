export function isAuthorizedWooIngestRequest(request, env = process.env) {
  const secret = env.WOO_OPS_INGEST_SECRET || '';
  if (!secret) return false;
  const headerSecret = request.headers.get('x-ops-woo-secret') || '';
  if (headerSecret && headerSecret === secret) return true;
  const authorization = request.headers.get('authorization') || '';
  return authorization === `Bearer ${secret}`;
}

export function wooIngestUnauthorizedResponse() {
  return Response.json(
    { ok: false, error: 'Unauthorized WooCommerce ingest request. Provide x-ops-woo-secret or Bearer WOO_OPS_INGEST_SECRET.' },
    { status: 401 }
  );
}

export function wooIngestMisconfiguredResponse() {
  return Response.json(
    { ok: false, error: 'WOO_OPS_INGEST_SECRET is not configured on Ops.' },
    { status: 503 }
  );
}
