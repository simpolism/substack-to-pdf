// Shared proxy logic: used by the Netlify function (prod) and the Vite dev middleware (local).
// Substack's API sends no CORS headers, so the browser can't call it directly.

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });

// Turn whatever the user pasted into an API URL.
export function resolveApiUrl(input) {
  let u;
  try {
    u = new URL(input.trim().startsWith('http') ? input.trim() : 'https://' + input.trim());
  } catch {
    throw new Error('That does not look like a URL.');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http(s) URLs.');
  const parts = u.pathname.split('/').filter(Boolean);

  // substack.com/home/post/p-123456, substack.com/@user/p-123456, .../p-123456
  const idPart = parts.find((p) => /^p-\d+$/.test(p));
  if (idPart && (u.hostname === 'substack.com' || u.hostname.endsWith('.substack.com'))) {
    return { api: `https://substack.com/api/v1/posts/by-id/${idPart.slice(2)}`, byId: true };
  }
  // open.substack.com/pub/<name>/p/<slug>
  if (u.hostname === 'open.substack.com' && parts[0] === 'pub' && parts[2] === 'p' && parts[3]) {
    return { api: `https://${parts[1]}.substack.com/api/v1/posts/${parts[3]}`, byId: false };
  }
  // <pub>.substack.com/p/<slug> or custom domain /p/<slug>
  const pi = parts.indexOf('p');
  if (pi >= 0 && parts[pi + 1]) {
    return { api: `${u.origin}/api/v1/posts/${encodeURIComponent(parts[pi + 1])}`, byId: false };
  }
  throw new Error('Could not find a post in that URL. Expected something like https://example.substack.com/p/some-post');
}

export async function handlePost(input) {
  if (!input) return json({ error: 'Missing ?url=' }, 400);
  let target;
  try {
    target = resolveApiUrl(input);
  } catch (e) {
    return json({ error: e.message }, 400);
  }
  let r;
  try {
    r = await fetch(target.api, { headers: { 'user-agent': UA, accept: 'application/json' }, redirect: 'follow' });
  } catch (e) {
    return json({ error: `Fetch failed: ${e.message}` }, 502);
  }
  const text = await r.text();
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    return json({ error: `Not a Substack post API response (HTTP ${r.status}). Is this a Substack site?` }, 502);
  }
  if (target.byId && d.post) d = d.post;
  if (r.ok && d.title && !d.body_html) {
    return json({ error: `“${d.title}” is paywalled (${d.audience}) and has no free preview.` }, 403);
  }
  if (!r.ok || !d.body_html) {
    return json({ error: d.error || d.errors?.[0]?.msg || `Upstream HTTP ${r.status}, no post body.` }, r.ok ? 404 : r.status);
  }
  return json({
    title: d.title,
    subtitle: d.subtitle,
    authors: (d.publishedBylines || []).map((b) => b.name),
    date: d.post_date,
    url: d.canonical_url,
    cover: d.cover_image,
    audience: d.audience,
    wordcount: d.wordcount,
    // Paywalled posts come back truncated; the client warns about it.
    truncated: d.audience === 'only_paid' || d.audience === 'founding',
    body_html: d.body_html,
  });
}

const IMG_HOSTS = [/(^|\.)substackcdn\.com$/, /^substack-post-media\.s3\.amazonaws\.com$/, /(^|\.)substack\.com$/, /^bucketeer-[\w-]+\.s3\.amazonaws\.com$/];

export async function handleImage(src) {
  let u;
  try {
    u = new URL(src);
  } catch {
    return new Response('bad url', { status: 400 });
  }
  if (u.protocol !== 'https:' || !IMG_HOSTS.some((re) => re.test(u.hostname))) {
    return new Response('host not allowed', { status: 403 });
  }
  const r = await fetch(u, { headers: { 'user-agent': UA, accept: 'image/png,image/jpeg,image/*;q=0.8' } });
  if (!r.ok) return new Response(`upstream ${r.status}`, { status: 502 });
  const type = r.headers.get('content-type') || 'application/octet-stream';
  if (!type.startsWith('image/')) return new Response('not an image', { status: 502 });
  return new Response(await r.arrayBuffer(), {
    headers: { 'content-type': type, 'cache-control': 'public, max-age=86400' },
  });
}
