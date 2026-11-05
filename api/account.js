// Accounts and billing in one function (Vercel's free plan allows 12 functions per project).
//   action: config    public settings the page needs to start (no login needed)
//   action: me        the logged-in user's plan, billing state, calling number and usage
//   action: checkout  start a Stripe Checkout page for a plan
//   action: change    switch an active subscription to another plan (prorated)
//   action: cancel    cancel at the end of the paid month (the "Cancel subscription" button)
//   action: resume    undo a cancel before the month ends
//   action: portal    Stripe's billing page: card, invoices, receipts
import { handle, readJson, send, HttpError } from './_lib.js';
import { authLive, getUser, getAccount, updateAccount, planOf, usageOf, PLANS, PAID } from './_auth.js';
import { stripeLive, stripe, priceFor, subFields } from './_stripe.js';
import { baseUrl } from './_twilio.js';

const env = (k) => (process.env[k] || '').trim();

function view(acc, usage) {
  const plan = planOf(acc);
  return {
    id: acc.id,
    email: acc.email,
    plan,
    paidPlan: acc.plan,
    status: acc.sub_status || null,
    cancelAtPeriodEnd: Boolean(acc.cancel_at_period_end),
    periodEnd: acc.period_end,
    hasBilling: Boolean(acc.stripe_customer_id),
    number: acc.number ? { number: acc.number, sid: acc.number_sid } : null,
    usage,
    limits: PLANS[plan],
  };
}

async function liveSub(acc) {
  if (!acc.stripe_subscription_id) return null;
  const sub = await stripe(`subscriptions/${acc.stripe_subscription_id}`, { method: 'GET' });
  return ['canceled', 'incomplete_expired'].includes(sub.status) ? null : sub;
}

export default handle(async (req, res) => {
  const b = await readJson(req, 20_000);
  const action = String(b.action || '');

  if (action === 'config') {
    return send(res, 200, {
      auth: authLive(),
      supabaseUrl: authLive() ? env('SUPABASE_URL') : null,
      supabaseKey: authLive() ? env('SUPABASE_ANON_KEY') : null,
      payments: stripeLive() && PAID.every((p) => priceFor(p)),
    });
  }

  if (!authLive()) throw new HttpError(503, 'Accounts are not switched on yet. Set the SUPABASE_* variables in Vercel.');
  const user = await getUser(req);
  let acc = await getAccount(user);
  if (acc.email !== user.email && user.email) acc = (await updateAccount(acc.id, { email: user.email })) || acc;

  if (action === 'me') {
    // Right after checkout the webhook can lag a few seconds; sync:true reads the subscription straight from Stripe.
    if (b.sync === true && stripeLive() && acc.stripe_customer_id) {
      const list = await stripe('subscriptions', { method: 'GET', query: { customer: acc.stripe_customer_id, status: 'all', limit: '1' } });
      const sub = list.data?.[0];
      if (sub) acc = (await updateAccount(acc.id, subFields(sub))) || acc;
    }
    return send(res, 200, view(acc, await usageOf(acc)));
  }

  if (!stripeLive()) throw new HttpError(503, 'Payments are not switched on yet. Set STRIPE_SECRET_KEY and the STRIPE_PRICE_* variables in Vercel.');
  const base = baseUrl(req);

  if (action === 'checkout') {
    const plan = String(b.plan || '');
    if (!PAID.includes(plan) || !priceFor(plan)) throw new HttpError(400, 'Pick Starter, Pro or Elite.');
    if (await liveSub(acc)) throw new HttpError(409, 'You already have a plan. Use "Switch" to change it.');
    let customer = acc.stripe_customer_id;
    if (!customer) {
      const c = await stripe('customers', { form: { email: acc.email || undefined, metadata: { user_id: acc.id } } });
      customer = c.id;
      acc = (await updateAccount(acc.id, { stripe_customer_id: customer })) || acc;
    }
    const s = await stripe('checkout/sessions', {
      form: {
        mode: 'subscription',
        customer,
        client_reference_id: acc.id,
        line_items: [{ price: priceFor(plan), quantity: 1 }],
        allow_promotion_codes: 'true',
        subscription_data: { metadata: { user_id: acc.id, plan } },
        metadata: { user_id: acc.id, plan },
        success_url: `${base}/?checkout=done#/profile`,
        cancel_url: `${base}/#/plans`,
      },
    });
    return send(res, 200, { url: s.url });
  }

  if (action === 'change') {
    const plan = String(b.plan || '');
    if (!PAID.includes(plan) || !priceFor(plan)) throw new HttpError(400, 'Pick Starter, Pro or Elite.');
    const sub = await liveSub(acc);
    if (!sub) throw new HttpError(409, 'You do not have an active plan yet. Choose one first.');
    const item = sub.items?.data?.[0];
    if (item?.price?.id === priceFor(plan)) return send(res, 200, view(acc, await usageOf(acc)));
    const upd = await stripe(`subscriptions/${sub.id}`, {
      form: { items: [{ id: item.id, price: priceFor(plan) }], proration_behavior: 'create_prorations', cancel_at_period_end: 'false', metadata: { user_id: acc.id, plan } },
    });
    acc = (await updateAccount(acc.id, subFields(upd))) || acc;
    return send(res, 200, view(acc, await usageOf(acc)));
  }

  if (action === 'cancel' || action === 'resume') {
    const sub = await liveSub(acc);
    if (!sub) throw new HttpError(409, 'There is no active plan to change.');
    const upd = await stripe(`subscriptions/${sub.id}`, { form: { cancel_at_period_end: action === 'cancel' ? 'true' : 'false' } });
    acc = (await updateAccount(acc.id, subFields(upd))) || acc;
    return send(res, 200, view(acc, await usageOf(acc)));
  }

  if (action === 'portal') {
    if (!acc.stripe_customer_id) throw new HttpError(409, 'There is no billing history yet.');
    const p = await stripe('billing_portal/sessions', { form: { customer: acc.stripe_customer_id, return_url: `${base}/#/profile` } });
    return send(res, 200, { url: p.url });
  }

  throw new HttpError(400, 'Unknown action.');
});
