// Stripe over plain HTTPS (no SDK). Files starting with "_" are not routes.
import crypto from 'node:crypto';
import { HttpError } from './_lib.js';

const env = (k) => (process.env[k] || '').trim();
const API = () => env('STRIPE_API_BASE') || 'https://api.stripe.com'; // override only in tests

export const stripeLive = () => Boolean(env('STRIPE_SECRET_KEY'));

/** Price id for a plan, from STRIPE_PRICE_STARTER / _PRO / _ELITE. */
export const priceFor = (plan) => env(`STRIPE_PRICE_${String(plan).toUpperCase()}`);
/** Plan name for a price id (reverse of priceFor). */
export function planForPrice(priceId) {
  for (const p of ['starter', 'pro', 'elite']) if (priceFor(p) && priceFor(p) === priceId) return p;
  return null;
}

/** Stripe wants form encoding with brackets for nesting: line_items[0][price]=... */
function encode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' ? encode(item, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))));
    else if (typeof v === 'object') encode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe(path, { method = 'POST', form, query } = {}) {
  const url = new URL(`${API()}/v1/${path}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const r = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? encode(form).toString() : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('Stripe error', method, path, r.status, JSON.stringify(j).slice(0, 400));
    throw new HttpError(502, j?.error?.message ? `Payment error: ${j.error.message}` : 'The payment service did not accept that. Try again.');
  }
  return j;
}

/** Checks the Stripe-Signature header against the raw request body. Throws if it does not match. */
export function verifyWebhook(raw, header, secret = env('STRIPE_WEBHOOK_SECRET'), toleranceSec = 300) {
  if (!secret) throw new HttpError(500, 'STRIPE_WEBHOOK_SECRET is not set.');
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=')).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), v]));
  const t = Number(parts.t);
  const sigs = String(header || '').split(',').filter((p) => p.trim().startsWith('v1=')).map((p) => p.trim().slice(3));
  if (!t || !sigs.length) throw new HttpError(400, 'Bad signature header');
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) throw new HttpError(400, 'Signature too old');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw.toString('utf8')}`).digest('hex');
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) throw new HttpError(400, 'Bad signature');
  return JSON.parse(raw.toString('utf8'));
}

/** The fields we keep from a Stripe subscription. Handles both old and new API shapes for the period end. */
export function subFields(sub) {
  const item = sub?.items?.data?.[0];
  const end = sub?.current_period_end ?? item?.current_period_end ?? null;
  return {
    stripe_subscription_id: sub.id,
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
    sub_status: sub.status,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end || (sub.cancel_at && sub.status !== 'canceled')),
    period_end: end ? new Date(end * 1000).toISOString() : null,
    ...(planForPrice(item?.price?.id) ? { plan: planForPrice(item.price.id) } : {}),
  };
}
