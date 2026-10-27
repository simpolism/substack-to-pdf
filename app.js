import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import htmlToPdfmake from 'html-to-pdfmake';
import TurndownService from 'turndown';

pdfMake.vfs = pdfFonts.pdfMake?.vfs || pdfFonts.vfs || pdfFonts;

const $ = (s) => document.querySelector(s);
const form = $('#form');
const input = $('#url');
const statusEl = $('#status');
const actions = $('#actions');
const article = $('#article');

let post = null; // { meta, html (cleaned, images as data URLs), images: [...] }

const setStatus = (msg, kind = '') => {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + kind;
};

// ---------- fetching ----------

async function fetchPost(url) {
  const r = await fetch('/api/post?url=' + encodeURIComponent(url));
  const d = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

// Fetch through the proxy, re-encode via canvas: pdfmake only takes JPEG/PNG,
// and this also caps resolution so the PDF stays a sane size.
async function imageToDataUrl(src, maxW = 1400) {
  const r = await fetch('/api/img?u=' + encodeURIComponent(src));
  if (!r.ok) throw new Error(`image HTTP ${r.status}`);
  const blob = await r.blob();
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxW / bmp.width);
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  return { dataUrl: c.toDataURL('image/jpeg', 0.85), width: w, height: h };
}

// ---------- cleaning Substack's HTML ----------

const DROP = [
  'button', 'svg', 'script', 'style', 'source', 'noscript',
  '.image-link-expand', '.subscription-widget-wrap', '.subscription-widget',
  '.subscribe-widget', '.button-wrapper', '.captioned-button-wrap', '.poll-embed',
  '.paywall-jump', '[data-component-name="SubscribeWidgetToDOM"]',
  '[data-component-name="ButtonCreateButton"]',
];

function cleanBody(bodyHtml) {
  const doc = new DOMParser().parseFromString(`<div id="root">${bodyHtml}</div>`, 'text/html');
  const root = doc.getElementById('root');
  root.querySelectorAll(DROP.join(',')).forEach((n) => n.remove());

  // Unwrap image links and <picture>, keep the <img>.
  root.querySelectorAll('a.image-link, picture').forEach((n) => n.replaceWith(...n.childNodes));

  // Embeds -> plain links.
  root.querySelectorAll('iframe').forEach((f) => {
    const src = f.getAttribute('src') || '';
    const p = doc.createElement('p');
    p.innerHTML = `<em>[Embedded media: <a href="${src}">${src}</a>]</em>`;
    f.replaceWith(p);
  });
  root.querySelectorAll('.tweet, .embedded-post-wrap, .embedded-post, .youtube-wrap, .digest-post-embed').forEach((n) => {
    const a = n.querySelector('a[href]');
    const text = n.textContent.replace(/\s+/g, ' ').trim().slice(0, 400);
    const bq = doc.createElement('blockquote');
    bq.innerHTML = `${escapeHtml(text)}${a ? ` <a href="${a.href}">[link]</a>` : ''}`;
    n.replaceWith(bq);
  });

  // Footnotes: superscript anchors, a heading before the notes block.
  root.querySelectorAll('a.footnote-anchor').forEach((a) => {
    const sup = doc.createElement('sup');
    a.replaceWith(sup);
    sup.appendChild(a);
  });
  const firstNote = root.querySelector('div.footnote');
  if (firstNote) {
    const h = doc.createElement('h3');
    h.textContent = 'Notes';
    firstNote.before(doc.createElement('hr'), h);
    root.querySelectorAll('div.footnote').forEach((fn) => {
      const num = fn.querySelector('.footnote-number');
      const content = fn.querySelector('.footnote-content');
      if (num && content) {
        const first = content.querySelector('p') || content;
        first.insertAdjacentHTML('afterbegin', `<strong>${escapeHtml(num.textContent.trim())}.</strong> `);
        num.remove();
      }
    });
  }

  // Strip Substack's attribute noise.
  root.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (!['href', 'src', 'alt', 'id', 'colspan', 'rowspan'].includes(attr.name)) el.removeAttribute(attr.name);
    }
  });
  // Footnotes keep their classes stripped, but mark the section.
  root.querySelectorAll('img').forEach((img) => {
    img.removeAttribute('srcset');
    if (!img.getAttribute('src')) img.remove();
  });
  // Collapse empty wrappers.
  root.querySelectorAll('div:empty, p:empty, figure:empty').forEach((n) => n.remove());
  return root;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function headerHtml(m) {
  return `<h1>${escapeHtml(m.title || '')}</h1>` +
    (m.subtitle ? `<p class="subtitle"><em>${escapeHtml(m.subtitle)}</em></p>` : '') +
    `<p class="byline">${escapeHtml(m.authors.join(', '))}${m.date ? ' · ' + fmtDate(m.date) : ''}<br>` +
    `<a href="${m.url}">${escapeHtml(m.url)}</a></p><hr>`;
}

