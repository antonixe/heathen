# Velocity Desk

A local-first release room for one analyst. Velocity Desk tracks the view velocity of YouTube releases in near real-time: it polls the YouTube Data API v3 from your browser, stores every observation locally, and turns them into velocity windows, surge detection, and milestone probability forecasts.

There is no backend and no account. Everything — observations, milestones, notes, settings — lives in your browser's IndexedDB.

## Features

- **Release rundown** — one continuous register of tracked releases with live view counts, 5m/30m velocity windows, targets, and next-poll times.
- **Adaptive polling** — a Web Worker schedules polls by measured velocity (30s for surging releases down to 15m for idle ones), with exponential backoff on errors and multi-tab leader election so only one tab spends quota.
- **Milestone forecasts** — decay-curve fitting, batch-flush detection, and sample-quality scoring produce a probability that a release hits its target by the deadline, with confidence reasons. Predictions are recorded and calibrated against actual outcomes over time.
- **Evidence workspace** — per-release charts, session logs, notes, milestone history, and comparison views with explicit baseline alignment.
- **Data ownership** — validated JSON export/import, storage-persistence protection, backup reminders, and history compaction.
- **Light and dark themes** — toggle from the command bar, or follow the system preference (Settings → Appearance); the choice applies before first paint.

## Setup

Requires Node 20+.

```sh
npm install
npm run dev
```

### YouTube API key

Polling needs a YouTube Data API v3 key:

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/) and enable **YouTube Data API v3**.
2. Create an API key under **Credentials**.
3. In Velocity Desk, open **Settings → API** and paste the key.

The default free quota is 10,000 units/day; each poll costs 1 unit. Velocity Desk tracks usage and pauses polling automatically near the limit.

> **Note:** the API key is stored in plaintext in your browser's IndexedDB, like any client-side-only app. Use a key restricted to the YouTube Data API (and ideally to your origin), and don't use this on a shared machine. Database exports exclude the key by default.

### Data durability

Data lives only in the browser profile you use. Polling runs only while a tab is open and the device is awake — gaps are detected and surfaced as "observation gaps". Export a backup regularly (**Settings → Data**); the app reminds you when one is due.

### Cloud collector (optional)

A Vercel serverless function ([api/collect.js](api/collect.js)), triggered every ~10 minutes by a free [cron-job.org](https://cron-job.org) job, polls YouTube even while your browser is closed, so gaps get coarse fill instead of nothing. It appends snapshots to a `data` branch through the GitHub contents API (kept separate from `main` so nothing redeploys); on app load, `src/utils/backfill.js` fetches them and replays anything newer than each video's last local observation through the normal ingestion path.

The watchlist syncs automatically: whenever the tracked set changes in the app, `src/utils/watchlistSync.js` pushes `watchlist.json` to the `data` branch through the GitHub contents API.

To enable it:

1. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) scoped to **only this repository** with **Contents: read and write** (nothing else). Paste it in **Settings → API → GitHub token** in the app (stored in plaintext in IndexedDB like the YouTube key; excluded from backups).
2. In Vercel → project → **Settings → Environment Variables**, add `YOUTUBE_API_KEY` (the same key the app uses), `GITHUB_TOKEN` (the PAT from step 1, or a second one like it), and `CRON_SECRET` (any long random string), then redeploy.
3. At [cron-job.org](https://cron-job.org), create a job hitting `https://<your-app>.vercel.app/api/collect` every 10 minutes with a request header `Authorization: Bearer <CRON_SECRET>`.
4. The repo must be public for the client to fetch `raw.githubusercontent.com/.../data/snapshots.json`.

Collector quota is ~150 units/day for up to 50 videos (1 unit per run) and is not counted by the in-app quota meter.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Run Vitest in watch mode |
| `npm run test:run` | Run the test suite once |
| `npm run lint` | Run ESLint |

## Architecture

| Layer | Where | Notes |
| --- | --- | --- |
| Data | `src/db/db.js` | Dexie (IndexedDB), versioned migrations, denormalized per-video summaries |
| Polling | `src/workers/poller.worker.js` | Web Worker owns all timers; adaptive tiers, backoff, quota handling |
| Bridge | `src/hooks/usePoller.js` | Worker messages → DB writes, quota accounting, notifications |
| Analytics | `src/utils/` | Velocity windows, decay fitting, milestone probability, calibration |
| UI | `src/components/` | React 18 + Tailwind 4 + shadcn/radix; design rules in `DESIGN.md` |

Tests live next to their modules (`*.test.js` for pure logic, `*.test.jsx` with jsdom + Testing Library for components).
