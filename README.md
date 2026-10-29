# Sales Coach (prototype)

The whole app is one file: `public/index.html` (styles, scripts and sample data). Theme: Obsidian & Gold.
There is no database and no external connection. Data (profile, scored clips, practice calls) is saved in the browser only,
and the AI is switched off, so replies and scores are sample data.

- Deploy: push to GitHub and import into Vercel. `public/` is served as the site.
- Swap colors: edit the PALETTE block at the top of the `<style>` in `public/index.html`.
- Other theme: `extras/index-ocean.html` is the Deep Ocean version. Copy it over `public/index.html` to use it.
- Turn the real AI back on later: set `AI_LIVE: true` in the `CONFIG` block and deploy the `api/` folder with its keys (see `.env.example`).
- Run locally: `npm run dev`, or just open `public/index.html`.
