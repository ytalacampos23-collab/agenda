-- Adiciona o campo CNPJ Wisecoop às atas de visita.
-- Coluna opcional para preservar todos os registros existentes.
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS cnpj_wisecoop text;

NOTIFY pgrst, 'reload schema';
