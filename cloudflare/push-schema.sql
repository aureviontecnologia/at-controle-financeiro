create table if not exists push_subscriptions (
  id text primary key,
  household_id text not null,
  user_id text not null,
  platform text not null check (platform in ('expo', 'web')),
  subscription_key text not null,
  token text,
  endpoint text,
  p256dh text,
  auth text,
  device_label text not null,
  enabled integer not null default 1,
  created_at text not null,
  updated_at text not null,
  unique (user_id, subscription_key)
);

create index if not exists push_subscriptions_household_enabled
on push_subscriptions(household_id, enabled);

create table if not exists push_dispatch_rate (
  user_id text not null,
  minute_bucket text not null,
  request_count integer not null default 1,
  primary key (user_id, minute_bucket)
);
