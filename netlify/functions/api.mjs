import { handlePost, handleMarkdown, urlFromMdPath } from '../../lib/proxy.mjs';

// One function for the per-post routes so a single rate-limit rule covers them
// (Netlify's free plan allows 2 code-based rules per project).
export default async (req) => {
  const { pathname, searchParams } = new URL(req.url);
  if (pathname === '/api/post') return handlePost(searchParams.get('url'));
  return handleMarkdown(urlFromMdPath(req.url));
};

export const config = {
  path: ['/api/post', '/api/md', '/md', '/md/*'],
  // Per client IP: 30 posts/minute is far beyond human use, cheap insurance against scrapers.
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
