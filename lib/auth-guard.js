export function isAuthRequired(env = process.env) {
  if (env.AUTH_REQUIRED === 'true') return true;
  if (env.AUTH_REQUIRED === 'false' && env.NODE_ENV !== 'production') return false;
  return env.NODE_ENV === 'production';
}

export function isLocalAuthBypassAllowed(request, env = process.env) {
  if (env.NODE_ENV === 'production') return false;
  return ['localhost', '127.0.0.1', '::1'].includes(request.nextUrl.hostname);
}

export function isPublicRoute(request) {
  const pathname = request.nextUrl?.pathname || '';
  return pathname === '/bulk' || pathname === '/bulk/';
}

export function isAutomationAuthBypassAllowed(request, env = process.env) {
  const pathname = request.nextUrl?.pathname || '';
  const secret = env.AUTOMATION_SECRET || '';
  if (!secret) return false;
  if (!pathname.startsWith('/api/automation') && pathname !== '/api/tracking/sync' && pathname !== '/api/integrations/orders/export' && pathname !== '/api/integrations/chatwoot/daily-report' && pathname !== '/api/integrations/woocommerce/sync') return false;
  return request.headers?.get?.('authorization') === `Bearer ${secret}`;
}

export function isWooIngestAuthBypassAllowed(request, env = process.env) {
  const pathname = request.nextUrl?.pathname || '';
  if (!pathname.startsWith('/api/integrations/woocommerce/')) return false;
  const secret = env.WOO_OPS_INGEST_SECRET || '';
  if (!secret) return false;
  const headerSecret = request.headers?.get?.('x-ops-woo-secret') || '';
  if (headerSecret && headerSecret === secret) return true;
  const authorization = request.headers?.get?.('authorization') || '';
  return authorization === `Bearer ${secret}`;
}
