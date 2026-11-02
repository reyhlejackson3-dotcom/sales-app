// Shared Twilio helpers. No Twilio SDK needed: access tokens are plain signed JWTs and the REST API is plain HTTPS.
// Files starting with "_" are not routes.
import crypto from 'node:crypto';
import { HttpError } from './_lib.js';

const env = (k) => (process.env[k] || '').trim();
const API_BASE = () => env('TWILIO_API_BASE') || 'https://api.twilio.com'; // override only in tests

/** True when every Twilio key is set. When false, the whole calling flow runs as a demo (no real calls, no cost). */
export function twilioLive() {
  return ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_API_KEY_SID', 'TWILIO_API_KEY_SECRET', 'TWILIO_TWIML_APP_SID'].every((k) => env(k));
}

const safeEq = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Gate for every endpoint that can spend money (token, number buying, recording fetches).
 * PROTOTYPE ONLY: one shared secret (APP_ACCESS_CODE). Replace with a real login check (e.g. Supabase JWT) before public launch.
 * Fails closed: on a production deploy with no APP_ACCESS_CODE set, nothing that costs money will run.
 */
export function requireAccess(req) {
  const want = env('APP_ACCESS_CODE');
  if (!want) {
    if (env('VERCEL_ENV') === 'production') throw new HttpError(503, 'Calling is switched off: set APP_ACCESS_CODE in Vercel first.');
    return; // local dev
  }
  if (!safeEq(String(req.headers['x-access-code'] || ''), want)) throw new HttpError(401, 'Wrong or missing access code.');
}

const b64u = (b) => Buffer.from(b).toString('base64url');

/** Twilio Voice access token (JWT, HS256) that lets one browser place calls through our TwiML app. */
export function accessToken(identity, ttlSec = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: 'JWT', alg: 'HS256', cty: 'twilio-fpa;v=1' };
  const payload = {
    jti: `${env('TWILIO_API_KEY_SID')}-${now}`,
    iss: env('TWILIO_API_KEY_SID'),
    sub: env('TWILIO_ACCOUNT_SID'),
    iat: now,
    exp: now + ttlSec,
    grants: { identity, voice: { outgoing: { application_sid: env('TWILIO_TWIML_APP_SID') } } },
  };
  const body = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const sig = crypto.createHmac('sha256', env('TWILIO_API_KEY_SECRET')).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Identities become part of a "client:" address, so keep them boring. */
export function cleanIdentity(v) {
  const s = String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (s.length < 6) throw new HttpError(400, 'Missing user id.');
  return s;
}

/* ---------- phone numbers ---------- */
// Area codes outside the US and Canada that dial like normal 10-digit numbers but bill as international or premium (the classic toll-fraud routes).
const BLOCKED_NPA = new Set(['242', '246', '264', '268', '284', '345', '441', '473', '649', '664', '721', '758', '767', '784', '809', '829', '849', '868', '869', '876', '671', '684', '670', '787', '939',
  '900', '976', '500', '521', '522', '533', '544', '566', '577', '588', '600', '700', '710']);

/** "(303) 555-0142" or "+1 303 555 0142" -> "+13035550142", or throws a friendly error. US and Canada only. */
export function toE164(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) throw new HttpError(400, 'Enter a 10-digit US or Canadian phone number.');
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) throw new HttpError(400, 'That does not look like a valid phone number.');
  if (BLOCKED_NPA.has(d.slice(0, 3))) throw new HttpError(400, 'Calls to that area code are not allowed.');
  return `+1${d}`;
}

/* ---------- REST ---------- */
export async function twilioApi(path, { method = 'GET', form, query, raw = false } = {}) {
  const sid = env('TWILIO_ACCOUNT_SID');
  const url = new URL(`${API_BASE()}/2010-04-01/Accounts/${sid}/${path}`);
  for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, String(v));
  const r = await fetch(url, {
    method,
    headers: {
      authorization: 'Basic ' + Buffer.from(`${env('TWILIO_API_KEY_SID')}:${env('TWILIO_API_KEY_SECRET')}`).toString('base64'),
      ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  if (!r.ok) {
    const text = (await r.text().catch(() => '')).slice(0, 600);
    console.error('Twilio error', method, path, r.status, text.slice(0, 400));
    let why = ''; let code = '';
    try { const j = JSON.parse(text); why = String(j.message || '').slice(0, 220); code = j.code ? ` (code ${j.code})` : ''; } catch { /* not JSON */ }
    const said = why ? ` Twilio said: ${why}${code}` : '';
    if (r.status === 404) throw new HttpError(404, 'Twilio could not find that item.' + said);
    if (r.status === 401) throw new HttpError(502, 'Twilio rejected our keys. Check the TWILIO_* variables in Vercel.' + said);
    if (r.status === 403) throw new HttpError(502, 'Twilio refused that action.' + said);
    throw new HttpError(502, 'Twilio did not accept that request.' + said);
  }
  if (raw) return r;
  if (r.status === 204) return {};
  return r.json();
}

/* ---------- webhooks ---------- */
/** The public base URL Twilio used to reach us (needed to rebuild the signed URL). */
export function baseUrl(req) {
  const fixed = env('PUBLIC_BASE_URL');
  if (fixed) return fixed.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

/** Form body of a Twilio webhook, whether the host already parsed it (Vercel) or not (local dev server). */
export async function readForm(req) {
  const body = req.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return { ...body };
  let raw = '';
  if (typeof body === 'string') raw = body;
  else if (Buffer.isBuffer(body)) raw = body.toString('utf8');
  else { const chunks = []; let n = 0; for await (const c of req) { n += c.length; if (n > 100_000) throw new HttpError(413, 'Too large'); chunks.push(c); } raw = Buffer.concat(chunks).toString('utf8'); }
  return Object.fromEntries(new URLSearchParams(raw));
}

/** Twilio signs every webhook with the account Auth Token. Anything unsigned or wrongly signed is rejected. */
export function validTwilioSignature(req, params) {
  const token = env('TWILIO_AUTH_TOKEN');
  const header = String(req.headers['x-twilio-signature'] || '');
  if (!token || !header) return false;
  const url = baseUrl(req) + req.url;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', token).update(data).digest('base64');
  return safeEq(header, expected);
}

export const xml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

export function sendXml(res, body) {
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`);
}

/** The recording notice played to the person who answers. On by default; see TWILIO-SETUP.md before turning it off. */
export function disclosureText() {
  if (env('RECORD_DISCLOSURE') === 'off') return '';
  return env('RECORD_DISCLOSURE_TEXT') || 'This call is being recorded for quality and training.';
}
