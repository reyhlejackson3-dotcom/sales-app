# Sales Coach

AI sales training with two features: **score your calls** (upload a clip, get graded) and **run a test call** (live practice against an AI prospect). Your profile is a history of every scored session. Plain HTML/JS front end, four Vercel serverless functions, Supabase for data. No build step.

## Deploy

1. **Supabase**: open your project, go to SQL Editor, paste `supabase.sql` (kept outside this zip), and run it. This creates the tables, locks them to the test account, and adds the `claudio` profile with sample history.
2. **GitHub**: create a repo and upload the contents of this folder (so `package.json` is at the repo root).
3. **Vercel**: import the repo. Leave the framework as "Other" and the build command empty. Then add the environment variables below and redeploy.

## Environment variables (Vercel, Settings, Environment Variables)

| Variable | What it does | If missing |
|---|---|---|
| `ANTHROPIC_API_KEY` | Grades calls and plays the prospect (Haiku 5.5) | Sample grades and scripted prospect |
| `ANTHROPIC_MODEL` | Optional, defaults to `claude-haiku-5-5` | |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | Transcribes uploaded clips and your voice | Sample transcript |
| `ELEVENLABS_API_KEY` | The prospect's voice | Browser voice |
| `ELEVENLABS_VOICE_ID` | Default voice (a default is built in) | |
| `ELEVENLABS_VOICE_EASY/MEDIUM/HARD/EXTREME` | Optional voice per difficulty | |

Each missing key only switches that one feature to demo mode, and the app shows a "Demo mode" banner. The Supabase URL and public key are already in `public/js/config.js`.

## Run locally

`npm run dev`, then open http://localhost:3000. Copy `.env.example` to `.env` to use real keys.

## Test account

There is no login. Everyone is **claudio**. Settings, then "Clear test data" empties the history. If Supabase can't be reached (for example the SQL hasn't been run), the app saves to the browser instead and says so in a banner.

## Before you share the link

- The API functions have no login, only a basic per-IP limit. Anyone who finds the URL could spend your Anthropic, Azure and ElevenLabs credit. Keep the URL private and set spend limits in each provider's dashboard.
- The database policies allow anyone with the public key to read and write the claudio rows. Replace them with real per-user policies when you add login.
- Only transcripts and scores are stored. Uploaded audio and video never leave the browser except for transcription.

## Tuning

- Prospect personalities, grading strictness and score categories: `api/_prompts.js`
- Longest scored clip (default 2:00, limited by Vercel's 4.5 MB request size): `MAX_CLIP_SECONDS` in `public/js/config.js`
- Colors: CSS variables at the top of `public/css/styles.css`
