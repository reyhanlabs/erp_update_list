/**
 * Small, safe Markdown renderer for Knowledge Base articles (v4.42.0)
 *
 * Everything is HTML-escaped first; only the constructs below become markup:
 *   # / ## / ### headings      - bullet lists       1. numbered steps
 *   > callout (Note / Important)  ```code blocks```     --- divider
 *   | pipe | tables |           ![caption](kbimg:ID or https://…)
 *   **bold**  _italic_  `code`  [text](https://…)
 * Links and images only accept http(s) and the internal kbimg: scheme.
 */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SAFE_URL = /^https?:\/\/[^\s"'<>]+$/i;

function inline(raw){
  // Work on escaped text; protect inline code first
  const codes = [];
  let s = esc(raw).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])_([^_]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const u = url.replace(/&amp;/g, '&');
    return SAFE_URL.test(u)
      ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${text}</a>`
      : m;
  });
  // menu paths: "Sales > Sales Invoice" → arrow
  s = s.replace(/ &gt; /g, ' <span class="md-path">›</span> ');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  return s;
}

/* Optional per-call resolver for images that are local files (New Issue
 * preview: "![](screenshot-1.png)" → blob: URL of the not-yet-uploaded file). */
let currentResolver = null;

function imageTag(alt, src){
  const cap = alt ? `<figcaption>${esc(alt)}</figcaption>` : '';
  if(currentResolver && !/^kbimg:/.test(src) && !SAFE_URL.test(src)){
    const url = currentResolver(src);
    if(url && /^blob:/.test(url)){
      return `<figure class="md-figure"><img src="${esc(url)}" alt="${esc(alt)}">${cap}</figure>`;
    }
    return `<figure class="md-figure md-figure-missing"><img alt="${esc(alt)}">${cap}</figure>`;
  }
  if(/^kbimg:[A-Za-z0-9_-]+$/.test(src)){
    const id = src.slice(6);
    return `<figure class="md-figure"><img data-kbimg="${esc(id)}" alt="${esc(alt)}" loading="lazy">${cap}</figure>`;
  }
  if(SAFE_URL.test(src)){
    return `<figure class="md-figure"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer">${cap}</figure>`;
  }
  return '';
}

function splitRow(line){
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

export function renderMarkdown(src, opts = {}){
  currentResolver = typeof opts.resolveImage === 'function' ? opts.resolveImage : null;
  try { return renderMarkdownInner(src); } finally { currentResolver = null; }
}

function renderMarkdownInner(src){
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while(i < lines.length){
    const line = lines[i];
    const t = line.trim();

    if(!t){ i++; continue; }

    // fenced code
    if(t.startsWith('```')){
      const buf = [];
      i++;
      while(i < lines.length && !lines[i].trim().startsWith('```')){ buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre class="md-code"><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // headings
    const h = t.match(/^(#{1,3})\s+(.+)$/);
    if(h){
      const lvl = Math.max(2, h[1].length); // # and ## → h2 (h1 is the guide title), ### → h3
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      i++; continue;
    }

    if(/^(-{3,}|\*{3,})$/.test(t)){ out.push('<hr>'); i++; continue; }

    // standalone image
    const img = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if(img){ out.push(imageTag(img[1], img[2])); i++; continue; }

    // callout
    if(t.startsWith('>')){
      const buf = [];
      while(i < lines.length && lines[i].trim().startsWith('>')){
        buf.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      const first = buf.join(' ').toLowerCase();
      const warn = /^(\*\*)?(important|warning|caution|penting|peringatan|perhatian)/.test(first);
      out.push(`<div class="md-callout${warn ? ' md-callout-warn' : ''}">${buf.map(inline).join('<br>')}</div>`);
      continue;
    }

    // table: header row + separator row
    if(t.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1].trim())){
      const head = splitRow(t);
      i += 2;
      const rows = [];
      while(i < lines.length && lines[i].trim().startsWith('|')){ rows.push(splitRow(lines[i])); i++; }
      out.push(`<div class="md-table-wrap"><table class="md-table"><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        rows.map(r => `<tr>${head.map((_, k) => `<td>${inline(r[k] || '')}</td>`).join('')}</tr>`).join('')
      }</tbody></table></div>`);
      continue;
    }

    // lists
    if(/^[-*]\s+/.test(t) || /^\d+[.)]\s+/.test(t)){
      const ordered = /^\d+[.)]\s+/.test(t);
      const re = ordered ? /^\d+[.)]\s+/ : /^[-*]\s+/;
      const items = [];
      while(i < lines.length && re.test(lines[i].trim())){
        let item = lines[i].trim().replace(re, '');
        i++;
        // indented continuation lines / inline images under a step
        const extra = [];
        while(i < lines.length && /^\s{2,}\S/.test(lines[i]) && !re.test(lines[i].trim())){
          const c = lines[i].trim();
          const im = c.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
          extra.push(im ? imageTag(im[1], im[2]) : `<div>${inline(c)}</div>`);
          i++;
        }
        items.push(`<li>${inline(item)}${extra.join('')}</li>`);
      }
      out.push(ordered ? `<ol class="md-steps">${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }

    // paragraph
    const buf = [];
    while(i < lines.length && lines[i].trim() &&
      !/^(#{1,3}\s|>|```|[-*]\s|\d+[.)]\s|!\[|\|)/.test(lines[i].trim()) &&
      !/^(-{3,}|\*{3,})$/.test(lines[i].trim())){
      buf.push(inline(lines[i].trim()));
      i++;
    }
    if(buf.length) out.push(`<p>${buf.join('<br>')}</p>`);
    else { out.push(`<p>${inline(t)}</p>`); i++; }
  }
  return out.join('\n');
}

/** Plain text for WhatsApp / Telegram (images dropped, steps kept) */
export function markdownToText(src){
  return String(src || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*!\[[^\]]*\]\([^)]*\)\s*$/gm, '')
    .replace(/```/g, '')
    .replace(/^#{1,3}\s+(.+)$/gm, (_, h) => `*${h.trim()}*`)
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^>\s?/gm, '')
    .replace(/^\|?\s*:?-{2,}.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
