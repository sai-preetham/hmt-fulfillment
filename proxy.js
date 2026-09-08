import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isAuthRequired, isAutomationAuthBypassAllowed, isLocalAuthBypassAllowed } from './lib/auth-guard.js';
import { hasPermission, permissionForPath } from './lib/access-control.js';

export async function proxy(request) {
  const authRequired = isAuthRequired();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!authRequired || isLocalAuthBypassAllowed(request) || isAutomationAuthBypassAllowed(request) || request.nextUrl.pathname.startsWith('/login') || request.nextUrl.pathname.startsWith('/forgot-password') || request.nextUrl.pathname.startsWith('/reset-password')) return NextResponse.next();

  if (!url || !anonKey) {
    if (request.nextUrl.pathname.startsWith('/login')) return NextResponse.next();
    return new NextResponse('Authentication is not configured.', { status: 503 });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  const { data: profile } = await supabase.from('users').select('id,email,role,active,custom_permissions').eq('auth_user_id', user.id).maybeSingle();
  const needed = permissionForPath(request.nextUrl.pathname, request.method);
  if (!profile || !(needed === 'admin' ? profile.active && profile.role === 'admin' : hasPermission(profile, needed))) {
    return new NextResponse('You do not have permission to access this area.', { status: 403 });
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/webhooks).*)']
};
