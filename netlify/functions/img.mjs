import { handleImage } from '../../lib/proxy.mjs';

export default async (req) => handleImage(new URL(req.url).searchParams.get('u'));

export const config = { path: '/api/img' };
