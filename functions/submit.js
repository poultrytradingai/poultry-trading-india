// POST /api/submit  -> verifies Turnstile, forwards to Apps Script
const ALLOWED_FORMS = ['directory', 'importexport', 'localtrade', 'contact'];

export async function onRequestPost({ request, env }) {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

  try {
    const origin = request.headers.get('Origin') || '';
    if (origin && !/^https:\/\/(www\.)?poultrytrading\.com$/.test(origin) && !origin.endsWith('.pages.dev')) {
      return json({ ok: false, error: 'bad_origin' }, 403);
    }

    const raw = await request.text();
    if (raw.length > 20000) return json({ ok: false, error: 'too_large' }, 413);
    const body = JSON.parse(raw);

    if (!ALLOWED_FORMS.includes(body.form)) return json({ ok: false, error: 'unknown_form' }, 400);

    const ip = request.headers.get('CF-Connecting-IP') || 'na';

    // Honeypot: pretend success
    if (body.hp) return json({ ok: true });

    // Turnstile check
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
