import { handleMarkdown, urlFromMdPath } from '../../lib/proxy.mjs';

export default async (req) => handleMarkdown(urlFromMdPath(req.url));

export const config = { path: ['/md', '/md/*', '/api/md'] };
