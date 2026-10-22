-- =============================================================================
-- Relatório automático: uma geração interrompida (queda do servidor no meio)
-- não pode travar o envio do mês. Guarda quando a tentativa atual começou e
-- trata "gerando" há mais de 30 minutos como falha que pode ser repetida.
-- =============================================================================
alter table public.report_runs add column if not exists started_at timestamptz not null default now();
