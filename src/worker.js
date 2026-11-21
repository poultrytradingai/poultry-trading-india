const FORMS = ['directory', 'importexport', 'localtrade', 'contact'];
const JSON_HDR = { 'Content-Type': 'application/json' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSON_HDR });

async function handleSubmit(request, env) {
  try {
    const origin = request.headers.get('Origin') || '';
    if (origin && !/^https:\/\/(www\.)?poultrytrading\.com$/.test(origin) && !origin.endsWith('.workers.dev')) {
      return json({ ok: false, error: 'bad_origin' }, 403);
    }
    const raw = await request.text();
    if (raw.length > 20000) return json({ ok: false, error: 'too_large' }, 413);
    const body = JSON.parse(raw);
    if (!FORMS.includes(body.form)) return json({ ok: false, error: 'unknown_form' }, 400);

    const ip = request.headers.get('CF-Connecting-IP') || 'na';
    if (body.hp) return json({ ok: true });

    const token = body['cf-turnstile-response'];
    if (!token) return json({ ok: false, error: 'captcha_missing' }, 400);
    const ts = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip })
    });
    const tsRes = await ts.json();
    if (!tsRes.success) return json({ ok: false, error: 'captcha_failed' }, 400);

    delete body['cf-turnstile-response'];
    body.secret = env.APPS_SCRIPT_SECRET;
    body.ip = ip;

    const res = await fetch(env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    });
    const out = await res.json();
    return json(out, out.ok ? 200 : 400);
  } catch (e) {
    return json({ ok: false, error: 'server_error' }, 500);
  }
}

async function handleFeed(request, env, ctx) {
  const action = new URL(request.url).searchParams.get('action') || 'listings';
  if (!['listings', 'leads', 'stats'].includes(action)) return json({ ok: false }, 400);
  const cache = caches.default;
  const cacheKey = new Request('https://poultrytrading.com/__feed/' + action);
  let res = await cache.match(cacheKey);
  if (res) return res;
  const upstream = await fetch(env.APPS_SCRIPT_URL + '?action=' + action, { redirect: 'follow' });
  const text = await upstream.text();
  res = new Response(text, { headers: { ...JSON_HDR, 'Cache-Control': 'public, max-age=300' } });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/submit' && request.method === 'POST') return handleSubmit(request, env);
    if (url.pathname === '/api/feed' && request.method === 'GET') return handleFeed(request, env, ctx);
    return env.ASSETS.fetch(request);
  }
};
