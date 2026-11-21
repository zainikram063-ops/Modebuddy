-- ModeBuddy: skills that each user makes themselves
create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  icon text not null default 'spark',
  mode text not null default 'any' check (mode in ('any','buddy','kodra','edura')),
  when_to_use text not null check (char_length(when_to_use) between 5 and 300),
  instructions text not null check (char_length(instructions) between 10 and 8000),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists skills_user on public.skills (user_id, created_at);
alter table public.skills enable row level security;
drop policy if exists "own skills" on public.skills;
create policy "own skills" on public.skills for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
