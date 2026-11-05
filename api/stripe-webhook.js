// Stripe tells us here when someone pays, changes plan, cancels or stops paying.
// Set this URL in Stripe: Developers > Webhooks > Add endpoint > https://YOUR-DOMAIN/api/stripe-webhook
// Events: checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted
import { send, HttpError } from './_lib.js';
import { authLive, sb, accountById, updateAccount } from './_auth.js';
import { stripeLive, stripe, verifyWebhook, subFields } from './_stripe.js';
import { twilioLive, releaseNumber } from './_twilio.js';

/** Read the body exactly as Stripe sent it (the signature covers these bytes). Never touch req.body first. */
async function rawBody(req) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > 1_000_000) throw new HttpError(413, 'Too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}

async function accountFor(obj) {
  const byId = await accountById(obj?.metadata?.user_id || obj?.client_reference_id);
  if (byId) return byId;
  const customer = typeof obj?.customer === 'string' ? obj.customer : obj?.customer?.id;
  if (!customer) return null;
  return (await sb('rest/v1/accounts', { query: { stripe_customer_id: `eq.${customer}`, select: '*' } }))?.[0] || null;
}

/** Subscription over: back to the free trial, and give the calling number back so it stops costing money. */
async function endSubscription(acc, sub) {
  const patch = { ...subFields(sub), sub_status: 'canceled', cancel_at_period_end: false };
  if (acc.number_sid && twilioLive()) {
    try { await releaseNumber(acc.number_sid); patch.number = null; patch.number_sid = null; }
    catch (e) { console.error('Could not release number', acc.number_sid, e.message); }
  } else if (acc.number && !acc.number_sid) { patch.number = null; }
  await updateAccount(acc.id, patch);
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'POST only' }); }
    if (!authLive() || !stripeLive()) return send(res, 503, { error: 'Accounts or payments are not configured.' });
    const event = verifyWebhook(await rawBody(req), req.headers['stripe-signature']);
    const obj = event.data?.object || {};

    if (event.type === 'checkout.session.completed' && obj.mode === 'subscription' && obj.subscription) {
      const acc = await accountFor(obj);
      if (acc) {
        const sub = await stripe(`subscriptions/${obj.subscription}`, { method: 'GET' });
        await updateAccount(acc.id, subFields(sub));
      } else console.error('Webhook: no account for checkout', obj.id);
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const acc = await accountFor(obj);
      if (acc && (!acc.stripe_subscription_id || acc.stripe_subscription_id === obj.id || ['active', 'trialing'].includes(obj.status))) {
        if (['canceled', 'incomplete_expired'].includes(obj.status)) await endSubscription(acc, obj);
        else await updateAccount(acc.id, subFields(obj));
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const acc = await accountFor(obj);
      if (acc && (!acc.stripe_subscription_id || acc.stripe_subscription_id === obj.id)) await endSubscription(acc, obj);
    }
    return send(res, 200, { received: true });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error('stripe-webhook', e);
    return send(res, status, { error: e.message || 'Webhook failed' });
  }
}
