// GET /api/feed?action=listings|leads|stats  -> cached public feed (no contact data)
export async function onRequestGet({ request, env, waitUntil }) {
  const action = new URL(request.url).searchParams.get('action') || 'listings';
  if (!['listings', 'leads', 'stats'].includes(action)) {
    return new Response('{"ok":false}', { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const cache = caches.default;
  const cacheKey = new Request('https://poultrytrading.com/__feed/' + action);
  let res = await cache.match(cacheKey);
  if (res) return res;

  const upstream = await fetch(env.APPS_SCRIPT_URL + '?action=' + action, { redirect: 'follow' });
  const text = await upstream.text();
  res = new Response(text, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
  });
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