// ---------- main load ----------

async function load(url) {
  url = url.trim();
  actions.hidden = true;
  article.innerHTML = '';
  post = null;
  setStatus('Fetching post…');
  const meta = await fetchPost(url);
  const root = cleanBody(meta.body_html);

  const imgs = [...root.querySelectorAll('img')];
  let done = 0, failed = 0;
  setStatus(`Fetching ${imgs.length} image${imgs.length === 1 ? '' : 's'}…`);
  await Promise.all(imgs.map(async (img) => {
    try {
      const { dataUrl, width, height } = await imageToDataUrl(img.getAttribute('src'));
      img.setAttribute('data-orig', img.getAttribute('src'));
      img.setAttribute('src', dataUrl);
      img.setAttribute('data-w', width);
      img.setAttribute('data-h', height);
    } catch (e) {
      failed++;
      const p = document.createElement('p');
      p.innerHTML = `<em>[Image unavailable: <a href="${img.getAttribute('src')}">link</a>]</em>`;
      img.replaceWith(p);
    }
    done++;
    setStatus(`Fetched ${done}/${imgs.length} images…`);
  }));

  post = { meta, root };
  article.innerHTML = headerHtml(meta) + root.innerHTML;
  actions.hidden = false;
  const notes = [];
  if (meta.truncated) notes.push('paywalled: only the free preview is available');
  if (failed) notes.push(`${failed} image(s) failed`);
  $('#md-link').href = '/md/' + url;
  $('#md-link').textContent = location.origin + '/md/' + url;
  setStatus(`Ready: “${meta.title}”, ${meta.wordcount?.toLocaleString() ?? '?'} words, ${imgs.length - failed} images` +
    (notes.length ? ` (${notes.join('; ')})` : '') + '.', notes.length ? 'warn' : 'ok');
}

// ---------- exports ----------

const slug = () => (post.meta.url || 'post').split('/').filter(Boolean).pop().replace(/[^\w-]+/g, '') || 'post';

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

const CONTENT_W = 515; // A4/Letter-ish usable width in pt with 40pt margins

