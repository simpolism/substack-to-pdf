// Server-side Substack HTML -> Markdown (turndown's Node build ships its own DOM).
// Used by /md/<url> and /api/md so agents that don't run JS get the post in one GET.
import TurndownService from 'turndown';

const cls = (n) => ` ${n.getAttribute?.('class') || ''} `;
const has = (n, c) => cls(n).includes(` ${c} `);

const DROP_CLASSES = [
  'image-link-expand', 'subscription-widget-wrap', 'subscription-widget', 'subscribe-widget',
  'button-wrapper', 'captioned-button-wrap', 'poll-embed', 'paywall-jump', 'pencraft',
];

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function postToMarkdown(d) {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', emDelimiter: '*', bulletListMarker: '-' });
  td.remove(['button', 'svg', 'script', 'style', 'source', 'noscript', 'form']);
  td.addRule('drop-widgets', { filter: (n) => DROP_CLASSES.some((c) => has(n, c)), replacement: () => '' });
  // <a class="image-link"><picture><img></picture></a> -> just the image
  td.addRule('image-link', { filter: (n) => n.nodeName === 'A' && has(n, 'image-link'), replacement: (c) => c });
  td.addRule('img', {
    filter: 'img',
    replacement: (_, n) => {
      const src = n.getAttribute('src');
      return src ? `\n\n![${(n.getAttribute('alt') || '').replace(/[\[\]\n]/g, ' ')}](${src})\n\n` : '';
    },
  });
  td.addRule('figcaption', { filter: 'figcaption', replacement: (c) => (c.trim() ? `*${c.trim()}*\n\n` : '') });
  td.addRule('iframe', {
    filter: 'iframe',
    replacement: (_, n) => `\n\n[Embedded media](${n.getAttribute('src') || ''})\n\n`,
  });
  // Footnotes -> [^n] / [^n]: text
  td.addRule('fn-anchor', {
    filter: (n) => n.nodeName === 'A' && has(n, 'footnote-anchor'),
    replacement: (c) => `[^${c.trim()}]`,
  });
  td.addRule('fn-body', {
    filter: (n) => n.nodeName === 'DIV' && has(n, 'footnote'),
    replacement: (_, n) => {
      const num = [...n.childNodes].find((k) => k.nodeType === 1 && has(k, 'footnote-number'));
      const body = [...n.childNodes].find((k) => k.nodeType === 1 && has(k, 'footnote-content'));
      const text = body ? td.turndown(body.innerHTML).replace(/\n\n+/g, '\n\n    ') : '';
      return `\n[^${num ? num.textContent.trim() : '?'}]: ${text}\n`;
    },
  });

  const head = [
    `# ${d.title}`,
    d.subtitle ? `*${d.subtitle}*` : null,
    [(d.authors || []).join(', '), fmtDate(d.date)].filter(Boolean).join(' · ') + '  \n' + d.url,
    d.truncated ? '> **Note:** this post is paywalled; only the free preview is included.' : null,
    '---',
  ].filter(Boolean).join('\n\n');
  const body = td.turndown(d.body_html).replace(/\n{3,}/g, '\n\n').trim();
  return `${head}\n\n${body}\n`;
}
