-- Corrige os status usados pela plataforma na tabela visit_topics.
-- Não altera nem remove registros existentes.
alter table public.visit_topics
  drop constraint if exists visit_topics_status_check;

alter table public.visit_topics
  add constraint visit_topics_status_check
  check (status in (
    'Pendente',
    'Em análise',
    'Em andamento',
    'Acompanhar Chamado',
    'Resolvido',
    'Não se aplica'
  ));

notify pgrst, 'reload schema';
