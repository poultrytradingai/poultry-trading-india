const FORMS = ['directory', 'importexport', 'localtrade', 'contact'];
const JSON_HDR = { 'Content-Type': 'application/json' };
const SITE = 'https://poultrytrading.com';
const GTM = 'GTM-5F4P8CHG';
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSON_HDR });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- form submit ---------- */
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

/* ---------- cached public feed ---------- */
async function getFeedText(env, ctx, action) {
  const cache = caches.default;
  const key = new Request(SITE + '/__feed/' + action);
  let res = await cache.match(key);
  if (res) return res.text();
  const upstream = await fetch(env.APPS_SCRIPT_URL + '?action=' + action, { redirect: 'follow' });
  const text = await upstream.text();
  res = new Response(text, { headers: { ...JSON_HDR, 'Cache-Control': 'public, max-age=300' } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return text;
}

async function handleFeed(request, env, ctx) {
  const action = new URL(request.url).searchParams.get('action') || 'listings';
  if (!['listings', 'leads', 'stats'].includes(action)) return json({ ok: false }, 400);
  const text = await getFeedText(env, ctx, action);
  return new Response(text, { headers: { ...JSON_HDR, 'Cache-Control': 'public, max-age=300' } });
}

/* ---------- listing detail page: /directory/<slug> ---------- */
const NAV = '<nav><div class="nav-inner"><a class="brand" href="/">PoultryTrading<span>Poultry industry platform</span></a><div class="links"><a href="/directory/">Directory</a><a href="/leads/">Enquiries</a><a href="/list-your-business/">List free</a><a href="/contact/">Contact</a></div></div></nav>';
const FOOT = '<footer>&copy; PoultryTrading.com &middot; <a href="/">Home</a> &middot; <a href="/directory/">Directory</a> &middot; <a href="/leads/">Enquiries</a> &middot; <a href="/contact/">Contact</a> &middot; <a href="/privacy/">Privacy</a> &middot; <a href="/terms/">Terms</a></footer>';

function shell({ title, desc, canonical, robots, body, ld }) {
  return `<!DOCTYPE html><html lang="en"><head>
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM}');</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta name="robots" content="${robots}">
<link rel="canonical" href="${esc(canonical)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canonical)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;800&family=Noto+Sans:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/forms.css"><link rel="stylesheet" href="/assets/browse.css">${ld ? '<script type="application/ld+json">' + ld + '</script>' : ''}
</head><body><noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
${NAV}<main class="wrap">${body}</main>${FOOT}</body></html>`;
}

async function handleListing(slug, env, ctx) {
  let listing = null;
  try {
    const data = JSON.parse(await getFeedText(env, ctx, 'listings'));
    listing = (data.listings || []).find((l) => l.slug === slug);
  } catch (e) {}

  if (!listing) {
    const html = shell({
      title: 'Listing not found | PoultryTrading', desc: 'This listing was not found.',
      canonical: SITE + '/directory/', robots: 'noindex, follow',
      body: '<h1>Listing not found</h1><p class="intro">This business is not in the directory (or was removed).</p><a class="cta" href="/directory/">Browse the directory</a>'
    });
    return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const canonical = SITE + '/directory/' + listing.slug;
  const title = `${listing.name} – ${listing.subCategory} in ${listing.country} | PoultryTrading`;
  const desc = `${listing.name} is listed in the PoultryTrading directory: ${listing.category} (${listing.subCategory}) in ${listing.country}.`;
  const badge = listing.verified ? '<span class="bdg b-ver">Verified</span>' : '<span class="bdg b-unv">Unverified</span>';
  const ld = listing.verified ? JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Organization',
    name: listing.name, url: canonical, address: { '@type': 'PostalAddress', addressCountry: listing.country }
  }).replace(/</g, '\\u003c') : '';

  const body = `<p class="meta"><a href="/directory/">Directory</a> &rsaquo; ${esc(listing.category)}</p>
<h1>${esc(listing.name)} ${badge}</h1>
<p class="meta">${esc(listing.category)} &rsaquo; ${esc(listing.subCategory)} &middot; ${esc(listing.country)}</p>
<div class="lockbox" data-unlock-box><h2>Contact details</h2>
<p>Contact details are shown to verified members only. Sign in free with Google to view.</p>
<button class="unlock" data-unlock="listing" data-id="${esc(listing.id)}" style="max-width:260px">Unlock contact</button></div>
<p class="note">Is this your business? <a href="/list-your-business/">Add or update your listing free</a>.</p>
<script src="/assets/member.js"></script>`;

  const html = shell({ title, desc, canonical, robots: listing.verified ? 'index, follow' : 'noindex, follow', body, ld });
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}

/* ---------- sitemap (static pages + approved listings) ---------- */
async function handleSitemap(env, ctx) {
  const pages = ['/', '/directory/', '/leads/', '/list-your-business/', '/enquiry/import-export/', '/enquiry/local-trade/', '/contact/', '/privacy/', '/terms/'];
  let urls = pages.map((p) => `<url><loc>${SITE}${p}</loc></url>`);
  try {
    const data = JSON.parse(await getFeedText(env, ctx, 'listings'));
    (data.listings || []).filter((l) => l.verified && /^[a-z0-9-]+$/.test(l.slug)).forEach((l) => {
      urls.push(`<url><loc>${SITE}/directory/${l.slug}</loc><lastmod>${String(l.date).slice(0, 10)}</lastmod></url>`);
    });
  } catch (e) {}
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' } });
}


/* ---------- members: Google sign-in, session, unlocks ---------- */
const TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo?id_token=';
const DISPOSABLE = new Set(['mailinator.com','guerrillamail.com','guerrillamail.net','guerrillamail.org','grr.la','10minutemail.com','tempmail.com','temp-mail.org','tempail.com','tempr.email','yopmail.com','trashmail.com','getnada.com','sharklasers.com','throwawaymail.com','maildrop.cc','dispostable.com','fakeinbox.com','mintemail.com','mohmal.com','emailondeck.com','moakt.com','burnermail.io','spamgourmet.com','mailnesia.com','discard.email','mailcatcher.me','tmail.ws','emailfake.com','fakemail.net','inboxkitten.com','33mail.com','mailtemp.net','tempinbox.com','trbvm.com','dropmail.me','mytemp.email']);
const enc = new TextEncoder();
const okOrigin = (request) => {
  const o = request.headers.get('Origin') || '';
  return !o || /^https:\/\/(www\.)?poultrytrading\.com$/.test(o) || o.endsWith('.workers.dev');
};
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
const safeEq = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const today = () => new Date().toISOString().slice(0, 10);

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
async function makeSession(env, sub) {
  const payload = b64u(enc.encode(JSON.stringify({ sub, exp: Date.now() + 30 * 864e5 })));
  return payload + '.' + (await hmac(env.SESSION_SECRET, payload));
}
async function getSession(request, env) {
  try {
    const m = (request.headers.get('Cookie') || '').match(/(?:^|; )pt_session=([^;]*)/);
    if (!m || !env.SESSION_SECRET) return null;
    const [payload, sig] = m[1].split('.');
    if (!payload || !sig || !safeEq(sig, await hmac(env.SESSION_SECRET, payload))) return null;
    const data = JSON.parse(unb64u(payload));
    return data.exp > Date.now() ? String(data.sub) : null;
  } catch (e) { return null; }
}
const cookie = (value, maxAge) => `pt_session=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

// Trust levels: email only 1/day, verified WhatsApp 5/day, verified WhatsApp + approved listing 10/day
const limitFor = (m) => (m.whatsapp_verified ? (m.has_listing ? 10 : 5) : 1);
async function countToday(env, sub, day) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS c FROM unlocks WHERE member_id=? AND day=?').bind(sub, day).first();
  return r ? r.c : 0;
}
async function gas(env, payload) {
  const res = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...payload, secret: env.APPS_SCRIPT_SECRET }), redirect: 'follow'
  });
  return res.json();
}
async function summary(env, m) {
  const limit = limitFor(m);
  const used = await countToday(env, m.id, today());
  return {
    email: m.email, name: m.name, whatsapp: m.whatsapp || '', whatsappVerified: !!m.whatsapp_verified,
    hasListing: !!m.has_listing, limit, remaining: Math.max(0, limit - used)
  };
}

async function handleGoogleAuth(request, env) {
  if (!okOrigin(request)) return json({ ok: false, error: 'bad_origin' }, 403);
  try {
    const body = await request.json();
    const cred = String(body.credential || '');
    if (!cred || cred.length > 4000) return json({ ok: false, error: 'bad_request' }, 400);
    const r = await fetch(TOKENINFO + encodeURIComponent(cred));
    if (!r.ok) return json({ ok: false, error: 'auth_failed' }, 401);
    const info = await r.json();
    const goodIss = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
    if (info.aud !== env.GOOGLE_CLIENT_ID || !goodIss || String(info.email_verified) !== 'true' || Number(info.exp) * 1000 < Date.now()) {
      return json({ ok: false, error: 'auth_failed' }, 401);
    }
    const email = String(info.email || '').toLowerCase();
    if (DISPOSABLE.has(email.split('@')[1])) return json({ ok: false, error: 'disposable_email' }, 400);
    const now = new Date().toISOString();
    await env.DB.prepare(
      'INSERT INTO members(id,email,name,created_at,last_login) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, last_login=excluded.last_login'
    ).bind(String(info.sub), email, String(info.name || ''), now, now).run();
    const m = await env.DB.prepare('SELECT * FROM members WHERE id=?').bind(String(info.sub)).first();
    if (m.banned) return json({ ok: false, error: 'banned' }, 403);
    const token = await makeSession(env, m.id);
    return new Response(JSON.stringify({ ok: true, member: await summary(env, m) }), {
      headers: { ...JSON_HDR, 'Set-Cookie': cookie(token, 30 * 86400) }
    });
  } catch (e) { return json({ ok: false, error: 'server_error' }, 500); }
}

async function handleMe(request, env) {
  const sub = await getSession(request, env);
  const none = new Response(JSON.stringify({ ok: true, signedIn: false }), { headers: { ...JSON_HDR, 'Cache-Control': 'no-store' } });
  if (!sub) return none;
  const m = await env.DB.prepare('SELECT * FROM members WHERE id=?').bind(sub).first();
  if (!m || m.banned) return none;
  return new Response(JSON.stringify({ ok: true, signedIn: true, member: await summary(env, m) }), { headers: { ...JSON_HDR, 'Cache-Control': 'no-store' } });
}

function handleLogout() {
  return new Response('{"ok":true}', { headers: { ...JSON_HDR, 'Set-Cookie': cookie('', 0) } });
}

async function handleProfile(request, env) {
  if (!okOrigin(request)) return json({ ok: false, error: 'bad_origin' }, 403);
  const sub = await getSession(request, env);
  if (!sub) return json({ ok: false, error: 'auth' }, 401);
  try {
    const body = await request.json();
    const num = String(body.whatsapp || '').replace(/[\s()-]/g, '');
    if (!/^\+?[0-9]{7,15}$/.test(num)) return json({ ok: false, error: 'bad_number' }, 400);
    const m = await env.DB.prepare('SELECT whatsapp FROM members WHERE id=?').bind(sub).first();
    if (!m) return json({ ok: false, error: 'auth' }, 401);
    if (m.whatsapp !== num) await env.DB.prepare('UPDATE members SET whatsapp=?, whatsapp_verified=0 WHERE id=?').bind(num, sub).run();
    return json({ ok: true });
  } catch (e) { return json({ ok: false, error: 'server_error' }, 500); }
}

async function handleUnlock(request, env) {
  if (!okOrigin(request)) return json({ ok: false, error: 'bad_origin' }, 403);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_request' }, 400); }
  const type = body.type;
  const id = String(body.id || '');
  if (!['listing', 'lead'].includes(type) || !/^[a-z0-9]{6,20}$/i.test(id)) return json({ ok: false, error: 'bad_request' }, 400);
  const sub = await getSession(request, env);
  if (!sub) return json({ ok: false, error: 'auth' }, 401);
  const m = await env.DB.prepare('SELECT * FROM members WHERE id=?').bind(sub).first();
  if (!m) return json({ ok: false, error: 'auth' }, 401);
  if (m.banned) return json({ ok: false, error: 'banned' }, 403);

  const day = today();
  const existing = await env.DB.prepare('SELECT 1 AS x FROM unlocks WHERE member_id=? AND target_type=? AND target_id=?').bind(sub, type, id).first();
  let limit = limitFor(m);
  if (!existing) {
    if (m.whatsapp_verified && !m.has_listing) {
      try {
        const r = await gas(env, { action: 'hasListing', email: m.email });
        if (r.ok && r.has) {
          await env.DB.prepare('UPDATE members SET has_listing=1 WHERE id=?').bind(sub).run();
          m.has_listing = 1; limit = limitFor(m);
        }
      } catch (e) {}
    }
    const used = await countToday(env, sub, day);
    if (used >= limit) return json({ ok: false, error: 'limit', limit, used }, 429);
  }
  let r;
  try { r = await gas(env, { action: 'contact', type, id }); } catch (e) { return json({ ok: false, error: 'server_error' }, 502); }
  if (!r || !r.ok || !r.contact) return json({ ok: false, error: 'not_found' }, 404);
  if (!existing) {
    await env.DB.prepare('INSERT OR IGNORE INTO unlocks(member_id,target_type,target_id,day,created_at) VALUES(?,?,?,?,?)')
      .bind(sub, type, id, day, new Date().toISOString()).run();
  }
  const used = await countToday(env, sub, day);
  return new Response(JSON.stringify({ ok: true, contact: r.contact, limit, remaining: Math.max(0, limit - used) }), {
    headers: { ...JSON_HDR, 'Cache-Control': 'no-store' }
  });
}

/* ---------- router ---------- */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === '/api/submit' && request.method === 'POST') return handleSubmit(request, env);
    if (p === '/api/feed' && request.method === 'GET') return handleFeed(request, env, ctx);
    if (p === '/api/auth/google' && request.method === 'POST') return handleGoogleAuth(request, env);
    if (p === '/api/auth/logout' && request.method === 'POST') return handleLogout();
    if (p === '/api/me' && request.method === 'GET') return handleMe(request, env);
    if (p === '/api/profile' && request.method === 'POST') return handleProfile(request, env);
    if (p === '/api/unlock' && request.method === 'POST') return handleUnlock(request, env);
    if (p === '/sitemap.xml') return handleSitemap(env, ctx);
    if (p.startsWith('/directory/') && p !== '/directory/') {
      const slug = decodeURIComponent(p.slice('/directory/'.length)).replace(/\/$/, '');
      if (/^[a-z0-9-]{1,90}$/.test(slug)) return handleListing(slug, env, ctx);
    }
    return env.ASSETS.fetch(request);
  }
};
