// GET-only CORS relay for Canvas LMS.
//
// Canvas sends no Access-Control-Allow-Origin headers, so a page hosted on
// another origin (GitHub Pages, Cloudflare Pages, localhost) cannot read Canvas
// API responses directly. This Worker forwards
// one GET to a Canvas /api/v1/ URL, passes the caller's own Authorization
// header through, and returns the response with CORS headers. It stores
// nothing, logs nothing, and never sees a cookie.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400'
};

function reply(status, body, extraHeaders = {}) {
  const headers = { ...CORS, 'Cache-Control': 'no-store', ...extraHeaders };
  if (body === null) return new Response(null, { status, headers });
  headers['Content-Type'] = 'application/json';
  return new Response(JSON.stringify(body), { status, headers });
}

// Returns a validated https target, or an error message.
export function validateTarget(raw) {
  if (!raw) return { error: 'Missing ?url= parameter.' };
  if (raw.length > 4096) return { error: 'Target URL is too long.' };
  let target;
  try {
    target = new URL(raw);
  } catch {
    return { error: 'Target is not a valid URL.' };
  }
  if (target.protocol !== 'https:') return { error: 'Only https targets are allowed.' };
  if (target.username || target.password) return { error: 'Credentials in the URL are not allowed.' };
  if (target.port && target.port !== '443') return { error: 'Only the standard https port is allowed.' };
  if (!target.pathname.startsWith('/api/v1/')) {
    return { error: 'Only Canvas /api/v1/ paths are allowed.' };
  }
  return { target };
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return reply(204, null);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply(405, { error: 'Only GET requests are allowed.' });
    }

    const incoming = new URL(request.url);
    const { target, error } = validateTarget(incoming.searchParams.get('url'));
    if (error) return reply(400, { error });

    const headers = new Headers({ Accept: 'application/json' });
    // Forward the caller's own Canvas token and nothing else: no cookies, no
    // referrers, nothing that could identify a different session.
    const authorization = request.headers.get('Authorization');
    if (authorization) headers.set('Authorization', authorization);

    let upstream;
    try {
      upstream = await fetch(target.href, { method: 'GET', headers, redirect: 'follow' });
    } catch {
      return reply(502, { error: 'The relay could not reach that address.' });
    }

    const out = new Headers(CORS);
    const contentType = upstream.headers.get('Content-Type');
    if (contentType) out.set('Content-Type', contentType);
    out.set('Cache-Control', 'no-store');
    // Everything else upstream sent (cookies, session ids) stays upstream.
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers: out
    });
  }
};
