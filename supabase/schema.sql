-- Watt-Wise | Banco de dados e segurança
-- Execute este arquivo no SQL Editor do Supabase. O script foi preparado para
-- complementar a estrutura inicial sem apagar registros existentes.

create extension if not exists pgcrypto;

-- 1) Estruturas principais
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
  task_id uuid not null,
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.visit_topics (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  responsible text,
  protocol text,
  due_date date,
  status text not null default 'Pendente' check (status in ('Pendente','Em análise','Resolvido','Não se aplica')),
  observations text,
  origin_topic_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.topic_transfers (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null,
  from_visit_id uuid not null,
  to_visit_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(topic_id, to_visit_id)
);

-- Programação de um tópico para uma data ou ata futura.
-- O tópico original permanece único; a programação não cria cópia.
create table if not exists public.topic_schedules (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  target_date date not null,
  target_visit_id uuid,
  created_at timestamptz not null default now(),
  canceled_at timestamptz,
  note text
);

create table if not exists public.visit_topic_events (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null,
  visit_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

-- 2) Compatibilidade com a primeira versão e integridade entre registros do mesmo usuário
alter table public.tasks add column if not exists deleted_at timestamptz;
alter table public.tasks add column if not exists updated_at timestamptz not null default now();
alter table public.visits add column if not exists updated_at timestamptz not null default now();
alter table public.visit_topics add column if not exists updated_at timestamptz not null default now();

create unique index if not exists visits_id_user_uidx on public.visits(id,user_id);
create unique index if not exists topics_id_user_uidx on public.visit_topics(id,user_id);
create unique index if not exists tasks_id_user_uidx on public.tasks(id,user_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname='visit_topics_visit_owner_fk') then
    alter table public.visit_topics add constraint visit_topics_visit_owner_fk
      foreign key (visit_id,user_id) references public.visits(id,user_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='visit_topics_origin_owner_fk') then
    alter table public.visit_topics add constraint visit_topics_origin_owner_fk
      foreign key (origin_topic_id,user_id) references public.visit_topics(id,user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname='task_events_task_owner_fk') then
    alter table public.task_events add constraint task_events_task_owner_fk
      foreign key (task_id,user_id) references public.tasks(id,user_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='topic_transfers_topic_owner_fk') then
    alter table public.topic_transfers add constraint topic_transfers_topic_owner_fk
      foreign key (topic_id,user_id) references public.visit_topics(id,user_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='topic_transfers_from_visit_owner_fk') then
    alter table public.topic_transfers add constraint topic_transfers_from_visit_owner_fk
      foreign key (from_visit_id,user_id) references public.visits(id,user_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='topic_transfers_to_visit_owner_fk') then
    alter table public.topic_transfers add constraint topic_transfers_to_visit_owner_fk
      foreign key (to_visit_id,user_id) references public.visits(id,user_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='topic_schedules_topic_owner_fk') then
    alter table public.topic_schedules add constraint topic_schedules_topic_owner_fk
      foreign key (topic_id,user_id) references public.visit_topics(id,user_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='topic_schedules_visit_owner_fk') then
    alter table public.topic_schedules add constraint topic_schedules_visit_owner_fk
      foreign key (target_visit_id,user_id) references public.visits(id,user_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='visit_topic_events_topic_owner_fk') then
    alter table public.visit_topic_events add constraint visit_topic_events_topic_owner_fk
      foreign key (topic_id,user_id) references public.visit_topics(id,user_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='visit_topic_events_visit_owner_fk') then
    alter table public.visit_topic_events add constraint visit_topic_events_visit_owner_fk
      foreign key (visit_id,user_id) references public.visits(id,user_id) on delete cascade;
  end if;
end $$;

-- 3) Histórico automático de alterações nas atividades
create or replace function public.wattwise_log_task_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_events(task_id,user_id,event_type,new_value)
    values(new.id,new.user_id,'created',to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status then
      insert into public.task_events(task_id,user_id,event_type,old_value,new_value)
      values(new.id,new.user_id,'status_changed',jsonb_build_object('status',old.status),jsonb_build_object('status',new.status));
    end if;
    if old.due_date is distinct from new.due_date or old.due_time is distinct from new.due_time then
      insert into public.task_events(task_id,user_id,event_type,old_value,new_value)
      values(new.id,new.user_id,'schedule_changed',
        jsonb_build_object('date',old.due_date,'time',old.due_time),
        jsonb_build_object('date',new.due_date,'time',new.due_time));
    end if;
    if old.title is distinct from new.title or old.description is distinct from new.description
       or old.category is distinct from new.category or old.priority is distinct from new.priority then
      insert into public.task_events(task_id,user_id,event_type,old_value,new_value)
      values(new.id,new.user_id,'details_changed',to_jsonb(old),to_jsonb(new));
    end if;
    return new;
  end if;
  return null;
end $$;

drop trigger if exists tasks_log_change on public.tasks;
create trigger tasks_log_change after insert or update on public.tasks
for each row execute function public.wattwise_log_task_change();

-- 4) Histórico automático dos tópicos das atas
create or replace function public.wattwise_log_topic_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.visit_topic_events(topic_id,visit_id,user_id,event_type,new_value)
    values(new.id,new.visit_id,new.user_id,'created',to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status then
      insert into public.visit_topic_events(topic_id,visit_id,user_id,event_type,old_value,new_value)
      values(new.id,new.visit_id,new.user_id,'status_changed',jsonb_build_object('status',old.status),jsonb_build_object('status',new.status));
    end if;
    if old.responsible is distinct from new.responsible or old.protocol is distinct from new.protocol
       or old.due_date is distinct from new.due_date or old.observations is distinct from new.observations
       or old.title is distinct from new.title or old.description is distinct from new.description then
      insert into public.visit_topic_events(topic_id,visit_id,user_id,event_type,old_value,new_value)
      values(new.id,new.visit_id,new.user_id,'details_changed',to_jsonb(old),to_jsonb(new));
    end if;
    return new;
  end if;
  return null;
end $$;

drop trigger if exists visit_topics_log_change on public.visit_topics;
create trigger visit_topics_log_change after insert or update on public.visit_topics
for each row execute function public.wattwise_log_topic_change();

-- 5) Atualização automática de updated_at
create or replace function public.wattwise_set_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks
for each row execute function public.wattwise_set_updated_at();
drop trigger if exists visits_set_updated_at on public.visits;
create trigger visits_set_updated_at before update on public.visits
for each row execute function public.wattwise_set_updated_at();
drop trigger if exists visit_topics_set_updated_at on public.visit_topics;
create trigger visit_topics_set_updated_at before update on public.visit_topics
for each row execute function public.wattwise_set_updated_at();

