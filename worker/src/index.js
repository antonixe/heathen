// shared with the browser app rather than forked: one YouTube client, one quota-day rule
import { fetchYouTubeVideos } from '../../src/utils/youtube.js'
import { pacificDate } from '../../src/utils/day.js'

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' },
})

const authorised = (request, env) =>
  Boolean(env.SYNC_TOKEN) && request.headers.get('authorization') === `Bearer ${env.SYNC_TOKEN}`

async function bumpQuota(env, units) {
  const key = `quota:${pacificDate()}`
  const row = await env.DB.prepare('select value from meta where key = ?').bind(key).first()
  const next = Number(row?.value || 0) + units
  await env.DB.prepare('insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value')
    .bind(key, String(next)).run()
  return next
}

// One batched call for the whole roster, then one row per track. Absent ids came back empty from
// YouTube, which means deleted or private — flagged on the track rather than failing the run.
export async function poll(env, now = Date.now()) {
  const { results: tracks = [] } = await env.DB.prepare(
    "select video_id from tracks where status = 'active' and coalesce(poll_state,'') != 'paused'").all()
  const ids = tracks.map(row => row.video_id)
  if (!ids.length) return { polled: 0, stored: 0 }

  let found
  try {
    found = await fetchYouTubeVideos(ids, env.YOUTUBE_API_KEY)
  } catch (error) {
    await env.DB.prepare('update tracks set poll_state = ?, error_message = ?, updated_at = ? where status = \'active\'')
      .bind(String(error.code) === 'QUOTA' ? 'quota' : 'error', error.message?.slice(0, 300) ?? 'Poll failed', now).run()
    throw error
  }

  await bumpQuota(env, Math.ceil(ids.length / 50))

  const writes = []
  for (const videoId of ids) {
    const data = found.get(videoId)
    if (!data) {
      writes.push(env.DB.prepare('update tracks set poll_state = ?, error_message = ?, updated_at = ? where video_id = ?')
        .bind('not-found', 'Video not found or unavailable.', now, videoId))
      continue
    }
    writes.push(env.DB.prepare('insert or ignore into samples (video_id, ts, view_count) values (?, ?, ?)')
      .bind(videoId, now, data.viewCount))
    writes.push(env.DB.prepare(
      'update tracks set title = ?, channel_name = ?, thumbnail_url = ?, poll_state = ?, error_message = null, updated_at = ? where video_id = ?')
      .bind(data.title, data.channelName, data.thumbnailUrl, 'polling', now, videoId))
  }
  await env.DB.batch(writes)
  return { polled: ids.length, stored: found.size }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(poll(env, event.scheduledTime || Date.now()))
  },

  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return json({})
    if (url.pathname === '/health') return json({ ok: true, cron: '*/5 * * * *' })
    if (!authorised(request, env)) return json({ error: 'Unauthorized' }, 401)

    // incremental pull: the client sends its newest local timestamp and gets only what is newer
    if (request.method === 'GET' && url.pathname === '/samples') {
      const since = Number(url.searchParams.get('since') || 0)
      const limit = Math.min(Number(url.searchParams.get('limit') || 5000), 20000)
      const { results = [] } = await env.DB.prepare(
        'select video_id, ts, view_count from samples where ts > ? order by ts limit ?').bind(since, limit).all()
      return json({ samples: results, complete: results.length < limit })
    }

    if (request.method === 'GET' && url.pathname === '/tracks') {
      const { results = [] } = await env.DB.prepare('select * from tracks order by added_at').all()
      const quota = await env.DB.prepare('select value from meta where key = ?').bind(`quota:${pacificDate()}`).first()
      return json({ tracks: results, quotaUsedToday: Number(quota?.value || 0) })
    }

    if (request.method === 'POST' && url.pathname === '/tracks') {
      const body = await request.json().catch(() => null)
      if (!body?.videoId) return json({ error: 'videoId required' }, 400)
      const now = Date.now()
      await env.DB.prepare(`insert into tracks
          (video_id, title, channel_name, thumbnail_url, custom_label, tags, status, poll_interval, added_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(video_id) do update set
          title = coalesce(excluded.title, tracks.title),
          channel_name = coalesce(excluded.channel_name, tracks.channel_name),
          custom_label = excluded.custom_label,
          tags = excluded.tags,
          status = excluded.status,
          poll_interval = excluded.poll_interval,
          updated_at = excluded.updated_at`)
        .bind(body.videoId, body.title ?? null, body.channelName ?? null, body.thumbnailUrl ?? null,
          body.customLabel ?? '', (body.tags || []).join(','), body.status || 'active',
          Number(body.pollInterval) || 300, body.addedAt || now, now).run()
      return json({ ok: true })
    }

    // manual kick, so you can prove the schedule works without waiting five minutes
    if (request.method === 'POST' && url.pathname === '/poll') return json(await poll(env))

    return json({ error: 'Not found' }, 404)
  },
}
