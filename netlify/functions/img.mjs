import { handleImage } from '../../lib/proxy.mjs';

export default async (req) => handleImage(new URL(req.url).searchParams.get('u'));

export const config = {
  path: '/api/img',
  // A heavy post is ~25 images, so allow a few big posts per minute per IP.
  rateLimit: { windowLimit: 200, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
