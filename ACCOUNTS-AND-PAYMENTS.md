# Accounts and payments setup (Convertd v0.4)

What this version adds:
- **Landing page** (white, gold waves) for anyone not logged in: pain-first hero, pricing, and a free-trial section.
- **Logins** with email + password or Google (Supabase). New accounts start on the free trial, no card.
- **Payments** with Stripe Checkout. Plan switches are prorated. **Cancel subscription** is in Profile > Settings: the user keeps the plan until the paid month ends, then drops to the free trial and their calling number is released automatically.
- **Limits are counted on the server** now (answered calls, practice calls, preps, leads), so editing the browser cannot get around them. The shared `APP_ACCESS_CODE` is no longer used once accounts are on.
- **Account setup:** every new account answers three short questions once (name and company, what they sell and their industry and main call type, who they call and where). The answers are saved on the account, so they follow the user to any device, and they pre-fill practice calls, call prep and the lead search.
- Call history and the sales log still live in each user's browser (one space per user). Moving those into the database is the next step.

Order: Supabase first, then Stripe, then Vercel, then test. Until the three `SUPABASE_*` variables are set, the app keeps running exactly as before, so nothing breaks while you set this up. Console menu names change; if a menu isn't where this says, use the dashboard's search.

## 0. Vercel plan (decide first)
Vercel's free Hobby plan is for personal, non-commercial use. Taking payments is commercial, so upgrade the project to **Pro** before you charge anyone (check Vercel's current terms and price). This build uses 10 of the 12 functions Hobby allows, so it also deploys on Hobby for testing.

## 1. Supabase (accounts)
1. supabase.com > **New project**, named `Convertd`. Save the database password somewhere safe.
2. **SQL Editor > New query**: paste all of `supabase/schema.sql` and press **Run**. (Already ran an older copy? Run the new one again; it is safe to re-run and adds the profile column.) You should see the `accounts` and `usage_keys` tables under Table Editor.
3. **Project Settings > API Keys** (it may say "API"):
   - Project URL -> `SUPABASE_URL`
   - publishable key (older projects call it `anon`) -> `SUPABASE_ANON_KEY`
   - secret key (older projects call it `service_role`) -> `SUPABASE_SERVICE_KEY`. Never put this one in the page or GitHub.
4. **Authentication > URL Configuration**:
   - Site URL: `https://sales-app-snowy-pi.vercel.app` (change to `https://convertd.app` once the domain is connected)
   - Redirect URLs: add `https://sales-app-snowy-pi.vercel.app/**` (and later `https://convertd.app/**`)
5. **Google login** (Authentication > Sign In / Providers > Google):
   - In Google Cloud Console: APIs & Services > Credentials > Create credentials > OAuth client ID > Web application.
   - Authorized redirect URI: the callback URL Supabase shows on its Google settings page (looks like `https://YOUR-PROJECT.supabase.co/auth/v1/callback`).
   - Paste the Google Client ID and Client Secret into Supabase and enable Google.
6. **Email**: Supabase asks new users to confirm their email by default. Its built-in email sender is only meant for testing and has a low hourly limit, so set up custom SMTP (Authentication > Emails > SMTP, for example with Resend or Postmark) before launch. I have not checked current limits; look at Supabase's docs.

## 2. Stripe (payments)
Do all of this in **Test mode** first (toggle at the top of the dashboard). Your Stripe account is under Shiftable LLC.
1. **Product catalog > Add product**, three times:
   - Convertd Starter: $29.00, recurring, monthly
   - Convertd Pro: $69.00, recurring, monthly
   - Convertd Elite: $149.00, recurring, monthly
   Open each product and copy its **price ID** (`price_...`) -> `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ELITE`.
2. **Developers > API keys**: Secret key (`sk_test_...`) -> `STRIPE_SECRET_KEY`.
3. **Developers > Webhooks > Add endpoint** (may be called "destination"):
   - URL: `https://sales-app-snowy-pi.vercel.app/api/stripe-webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the **signing secret** (`whsec_...`) -> `STRIPE_WEBHOOK_SECRET`.
4. **Settings > Billing > Customer portal**: turn it on and save. This powers the "Billing and invoices" button (card changes, receipts). Cancelling works from the app's own button either way.
5. Promo codes: checkout accepts them. Create them in Product catalog > Coupons if you want launch discounts.

## 3. Vercel environment variables
Project > Settings > Environment Variables, then **redeploy**:

| Name | Value |
|---|---|
| `SUPABASE_URL` | from step 1.3 |
| `SUPABASE_ANON_KEY` | publishable key |
| `SUPABASE_SERVICE_KEY` | secret key |
| `STRIPE_SECRET_KEY` | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |
| `STRIPE_PRICE_STARTER` / `_PRO` / `_ELITE` | the three `price_...` ids |

Keep all your existing variables (Twilio, Azure, Anthropic, ElevenLabs, Google Places). `APP_ACCESS_CODE` can stay; it is ignored while accounts are on.

**Upload note:** this version deletes `api/twilio-token.js`, `api/twilio-result.js`, `api/twilio-number.js` and `api/twilio-transcribe.js` (merged into `api/twilio.js`). Delete those four from GitHub, or the old unprotected versions stay live.

## 4. Test it (about 15 minutes, test mode)
1. Open the site logged out: you should see the white landing page.
2. **Try it free** > create an account. Confirm the email if asked. You land in Practice on the free trial.
3. Profile > Settings shows "Free trial" with usage bars. The Call tab should show "Time to upgrade".
4. Plans (or the landing page) > **Choose Pro** > Stripe checkout > card `4242 4242 4242 4242`, any future date, any CVC.
5. You come back to Profile and see "You are on Pro". Settings shows "Renews on ...".
6. Call tab > Get a number > call your own phone. Settings usage shows 1 answered call.
7. Settings > **Cancel subscription** > confirm. Settings now says "Cancelled. You keep Pro until ...". Press **Keep my plan** to undo.
8. Stripe > Developers > Webhooks > your endpoint should show 200 responses. If they show 400 "Bad signature", the signing secret is wrong.
9. To see the end-of-month path: in Stripe, open the test subscription and **Cancel immediately**. Within seconds the account drops to the free trial and the Twilio number is released (check Twilio > Phone Numbers).

## 5. Going live
Switch Stripe to live mode and redo step 2 there (live products have new price ids, live keys and a new webhook secret), then update the five `STRIPE_*` variables in Vercel and redeploy.

## What I could not test
I tested everything against fake versions of Supabase, Stripe and Twilio (60 server checks plus the full flow in a browser: landing, sign up, checkout, cancel, resume, log out, log in). I have not run it against your real Supabase, Stripe or Google accounts. The first real run is the real test; send me any error text.
