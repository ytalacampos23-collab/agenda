-- Watt-Wise: esquema inicial. Execute no SQL Editor do Supabase somente após revisar.
create extension if not exists pgcrypto;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  category text not null,
  due_date date not null,
  due_time time,
  priority text not null default 'Média' check (priority in ('Baixa','Média','Alta','Urgente')),
  status text not null default 'A fazer' check (status in ('A fazer','Em andamento','Concluído')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  visit_date date not null,
  title text not null default 'Visita à Cemig',
  participants text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.visit_topics (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  responsible text,
  protocol text,
  due_date date,
  status text not null default 'Pendente' check (status in ('Pendente','Em análise','Resolvido','Não se aplica')),
  observations text,
  origin_topic_id uuid references public.visit_topics(id),
  created_at timestamptz not null default now()
);

create table if not exists public.topic_transfers (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.visit_topics(id) on delete cascade,
  from_visit_id uuid not null references public.visits(id) on delete cascade,
  to_visit_id uuid not null references public.visits(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(topic_id, to_visit_id)
);

alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.visits enable row level security;
alter table public.visit_topics enable row level security;
alter table public.topic_transfers enable row level security;

create policy "users manage own tasks" on public.tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users manage own task events" on public.task_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users manage own visits" on public.visits for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users manage own topics" on public.visit_topics for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users manage own transfers" on public.topic_transfers for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
