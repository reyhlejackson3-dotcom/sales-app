# Convertd / Sales Coach (prototype v0.3)

One file for the app: `public/index.html` (styles, scripts, sample data). Theme: Obsidian & Gold.
Data (profile, scored calls, usage, preps, leads, sales log) is saved in the browser only. No database yet.

## New in v0.3: dial from the app
- **Dial tab = the master workspace.** Find a lead, prep the call, call from the app (recorded on two channels), and get the call transcribed and graded, all in one tab. Practice, Prep and Log remain their own tabs.
- **Clip uploads are gone** (the Score tab and its usage meter). Every real call is recorded and graded in-app.
- **New plans (all tools in every plan, tiers differ on volume):** Starter $29 (100 answered calls), Pro $69 (250), Elite $149 (600). Practice calls 5 / 10 / 25. Each answered call comes with a lead, a prep, a recording and a grade, so leads and preps match the call count. Sales log: basic / full / full + weekly goals. Free trial: 1 practice call, 3 preps, 20 leads, no real dialing.
- **What counts as an answered call:** the prospect's phone is picked up (voicemail included). Rings, busy and failed calls cost nothing and don't count. Answered calls under `CONFIG.MIN_GRADE_SEC` (30s) count but aren't transcribed or graded.
- **Calling numbers:** each user gets their own Twilio number (Settings, or the first time they press Call).
- **No Twilio keys = demo mode.** Calls are simulated and the transcript is a sample, so you can test the whole flow for free. See `TWILIO-SETUP.md` to go live.
- Real-call grades are saved to Profile as "Real call".

## Run / deploy
- Deploy: push to GitHub and import into Vercel. `public/` is served as the site. Keys go in Vercel env vars (see `.env.example`).
- Local: `npm run dev` (reads a `.env` file if you create one), or open `public/index.html` for the screens without the AI.
- Swap colors: edit the PALETTE block at the top of the `<style>`.

## Still prototype-only
Plan limits are enforced in the browser (no accounts yet), and "Change plan" just switches the limits. The calling endpoints are locked with one shared `APP_ACCESS_CODE`; replace that with real logins before customers use it. Read the last section of `TWILIO-SETUP.md`.
