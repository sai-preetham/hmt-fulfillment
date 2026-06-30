export function isAuthRequired(env = process.env) {
  if (env.AUTH_REQUIRED === 'true') return true;
  if (env.AUTH_REQUIRED === 'false' && env.NODE_ENV !== 'production') return false;
  return env.NODE_ENV === 'production';
}

export function isLocalAuthBypassAllowed(request, env = process.env) {
  if (env.NODE_ENV === 'production') return false;
  return ['localhost', '127.0.0.1', '::1'].includes(request.nextUrl.hostname);
}
