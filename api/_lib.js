// Shared helpers for the serverless functions. Files starting with "_" are not routes.

const hits = new Map();

export function send(res, status, obj) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(obj);
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Best-effort per-IP limit. Serverless instances don't share memory, so this is a speed bump, not a wall. */
export function allow(req, res, max = 40) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'x';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  if (arr.length >= max) { send(res, 429, { error: 'Too many requests. Wait a minute and try again.' }); return false; }
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return true;
}

export function postOnly(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); send(res, 405, { error: 'POST only' }); return false; }
  return true;
}

export async function readRaw(req, maxBytes) {
  const body = req.body;
  if (Buffer.isBuffer(body)) {
    if (body.length > maxBytes) throw new HttpError(413, 'File too large');
    return body;
  }
  if (typeof body === 'string') return Buffer.from(body);
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > maxBytes) throw new HttpError(413, 'File too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, maxBytes = 300_000) {
  const body = req.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  const raw = typeof body === 'string' ? Buffer.from(body) : await readRaw(req, maxBytes);
  try { return JSON.parse(raw.toString('utf8') || '{}'); } catch { throw new HttpError(400, 'Bad JSON'); }
}

export function handle(fn) {
  return async (req, res) => {
    try {
      if (!postOnly(req, res)) return;
      if (!allow(req, res)) return;
      await fn(req, res);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: status === 500 ? 'Something went wrong on the server.' : e.message });
    }
  };
}

export async function callClaude({ system, messages, maxTokens = 700 }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });
  if (!r.ok) {
    console.error('Anthropic error', r.status, (await r.text()).slice(0, 500));
    throw new HttpError(502, 'The AI service rejected the request. Check ANTHROPIC_API_KEY and model name in Vercel logs.');
  }
  const j = await r.json();
  return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

export function extractJson(text) {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new HttpError(502, 'The AI returned an unreadable grade. Try again.');
  try { return JSON.parse(text.slice(a, b + 1)); } catch { throw new HttpError(502, 'The AI returned an unreadable grade. Try again.'); }
}

export const str = (v, max = 600) => (typeof v === 'string' ? v.slice(0, max) : '');
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));
