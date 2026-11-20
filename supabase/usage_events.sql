-- ModeBuddy free plan: one row per Buddy or Kodra message, used for the 5-hour limits
create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  created_at timestamptz not null default now()
);
create index if not exists usage_events_user_bucket_time on public.usage_events (user_id, bucket, created_at desc);
alter table public.usage_events enable row level security;
drop policy if exists "read own usage" on public.usage_events;
create policy "read own usage" on public.usage_events for select using (auth.uid() = user_id);
drop policy if exists "add own usage" on public.usage_events;
create policy "add own usage" on public.usage_events for insert with check (auth.uid() = user_id);
