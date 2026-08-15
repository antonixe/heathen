-- Server-side store for the poller. Single user, so no user_id: access is gated by a bearer
-- token rather than accounts. Adding a user_id column later is additive.

create table if not exists tracks (
  video_id      text primary key,
  title         text,
  channel_name  text,
  thumbnail_url text,
  custom_label  text,
  tags          text,                                  -- comma separated, mirrors the client
  status        text    not null default 'active',
  poll_interval integer not null default 300,
  poll_state    text             default 'idle',
  error_message text,
  added_at      integer not null,
  updated_at    integer not null
);

-- Append-only. (video_id, ts) is the natural key, which is what makes syncing a union rather
-- than a merge. Deliberately stores the raw count only: delta and velocity are derived on read,
-- because computing them at insert time is what corrupts them when rows arrive out of order.
create table if not exists samples (
  video_id   text    not null,
  ts         integer not null,
  view_count integer not null,
  primary key (video_id, ts)
);

create index if not exists samples_ts on samples (ts);
create index if not exists samples_video_ts on samples (video_id, ts);

create table if not exists meta (
  key   text primary key,
  value text
);
