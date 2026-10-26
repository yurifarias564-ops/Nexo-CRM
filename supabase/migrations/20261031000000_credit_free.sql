-- Análise de crédito sem custo por consulta (padrão): pré-análise própria da IA com as regras da loja,
-- link gratuito de pré-aprovação do banco e leitura do print do resultado. Consulta paga fica opcional.

alter table public.credit_settings drop constraint if exists credit_settings_provider_check;
alter table public.credit_settings add constraint credit_settings_provider_check check (provider in ('ia', 'directd', 'bancos', 'webhook', 'manual'));
alter table public.credit_settings alter column provider set default 'ia';
alter table public.credit_settings add column if not exists min_income numeric(12, 2) not null default 0 check (min_income >= 0);
alter table public.credit_settings add column if not exists min_down_pct numeric(5, 2) not null default 10 check (min_down_pct between 0 and 90);
alter table public.credit_settings add column if not exists accept_negative boolean not null default false;
alter table public.credit_settings add column if not exists bank_links jsonb not null default '[{"banco": "Santander (Webmotors)", "url": "https://www.webmotors.com.br/financiamento/"}]';
-- Quem ainda não ligou nenhuma consulta paga passa para o modo grátis
update public.credit_settings set provider = 'ia' where not enabled and provider in ('manual', 'directd')
  and not exists (select 1 from public.credit_secrets s where s.organization_id = credit_settings.organization_id);

-- Pré-análise própria não precisa de CPF
alter table public.credit_checks alter column cpf_masked drop not null;
alter table public.credit_checks alter column cpf_hash drop not null;
-- O que o cliente declarou (nome negativado, tipo de renda, CNH…)
alter table public.credit_checks add column if not exists declared jsonb not null default '{}';

-- Resumo da manhã para o vendedor: quem a IA pré-aprovou e quem não passou desde o último resumo
alter table public.credit_settings add column if not exists digest_hour integer default 8 check (digest_hour is null or digest_hour between 0 and 23);
alter table public.credit_settings add column if not exists notify_each boolean not null default false;
alter table public.credit_settings add column if not exists last_digest_at timestamptz;
