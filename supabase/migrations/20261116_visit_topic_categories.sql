alter table public.visit_topics
  add column if not exists category text not null default 'Não categorizado';

notify pgrst, 'reload schema';
