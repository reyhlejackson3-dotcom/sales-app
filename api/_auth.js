// Accounts: who is calling the API, which plan they are on, and how much they have used.
// Talks to Supabase over plain HTTPS (no SDK). Files starting with "_" are not routes.
//
// Without the three SUPABASE_* variables the app runs the old way (no logins, limits kept in the browser),
// so nothing breaks while you set it up.
import crypto from 'node:crypto';
import { HttpError } from './_lib.js';

const env = (k) => (process.env[k] || '').trim();
const SB = () => env('SUPABASE_URL').replace(/\/+$/, '');

/** True when logins are switched on. */
export const authLive = () => Boolean(SB() && env('SUPABASE_ANON_KEY') && env('SUPABASE_SERVICE_KEY'));

/* ---------- plans: the server's copy is the one that counts ---------- */
const ALL_MODES = ['easy', 'medium', 'hard', 'extreme'];
export const PLANS = {
  trial: { dials: 0, calls: 1, preps: 3, leads: 20, modes: ['medium'] },
  starter: { dials: 100, calls: 5, preps: 100, leads: 100, modes: ['easy', 'medium'] },
  pro: { dials: 250, calls: 10, preps: 250, leads: 250, modes: ALL_MODES },
  elite: { dials: 600, calls: 25, preps: 600, leads: 600, modes: ALL_MODES },
};
export const PAID = ['starter', 'pro', 'elite'];
const LIVE_STATUS = ['active', 'trialing', 'past_due']; // past_due: Stripe is retrying the card, keep access meanwhile

/** The plan the account really gets right now. A canceled or unpaid subscription drops back to the free trial. */
export function planOf(acc) {
  if (!acc) return 'trial';
  return PAID.includes(acc.plan) && LIVE_STATUS.includes(acc.sub_status) ? acc.plan : 'trial';
}
export const periodOf = (plan) => (plan === 'trial' ? 'lifetime' : new Date().toISOString().slice(0, 7));

/* ---------- Supabase REST ---------- */
/** Calls Supabase with the secret key. path is relative to the project URL, e.g. "rest/v1/accounts". */
export async function sb(path, { method = 'GET', body, query, prefer } = {}) {
  const key = env('SUPABASE_SERVICE_KEY');
  const url = new URL(`${SB()}/${path}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const headers = { apikey: key, 'content-type': 'application/json' };
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`; // legacy service_role key; new sb_secret_ keys go in apikey only
  if (prefer) headers.prefer = prefer;
  const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) {
    console.error('Supabase error', method, path, r.status, text.slice(0, 400));
    throw new HttpError(502, 'The account database did not answer. Try again in a moment.');
  }
  return text ? JSON.parse(text) : null;
}

/* ---------- who is this? ---------- */
const seen = new Map(); // token hash -> { user, at }: saves a round trip on bursts of requests
const hashTok = (t) => crypto.createHash('sha256').update(t).digest('hex');

/** The logged-in user ({ id, email }) from the "Authorization: Bearer <token>" header, or throws 401. */
export async function getUser(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) throw new HttpError(401, 'Please log in.');
  const tok = m[1].trim();
  const h = hashTok(tok);
  const hit = seen.get(h);
  if (hit && Date.now() - hit.at < 60_000) return hit.user;
  const r = await fetch(`${SB()}/auth/v1/user`, { headers: { apikey: env('SUPABASE_ANON_KEY'), authorization: `Bearer ${tok}` } });
  if (r.status === 401 || r.status === 403) throw new HttpError(401, 'Your login expired. Log in again.');
  if (!r.ok) { console.error('Supabase auth error', r.status, (await r.text()).slice(0, 300)); throw new HttpError(502, 'Could not check your login. Try again.'); }
  const u = await r.json();
  if (!u?.id) throw new HttpError(401, 'Please log in.');
  const user = { id: u.id, email: u.email || '' };
  seen.set(h, { user, at: Date.now() });
  if (seen.size > 2000) seen.clear();
  return user;
}

/** The account row for this user, created on first use. */
export async function getAccount(user) {
  const rows = await sb('rest/v1/accounts', { query: { id: `eq.${user.id}`, select: '*' } });
  if (rows?.[0]) return rows[0];
  const made = await sb('rest/v1/accounts', { method: 'POST', body: { id: user.id, email: user.email }, prefer: 'return=representation,resolution=ignore-duplicates' });
  if (made?.[0]) return made[0];
  return (await sb('rest/v1/accounts', { query: { id: `eq.${user.id}`, select: '*' } }))[0];
}

export async function accountById(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  return (await sb('rest/v1/accounts', { query: { id: `eq.${id}`, select: '*' } }))?.[0] || null;
}

export async function updateAccount(id, patch) {
  const rows = await sb('rest/v1/accounts', { method: 'PATCH', query: { id: `eq.${id}` }, body: { ...patch, updated_at: new Date().toISOString() }, prefer: 'return=representation' });
  return rows?.[0] || null;
}

/** Logged-in user + their account, or throws. Returns null when logins are not switched on yet. */
export async function requireAccount(req) {
  if (!authLive()) return null;
  const user = await getUser(req);
  return getAccount(user);
}

/** Logged-in user only (no database read): for cheap endpoints. null when logins are off. */
export async function requireUser(req) {
  if (!authLive()) return null;
  return getUser(req);
}

/* ---------- usage ---------- */
/** Counts keys (place ids, websites, call ids) against the plan. Returns the keys that are allowed. */
export async function useKeys(acc, kind, keys) {
  const plan = planOf(acc);
  const list = [...new Set((keys || []).map((k) => String(k).slice(0, 200)).filter(Boolean))];
  if (!list.length) return [];
  const allowed = await sb('rest/v1/rpc/use_keys', { method: 'POST', body: { p_user: acc.id, p_period: periodOf(plan), p_kind: kind, p_keys: list, p_limit: PLANS[plan][kind] } });
  return Array.isArray(allowed) ? allowed : [];
}

const NOUN = { dials: 'answered calls', calls: 'practice calls', preps: 'call preps', leads: 'leads' };
/** One key that must be allowed, or a clear "upgrade" error. */
export async function useOne(acc, kind, key) {
  const ok = await useKeys(acc, kind, [key]);
  if (ok.length) return;
  const plan = planOf(acc);
  if (!PLANS[plan][kind]) throw new HttpError(402, `${NOUN[kind][0].toUpperCase()}${NOUN[kind].slice(1)} are not part of the free trial. Pick a plan to unlock them.`);
  throw new HttpError(402, `You have used all your ${NOUN[kind]} ${plan === 'trial' ? 'in the free trial' : 'this month'}. Upgrade your plan for more.`);
}

/** How much of each kind this account has used in the current period. */
export async function usageOf(acc) {
  const plan = planOf(acc);
  const rows = await sb('rest/v1/rpc/usage_counts', { method: 'POST', body: { p_user: acc.id, p_period: periodOf(plan) } });
  const out = { dials: 0, calls: 0, preps: 0, leads: 0 };
  for (const r of rows || []) if (r.kind in out) out[r.kind] = Number(r.n) || 0;
  return out;
}

/** Remaining count for one kind. */
export async function leftOf(acc, kind) {
  const plan = planOf(acc);
  return Math.max(0, PLANS[plan][kind] - (await usageOf(acc))[kind]);
}
