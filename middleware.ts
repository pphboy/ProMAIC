import { NextRequest, NextResponse } from 'next/server';
import { isLocalPlaybackConfigured } from '@/lib/config/feature-flags';
import { localPlayerApiAllowed, localPlayerOriginAllowed } from '@/lib/config/local-player-routes';

import { isAgentRuntimeConfigured, isProWorkbenchEnabled } from '@/lib/config/feature-flags';
import { verifyAccessTokenEdge } from '@/lib/server/access-token-edge';
import {
  anonymousOwnerForNavigation,
  type NavigationIdentity,
} from '@/lib/server/identity/navigation';

/**
 * Let the request through, carrying the anonymous owner a page request
 * establishes: the cookie is set on the page response, and the forwarded
 * request carries it too, so the page and every request it sends resolve one
 * owner (see `lib/server/identity/navigation.ts`).
 */
function next(request: NextRequest, identity: NavigationIdentity | undefined): NextResponse {
  const headers = new Headers(request.headers);
  if (identity) headers.set('cookie', identity.requestCookie);
  const response = NextResponse.next({ request: { headers } });
  if (identity) response.headers.append('set-cookie', identity.setCookie);
  if (isLocalPlaybackConfigured()) {
    response.headers.set(
      'Content-Security-Policy',
      "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'self' 'unsafe-inline' data:; font-src 'self' data: blob:; connect-src 'self' blob: data:; img-src 'self' data: blob:; media-src 'self' data: blob:; frame-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
    );
  }
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isLocalPlaybackConfigured()) {
    if (pathname.startsWith('/api/') && !localPlayerOriginAllowed(request)) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_ORIGIN',
            message: 'Local player accepts same-origin requests only',
          },
        },
        { status: 403 },
      );
    }
    if (pathname.startsWith('/api/') && !localPlayerApiAllowed(pathname)) {
      return NextResponse.json(
        {
          error: {
            code: 'CAPABILITY_UNAVAILABLE',
            message: 'This feature is unavailable in the local player',
          },
        },
        { status: 501 },
      );
    }
    if (
      ['/workbench', '/workspace', '/generation-preview'].some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
      )
    ) {
      return new NextResponse('Not found', { status: 404 });
    }
  }

  // Return an actual server-side 404 when either half of the workbench is off.
  // Edge middleware cannot reliably inspect server-only deployment variables,
  // so it enforces the public gate and leaves the complete runtime/database
  // check to Node. A Node-hosted middleware uses the same gate as startup.
  const canInspectServerRuntime = process.env.NEXT_RUNTIME !== 'edge';
  const workbenchEnabled =
    isProWorkbenchEnabled() && (!canInspectServerRuntime || isAgentRuntimeConfigured());
  if (!workbenchEnabled && (pathname === '/workbench' || pathname.startsWith('/workbench/'))) {
    return new NextResponse('Not found', { status: 404 });
  }

  // One anonymous owner per browser, established on the page response before
  // any API request can mint its own.
  const identity = anonymousOwnerForNavigation({
    method: request.method,
    headers: request.headers,
    pathname,
  });

  const accessCode = process.env.ACCESS_CODE;
  if (!accessCode) {
    return next(request, identity);
  }

  // Whitelist: access-code endpoints, health check
  if (pathname.startsWith('/api/access-code/') || pathname === '/api/health') {
    return next(request, identity);
  }

  // Check cookie — validate HMAC signature, not just existence
  const cookie = request.cookies.get('openmaic_access');
  if (cookie?.value && (await verifyAccessTokenEdge(cookie.value, accessCode))) {
    return next(request, identity);
  }

  // API requests without valid cookie → 401
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { success: false, errorCode: 'INVALID_REQUEST', error: 'Access code required' },
      { status: 401 },
    );
  }

  // Page requests → let through, frontend shows modal
  return next(request, identity);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/).*)'],
};