function buildPdf() {
  const m = post.meta;
  const root = post.root.cloneNode(true);
  // Size images to fit the page.
  root.querySelectorAll('img').forEach((img) => {
    const w = +img.dataset.w, h = +img.dataset.h;
    const fitW = Math.min(CONTENT_W, w * 0.75);
    const fitH = Math.min(fitW * (h / w), 640);
    img.setAttribute('width', Math.round(fitH * (w / h)));
    img.setAttribute('height', Math.round(fitH));
    img.removeAttribute('data-w'); img.removeAttribute('data-h'); img.removeAttribute('data-orig');
  });
  const body = htmlToPdfmake(root.innerHTML, {
    imagesByReference: false,
    defaultStyles: {
      p: { margin: [0, 0, 0, 9] },
      h1: { fontSize: 20, bold: true, margin: [0, 12, 0, 6] },
      h2: { fontSize: 16, bold: true, margin: [0, 12, 0, 6] },
      h3: { fontSize: 13.5, bold: true, margin: [0, 10, 0, 5] },
      h4: { fontSize: 12, bold: true, margin: [0, 8, 0, 4] },
      a: { color: '#1a5fb4', decoration: 'underline' },
      blockquote: { italics: true, color: '#444', margin: [16, 4, 8, 9] },
      li: { margin: [0, 0, 0, 3] },
      figcaption: { fontSize: 9, color: '#555', italics: true, alignment: 'center', margin: [0, 2, 0, 10] },
      pre: { fontSize: 8.5, preserveLeadingSpaces: true, background: '#f4f4f4', margin: [0, 4, 0, 9] },
      code: { fontSize: 9, background: '#f4f4f4' },
      img: { alignment: 'center', margin: [0, 4, 0, 4] },
    },
  });
  const header = [
    { text: m.title || '', fontSize: 22, bold: true, margin: [0, 0, 0, 4] },
    m.subtitle ? { text: m.subtitle, fontSize: 13, italics: true, color: '#444', margin: [0, 0, 0, 6] } : null,
    { text: `${m.authors.join(', ')}${m.date ? ' · ' + fmtDate(m.date) : ''}`, fontSize: 10, color: '#555' },
    { text: m.url, link: m.url, fontSize: 9, color: '#1a5fb4', margin: [0, 2, 0, 8] },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_W, y2: 0, lineWidth: 0.5, lineColor: '#aaa' }], margin: [0, 0, 0, 12] },
  ].filter(Boolean);
  return {
    info: { title: m.title, author: m.authors.join(', '), subject: m.url },
    pageMargins: [40, 40, 40, 44],
    content: [...header, ...body],
    defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.3 },
    footer: (cur, total) => ({ text: `${cur} / ${total}`, alignment: 'center', fontSize: 8, color: '#888', margin: [0, 14, 0, 0] }),
  };
}

function toMarkdown() {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', emDelimiter: '*' });
  td.addRule('figcaption', {
    filter: 'figcaption',
    replacement: (c) => {
      const t = c.trim().replace(/^[*_]+|[*_]+$/g, '').trim();
      return t ? `\n\n*Caption: ${t}*\n\n` : '';
    },
  });
  td.addRule('img', {
    filter: 'img',
    replacement: (_, n) => `![${n.getAttribute('alt') || ''}](${n.getAttribute('data-orig') || n.getAttribute('src')})`,
  });
  const m = post.meta;
  const head = `# ${m.title}\n\n` + (m.subtitle ? `*${m.subtitle}*\n\n` : '') +
    `${m.authors.join(', ')}${m.date ? ' · ' + fmtDate(m.date) : ''}  \n${m.url}\n\n---\n\n`;
  return head + td.turndown(post.root.innerHTML) + '\n';
}

function toHtmlFile() {
  const css = document.getElementById('article-css').textContent;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(post.meta.title)}</title>` +
    `<style>body{max-width:720px;margin:40px auto;padding:0 20px}${css}</style></head>` +
    `<body><article class="article">${article.innerHTML}</article></body></html>`;
}

// ---------- wiring ----------

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  const btn = form.querySelector('button');
  btn.disabled = true;
  history.replaceState(null, '', '?post=' + encodeURIComponent(url));
  try {
    await load(url);
  } catch (err) {
    setStatus(err.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

$('#dl-pdf').addEventListener('click', () => {
  setStatus('Building PDF…');
  pdfMake.createPdf(buildPdf()).getBlob((blob) => {
    download(blob, slug() + '.pdf');
    setStatus(`PDF downloaded (${(blob.size / 1024 / 1024).toFixed(1)} MB).`, 'ok');
  });
});
$('#dl-md').addEventListener('click', () => download(new Blob([toMarkdown()], { type: 'text/markdown' }), slug() + '.md'));
$('#dl-html').addEventListener('click', () => download(new Blob([toHtmlFile()], { type: 'text/html' }), slug() + '.html'));
$('#copy-md').addEventListener('click', async () => {
  await navigator.clipboard.writeText(toMarkdown());
  setStatus('Markdown copied to clipboard (images as links).', 'ok');
});
$('#print').addEventListener('click', () => window.print());

// Expose for testing.
window.__s2p = { buildPdf, toMarkdown, get post() { return post; } };

const q = new URLSearchParams(location.search).get('post');
if (q) {
  input.value = q;
  form.requestSubmit();
}
