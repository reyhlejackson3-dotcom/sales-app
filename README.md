# Sales Coach (prototype v0.2)

One file for the app: `public/index.html` (styles, scripts, sample data). Theme: Obsidian & Gold.
Data (profile, scored clips, practice calls, usage, preps, leads, sales log) is saved in the browser only. No database.

## New in v0.2
- **Plans + usage meters:** Free trial, Starter $20, Pro $40, Elite $100. Limits are enforced (practice calls, clips, call preps, leads, difficulty modes). TEST BUILD: no payment. Your usage meters live in Profile -> Settings (gear icon), where "Change plan" opens the Plans screen to switch tiers and "Reset usage (test)" clears the counters. The app starts on Elite.
- **Three tabs in the bottom bar:** Leads, Prep and Log, each its own tool.
- **Call prep:** `api/prep.js`. Reads the business's own website (home + up to 2 more pages) and has Haiku write pains + a short script. Counts once per business per month.
- **Lead finder:** `api/leads.js`. Google Places Text Search (New). Sample leads without a key. READ THE WARNING AT THE TOP OF THAT FILE: Google's terms may not allow this for paying customers. The lead source is isolated in `fromSource()` so it can be swapped.
- **Sales log:** two taps per call. Pro gets basic stats, Elite adds revenue, conversion rates and a weekly goal.

## Run / deploy
- Deploy: push to GitHub and import into Vercel. `public/` is served as the site. Keys go in Vercel env vars (see `.env.example`).
- Local: `npm run dev` (reads a `.env` file if you create one), or open `public/index.html` for the screens without the AI.
- The AI is on when `AI_LIVE: true` in the `CONFIG` block of `index.html`.
- Swap colors: edit the PALETTE block at the top of the `<style>`.
