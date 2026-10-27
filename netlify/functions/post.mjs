import { handlePost } from '../../lib/proxy.mjs';

export default async (req) => handlePost(new URL(req.url).searchParams.get('url'));

export const config = { path: '/api/post' };
