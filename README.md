# Substack to PDF

Paste a Substack post URL and download it as a PDF (text formatting, images, footnotes), Markdown, or standalone HTML, so you can hand it to an LLM that can't fetch Substack.

Works with `*.substack.com`, custom domains (e.g. `contraptions.venkateshrao.com/p/...`), `open.substack.com/pub/...` and `substack.com/@user/p-123` links. You can deep-link with `?post=<url>`. Paywalled posts only include the free preview.

## For agents

- `GET /md/<post url>` (or `/api/md?url=<encoded url>`) returns the post as `text/markdown`. It needs no JS, so a plain fetch tool works.
- `GET /api/post?url=<encoded url>` returns JSON.
- `/llms.txt` documents both. The homepage HTML also mentions them, so an agent that only fetches `/` can find them.

## How it works

- `lib/proxy.mjs` reads the post from Substack's public JSON API (`/api/v1/posts/<slug>`) and proxies images. Substack sends no CORS headers, so the browser can't call either one directly.
- In production those routes are served by Netlify Functions (`netlify/functions/`). Locally, a Vite middleware (`vite.config.mjs`) serves the same `/api/post` and `/api/img` routes.
- `app.js` cleans Substack's HTML (drops buttons and subscribe widgets, unwraps images, turns footnotes into superscripts plus a Notes section) and inlines images as JPEG data URLs. It then builds the PDF client-side with pdfmake + html-to-pdfmake. Markdown comes from turndown, with images left as links.

## License

MIT

## Run locally

    npm install
    npm run dev

## Deploy

On Netlify, connect the repo. `netlify.toml` sets build `npm run build`, publish `dist`, and the functions dir.
