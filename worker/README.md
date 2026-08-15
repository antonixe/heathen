# Velocity Desk poller

Polls YouTube on a schedule and stores samples in Cloudflare D1, so tracking continues while
every browser is closed. The web app is unchanged and still polls for itself — this runs
alongside it until you're satisfied it works, then the client side gets switched off.

## Why it costs almost nothing

`videos.list` accepts 50 ids per request and still costs **one** quota unit. The poller sends the
whole roster in one call, so a 5-minute schedule costs **288 units a day regardless of how many
videos you track** — under 3% of the 10,000/day budget. The browser poller spends one unit per
video per cycle, so this is cheaper the moment you track more than one.

## Setup

Requires a Cloudflare account. Run everything from this directory.

### Which wrangler

Wrangler 4 requires **Node 22+**. On Node 20 it refuses to start, so pin v3 — verified working
here, and it supports everything this Worker uses (D1, cron triggers, secrets):

```bash
npx wrangler@3 login
```

On Node 22 or newer, drop the pin and use `npx wrangler@latest` instead. `compatibility_date`
is deliberately set to a past date so both lines accept it.

Create the database, then paste the printed `database_id` into `wrangler.toml`:

```bash
npx wrangler@3 d1 create velocity-desk
```

Apply the schema:

```bash
npx wrangler@3 d1 execute velocity-desk --remote --file=./schema.sql
```

Set the two secrets. `YOUTUBE_API_KEY` is the key currently in the app's Settings;
`SYNC_TOKEN` is any long random string you invent — the app will send it to read and write.

```bash
npx wrangler@3 secret put YOUTUBE_API_KEY
npx wrangler@3 secret put SYNC_TOKEN
```

Deploy:

```bash
npx wrangler@3 deploy
```

## Prove it works

Health needs no token:

```bash
curl https://velocity-desk-poller.<your-subdomain>.workers.dev/health
```

Seed a track and force a poll immediately rather than waiting for the cron:

```bash
curl -X POST https://velocity-desk-poller.<your-subdomain>.workers.dev/tracks -H "authorization: Bearer $SYNC_TOKEN" -H "content-type: application/json" -d "{\"videoId\":\"dQw4w9WgXcQ\"}"
```

```bash
curl -X POST https://velocity-desk-poller.<your-subdomain>.workers.dev/poll -H "authorization: Bearer $SYNC_TOKEN"
```

Then read back what it stored:

```bash
curl "https://velocity-desk-poller.<your-subdomain>.workers.dev/samples?since=0" -H "authorization: Bearer $SYNC_TOKEN"
```

Leave it overnight with the laptop shut and check `/samples` again in the morning. That is the
whole point of this thing, and it is the only test that really counts.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | liveness, no auth |
| GET | `/samples?since=<ms>&limit=<n>` | rows newer than a timestamp, for incremental pull |
| GET | `/tracks` | roster plus today's quota usage |
| POST | `/tracks` | upsert one track |
| POST | `/poll` | run a poll now |

All except `/health` require `Authorization: Bearer <SYNC_TOKEN>`.

## Notes

`src/index.js` imports the YouTube client and the quota-day helper from the app's `src/utils/`,
so there is one implementation of each rather than a fork that drifts.

`samples` stores the raw view count only. Delta and velocity are derived on read: computing them
at insert time is what corrupts them when rows arrive out of order.
