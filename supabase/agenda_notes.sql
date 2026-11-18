-- Watt-Wise | Criar a tabela de Anotações da Minha Agenda
-- Execute este script uma única vez no SQL Editor do Supabase.

create table if not exists public.agenda_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agenda_notes enable row level security;

drop policy if exists "users manage own agenda notes" on public.agenda_notes;
create policy "users manage own agenda notes" on public.agenda_notes
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists agenda_notes_user_created_idx
on public.agenda_notes(user_id, created_at desc);

drop trigger if exists agenda_notes_set_updated_at on public.agenda_notes;
create trigger agenda_notes_set_updated_at
before update on public.agenda_notes
for each row execute function public.wattwise_set_updated_at();
