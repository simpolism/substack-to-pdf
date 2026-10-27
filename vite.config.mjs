import { defineConfig } from 'vite';
import { handlePost, handleImage, handleMarkdown, urlFromMdPath } from './lib/proxy.mjs';

// Locally, serve the same /api/* routes the Netlify functions serve in prod.
async function send(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await response.arrayBuffer()));
}

const devApi = {
  name: 'dev-api',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const u = new URL(req.url, 'http://localhost');
      try {
        if (u.pathname === '/api/post') return await send(res, await handlePost(u.searchParams.get('url')));
        if (u.pathname === '/md' || u.pathname.startsWith('/md/') || u.pathname === '/api/md')
          return await send(res, await handleMarkdown(urlFromMdPath('http://localhost' + req.url)));
        if (u.pathname === '/api/img') return await send(res, await handleImage(u.searchParams.get('u')));
      } catch (e) {
        res.statusCode = 500;
        return res.end(String(e));
      }
      next();
    });
  },
};

export default defineConfig({ plugins: [devApi] });
