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
const FOOT = '<footer>&copy; PoultryTrading.com &middot; <a href="/">Home</a> &middot; <a href="/directory/">Directory</a> &middot; <a href="/leads/">Enquiries</a> &middot; <a href="/contact/">Contact</a></footer>';

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
<div class="lockbox"><h2>Contact details</h2>
<p>Phone, email and address are hidden. To get in touch with this business, send us a request.</p>
<a class="cta" href="/contact/" style="margin:0">Request contact</a></div>
<p class="note">Is this your business? <a href="/list-your-business/">Add or update your listing free</a>.</p>`;

  const html = shell({ title, desc, canonical, robots: listing.verified ? 'index, follow' : 'noindex, follow', body, ld });
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}

/* ---------- sitemap (static pages + approved listings) ---------- */
async function handleSitemap(env, ctx) {
  const pages = ['/', '/directory/', '/leads/', '/list-your-business/', '/enquiry/import-export/', '/enquiry/local-trade/', '/contact/'];
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

/* ---------- router ---------- */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === '/api/submit' && request.method === 'POST') return handleSubmit(request, env);
    if (p === '/api/feed' && request.method === 'GET') return handleFeed(request, env, ctx);
    if (p === '/sitemap.xml') return handleSitemap(env, ctx);
    if (p.startsWith('/directory/') && p !== '/directory/') {
      const slug = decodeURIComponent(p.slice('/directory/'.length)).replace(/\/$/, '');
      if (/^[a-z0-9-]{1,90}$/.test(slug)) return handleListing(slug, env, ctx);
    }
    return env.ASSETS.fetch(request);
  }
};
