-- ModeBuddy Lura 1.0 schema
create table if not exists public.conversations (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  mode_id text not null default 'default',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_user_updated on public.conversations(user_id, updated_at desc);

create table if not exists public.messages (
  id text primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system','data')),
  content text not null default '',
  parts jsonb,
  attachments jsonb,
  created_at timestamptz not null default now()
);
create index if not exists messages_convo_created on public.messages(conversation_id, created_at);

create table if not exists public.modes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  icon text not null default '✦',
  theme text not null default 'light' check (theme in ('light','dark','warm')),
  accent text not null default '#c4ff2e',
  tagline text,
  instructions text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mode_id text not null,
  title text not null,
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists knowledge_user_mode on public.knowledge(user_id, mode_id);

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  content text not null check (char_length(content) <= 1000),
  created_at timestamptz not null default now()
);

alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.modes         enable row level security;
alter table public.knowledge     enable row level security;
alter table public.memories      enable row level security;

create policy "own conversations" on public.conversations for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own messages" on public.messages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and exists (
    select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));
create policy "own modes"     on public.modes     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own knowledge" on public.knowledge for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own memories"  on public.memories  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Attachments (images / PDFs). Public read via unguessable paths; users write only to their folder.
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', true)
  on conflict (id) do nothing;
create policy "upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own files" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
