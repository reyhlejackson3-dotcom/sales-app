// Safe page fetching for call prep. Blocks private/internal addresses so the server can't be pointed at internal services.
import dns from 'node:dns/promises';
import net from 'node:net';
import { HttpError } from './_lib.js';

const MAX_BYTES = 1_500_000;
const HEADERS_BOT = { 'user-agent': 'Mozilla/5.0 (compatible; SalesCoachBot/0.2)', accept: 'text/html,application/xhtml+xml' };
const HEADERS_BROWSER = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};
const TIMEOUT_MS = 8000;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const m = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? isPrivateIp(m[1]) : false;
  }
  return true;
}

/** Turns what the user typed into a safe http(s) URL, or throws. */
export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new HttpError(400, 'Paste a website address first.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { throw new HttpError(400, 'That does not look like a website address.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, 'Only http and https addresses work.');
  if (!u.hostname.includes('.') || u.username || u.password) throw new HttpError(400, 'That does not look like a public website address.');
  u.hash = '';
  return u;
}

async function assertPublic(u) {
  if (net.isIP(u.hostname)) {
    if (isPrivateIp(u.hostname)) throw new HttpError(400, 'That address is not allowed.');
    return;
  }
  let addrs;
  try { addrs = await dns.lookup(u.hostname, { all: true }); } catch { throw new HttpError(422, 'Could not find that website. Check the address.'); }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new HttpError(400, 'That address is not allowed.');
}

/** Fetches one page as text/html, following up to 3 redirects, re-checking each hop. Returns { url, html }. */
export async function fetchPage(startUrl) {
  let u = new URL(startUrl);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(u);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let r;
    try {
      r = await fetch(u, { redirect: 'manual', signal: ctl.signal, headers: HEADERS_BOT });
      // Some sites refuse anything that does not look like a normal browser visit. Try once as a browser before giving up.
      if ([401, 403, 406, 429, 503].includes(r.status)) {
        try { await r.body?.cancel(); } catch { /* ignore */ }
        r = await fetch(u, { redirect: 'manual', signal: ctl.signal, headers: HEADERS_BROWSER });
      }
    } catch {
      clearTimeout(timer);
      throw new HttpError(422, 'Could not open that website. It may be down or blocking automated visits.');
    }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      clearTimeout(timer);
      try { u = new URL(r.headers.get('location'), u); } catch { throw new HttpError(422, 'That website sent a broken redirect.'); }
      if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(422, 'That website redirected somewhere unsupported.');
      continue;
    }
    if (!r.ok) {
      clearTimeout(timer);
      if ([401, 403, 406, 429, 503].includes(r.status)) throw new HttpError(422, `That website blocks automated visits (error ${r.status}). Open it yourself, copy its text, and use "Paste the site text instead" below.`);
      throw new HttpError(422, `That website answered with an error (${r.status}).`);
    }
    const ct = r.headers.get('content-type') || '';
    if (ct && !/text\/html|application\/xhtml/i.test(ct)) { clearTimeout(timer); throw new HttpError(422, 'That address is not a web page.'); }
    const reader = r.body.getReader();
    const chunks = []; let n = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.length;
        if (n > MAX_BYTES) { await reader.cancel(); break; }
        chunks.push(value);
      }
    } catch { /* partial page is fine */ }
    clearTimeout(timer);
    return { url: u.toString(), html: Buffer.concat(chunks).toString('utf8') };
  }
  throw new HttpError(422, 'That website redirected too many times.');
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function htmlToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (m, k) => ENT[k] ?? ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function pageTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? htmlToText(m[1]).slice(0, 160) : '';
}

/** Same-site links likely to say more about the business (about, services...). */
export function usefulLinks(html, baseUrl, max = 2) {
  const base = new URL(baseUrl);
  const found = [];
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/gi)) {
    let u;
    try { u = new URL(m[1], base); } catch { continue; }
    if (u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
    if (!/about|service|what-we|our-story|who-we|products|solutions|company/i.test(u.pathname)) continue;
    if (/\.(pdf|jpg|png|zip)$/i.test(u.pathname)) continue;
    u.hash = ''; u.search = '';
    const s = u.toString();
    if (s !== base.toString() && !found.includes(s)) found.push(s);
    if (found.length >= max) break;
  }
  return found;
}

/** Title, meta/OpenGraph descriptions, JSON-LD and <noscript> text. Often all that is visible on sites that build their pages with JavaScript. */
export function metaText(html) {
  const out = [];
  const add = (v) => { const s = htmlToText(String(v || '')).slice(0, 600); if (s && !out.includes(s)) out.push(s); };
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0];
    const name = (tag.match(/(?:name|property)=["']([^"']+)["']/i) || [])[1] || '';
    if (/^(description|og:title|og:description|twitter:description)$/i.test(name)) add((tag.match(/content=["']([^"']*)["']/i) || [])[1]);
  }
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) return o.forEach(walk);
        for (const k of ['name', 'description', 'slogan', 'telephone', 'areaServed', 'serviceType']) if (typeof o[k] === 'string') add(`${k}: ${o[k]}`);
        Object.values(o).forEach(walk);
      };
      walk(JSON.parse(m[1]));
    } catch { /* bad JSON-LD */ }
  }
  for (const m of html.matchAll(/<noscript[^>]*>([\s\S]*?)<\/noscript>/gi)) add(m[1]);
  return out.join('\n');
}