-- 6) RLS: cada pessoa só acessa registros vinculados ao próprio auth.uid().
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.visits enable row level security;
alter table public.visit_topics enable row level security;
alter table public.topic_transfers enable row level security;
alter table public.topic_schedules enable row level security;
alter table public.visit_topic_events enable row level security;

drop policy if exists "users manage own tasks" on public.tasks;
create policy "users manage own tasks" on public.tasks
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users manage own task events" on public.task_events;
drop policy if exists "users read own task events" on public.task_events;
create policy "users read own task events" on public.task_events
for select to authenticated using (auth.uid() = user_id);

drop policy if exists "users manage own visits" on public.visits;
create policy "users manage own visits" on public.visits
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users manage own topics" on public.visit_topics;
create policy "users manage own topics" on public.visit_topics
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users manage own transfers" on public.topic_transfers;
create policy "users manage own transfers" on public.topic_transfers
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users manage own topic schedules" on public.topic_schedules;
create policy "users manage own topic schedules" on public.topic_schedules
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users read own topic events" on public.visit_topic_events;
create policy "users read own topic events" on public.visit_topic_events
for select to authenticated using (auth.uid() = user_id);

-- Índices para consultas comuns e continuidade de pendências
create index if not exists tasks_user_date_idx on public.tasks(user_id,due_date);
create index if not exists tasks_user_status_idx on public.tasks(user_id,status);
create index if not exists visits_user_date_idx on public.visits(user_id,visit_date desc);
create index if not exists topics_user_visit_idx on public.visit_topics(user_id,visit_id);
create index if not exists topics_user_status_idx on public.visit_topics(user_id,status);
create index if not exists transfers_user_destination_idx on public.topic_transfers(user_id,to_visit_id);
create index if not exists schedules_user_date_idx on public.topic_schedules(user_id,target_date) where canceled_at is null;

-- Importante: a continuidade é registrada em topic_transfers/topic_schedules.
-- O tópico original continua na ata de origem; a ata futura referencia o mesmo tópico.
