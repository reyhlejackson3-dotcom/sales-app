# Twilio setup (Convertd in-app calling)

How it fits together: the browser phone (Twilio Voice SDK) calls Twilio -> Twilio asks `/api/twilio-voice` what to do -> that endpoint dials the prospect and records both sides on separate audio channels -> after hang-up the app pulls the recording, transcribes it (Azure), and grades it (Claude Haiku). No database needed yet.

Console menu names change. If a menu isn't where this says, use the search bar at the top of the Twilio Console.

## 1. Account
1. Sign up at twilio.com, verify your email and phone.
2. **Upgrade to a paid account** (add a card and an initial balance). Trial accounts can only call numbers you have verified and play a "trial account" message, so you can't test properly on one.
3. Put the account under **Shiftable LLC** (company name, not personal), since your Stripe is already there.

## 2. Keys to collect (you need five values)
| Value | Where | Looks like |
|---|---|---|
| Account SID | Console home, "Account Info" | `AC...` |
| Auth Token | Console home, "Account Info" (click to reveal) | 32 chars |
| API Key SID | Account > API keys & tokens > **Create API key** (type: Standard) | `SK...` |
| API Key Secret | Shown **once** when you create the key. Copy it right then | 32 chars |
| TwiML App SID | Step 3 | `AP...` |

The Auth Token is only used to verify that webhooks really came from Twilio. The API key is what the app uses to call Twilio. Never put any of these in `index.html` or GitHub.

## 3. TwiML App (needs a deployed URL first)
Deploy the app to Vercel first (you can use the `*.vercel.app` address before `convertd.app` is connected). Then:
- Voice > Manage > **TwiML Apps** > Create new
- Friendly name: `Convertd browser calling`
- **Voice Request URL:** `https://YOUR-DOMAIN/api/twilio-voice`, method **HTTP POST**
- Save, copy the `AP...` SID

## 4. Lock down fraud before anything else
Stolen calling credentials get used for toll fraud within hours. Do these now:
- **Voice > Settings > Geo permissions:** enable **only United States and Canada**. Turn everything else off.
- **Billing > Auto-recharge:** leave OFF until you trust the usage. Set a low balance alert.
- **Usage triggers / alerts:** add a daily spend alert (for example $20 a day while testing).
- The app already refuses non-US/Canada numbers, premium area codes (900, 976, Caribbean) and calls over 30 minutes, but Twilio's own geo block is the backstop.

## 5. Vercel environment variables
Project > Settings > Environment Variables (then redeploy):

| Name | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | `AC...` |
| `TWILIO_AUTH_TOKEN` | your auth token |
| `TWILIO_API_KEY_SID` | `SK...` |
| `TWILIO_API_KEY_SECRET` | the secret |
| `TWILIO_TWIML_APP_SID` | `AP...` |
| `APP_ACCESS_CODE` | any long random phrase. **Required**: with no code set, a production deploy refuses to place calls |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | you already have these |

Optional: `MAX_NUMBERS` (default 25), `MAX_CALL_MINUTES` (30), `MAX_GRADE_MINUTES` (20), `PUBLIC_BASE_URL` (set to your domain if you ever see "403 bad signature" in the Vercel logs), `REP_CHANNEL` (see step 7), `RECORD_DISCLOSURE` (leave on).

With the five `TWILIO_*` values missing, the app runs calls as a **free demo** (simulated call, sample transcript). That is how it works right now.

## 6. Numbers: how each user gets one
In the app, **Dial > Call > Get a number** (or Profile > Settings > Calling number) searches your Twilio account for numbers in the area code they choose and buys one. Each costs about **$1.15/month** to hold, billed to you.
- The cap `MAX_NUMBERS` stops runaway buying. Raise it as you add customers.
- **When a customer cancels, release their number** (Settings > Give up number does it; you'll want this automatic once there are accounts). Otherwise you keep paying for it.
- Callbacks to a user's number currently get a polite "outgoing calls only" message (`api/twilio-voice.js`, mode=inbound). Ringing the user's browser or forwarding to their cell is a later feature.

## 7. First test (15 minutes, your own cell phone)
1. Open the deployed app, Dial tab, search any lead, press Call, enter the access code, get a number.
2. Replace the lead's phone number in the box with **your own cell** and press Call now.
3. Check, in order:
   - The app shows "Calling..." and your cell rings.
   - When you pick up you hear **"This call is being recorded for quality and training"**, then you are connected, and the app flips to "Connected" within about 2 seconds.
   - Talk for 40+ seconds (calls under 30 seconds are counted but not graded). Hang up.
   - Within about a minute the grade appears and the call is saved to Profile.
4. Read the transcript on the grade. **If "Rep" and "Prospect" are swapped, set `REP_CHANNEL=1` in Vercel** and redeploy. I assumed the person placing the call is audio channel 0 but could not verify that without a live call.
5. Call your cell and **don't answer**: it should say "No answer" and NOT use up one of the answered calls.
6. Look at the Twilio invoice/usage the next day: the cost per call should match the table in the pricing plan (about $0.018/min for the call, $0.0025/min recording). Also check Azure: if dual-channel files are billed as two audio streams, transcription costs double and the margins need a rerun.

## 8. Before real customers (not optional)
- **Replace the access code with real logins.** Right now anyone who has `APP_ACCESS_CODE` can place calls on your bill, and usage limits live in the browser. When Supabase accounts are in, check the user's login token in `requireAccess()` (`api/_twilio.js`), look up their number server-side instead of trusting the browser, and count usage in the database.
- **Recording consent.** Colorado is one-party consent, but your users will call prospects in all-party states (California, Florida, Illinois, Washington and others). The spoken notice is on by default; talk to a lawyer before turning it off or changing the wording.
- **Telemarketing rules.** Calling-hours rules (8am-9pm in the prospect's time zone) and Do Not Call lists apply to some cold calling, and B2B is treated differently than consumer calls. Decide what the product enforces and what its terms put on the user. I'm not a lawyer.
- **Spam labeling.** Brand-new numbers calling strangers get flagged "Scam Likely" quickly. Look into Twilio's Business Profile (Trust Hub), SHAKEN/STIR and Voice Integrity for your account. I haven't verified current pricing or requirements for these, check Twilio's docs. This affects your customers' results more than any feature.
- **Google Places terms.** `api/leads.js` has a warning at the top: Google's terms may not allow prospecting lists for paying customers. Get that answered or swap the lead source before charging for it.

## Files
`api/twilio.js` (token, call status, numbers, transcription), `api/twilio-voice.js` (Twilio's webhook: dialing, recording notice, callbacks), `api/_twilio.js`, `api/_demo.js`, and `public/vendor/twilio.min.js` (Twilio Voice SDK 2.18.5). With accounts on (v0.4), each user's number is stored on their account and released when their plan ends; see `ACCOUNTS-AND-PAYMENTS.md`.
