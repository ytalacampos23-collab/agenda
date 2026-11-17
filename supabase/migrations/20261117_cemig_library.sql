-- Biblioteca da Cemig: mensagens prontas e documentos necessários por usuário.
create table if not exists public.cemig_library_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('message','documents')),
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.cemig_library_items enable row level security;
drop policy if exists "users manage own Cemig library" on public.cemig_library_items;
create policy "users manage own Cemig library" on public.cemig_library_items
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists cemig_library_user_kind_idx on public.cemig_library_items(user_id,kind,created_at desc);
drop trigger if exists cemig_library_set_updated_at on public.cemig_library_items;
create trigger cemig_library_set_updated_at before update on public.cemig_library_items
for each row execute function public.wattwise_set_updated_at();
