-- Adiciona o status "Próxima semana" aos assuntos das atas.
-- Preserva todos os registros existentes e mantém os status já utilizados.
alter table public.visit_topics
  drop constraint if exists visit_topics_status_check;

alter table public.visit_topics
  add constraint visit_topics_status_check
  check (status in (
    'Pendente',
    'Em análise',
    'Em andamento',
    'Próxima semana',
    'Acompanhar Chamado',
    'Resolvido',
    'Não se aplica'
  ));

notify pgrst, 'reload schema';
