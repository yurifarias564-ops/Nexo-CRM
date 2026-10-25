-- Análise de crédito pela IA: a loja escolhe a ferramenta (bureau, banco, sistema próprio),
-- a IA coleta os dados com autorização do cliente, consulta e aplica a regra de aprovação da loja.

create table public.credit_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  enabled boolean not null default false,
  provider text not null default 'manual' check (provider in ('directd', 'bancos', 'webhook', 'manual')),
  banks text[] not null default '{}',
  -- Código secreto do endereço de retorno (a plataforma de bancos devolve o resultado depois)
  callback_token text not null default replace(gen_random_uuid()::text, '-', ''),
  webhook_url text check (webhook_url is null or webhook_url like 'https://%'),
  min_score integer not null default 600 check (min_score between 0 and 1000),
  review_score integer not null default 400 check (review_score between 0 and 1000),
  max_income_pct numeric(5, 2) not null default 30 check (max_income_pct between 5 and 100),
  monthly_rate numeric(5, 2) not null default 2.0 check (monthly_rate between 0 and 15),
  handoff boolean not null default true,
  max_per_day integer not null default 50 check (max_per_day between 1 and 5000),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index credit_settings_callback_idx on public.credit_settings (callback_token);
alter table public.credit_settings enable row level security;
create policy credit_settings_select on public.credit_settings for select to authenticated
  using ((select private.can_manage(organization_id)));

-- Chave de acesso da ferramenta de crédito (só o servidor lê)
create table public.credit_secrets (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  credential text not null,
  updated_at timestamptz not null default now()
);
alter table public.credit_secrets enable row level security;

-- Histórico de consultas. O CPF não é guardado inteiro: só mascarado e um código para reaproveitar a consulta.
create table public.credit_checks (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  source text not null check (source in ('ia', 'teste')),
  cpf_masked text not null,
  cpf_hash text not null,
  income numeric(14, 2),
  vehicle_value numeric(14, 2),
  down_payment numeric(14, 2),
  months integer,
  installment numeric(14, 2),
  provider text not null,
  status text not null check (status in ('aprovado', 'analise', 'reprovado', 'erro')),
  score integer,
  score_band text,
  payment_capacity text,
  reasons text[] not null default '{}',
  -- Resposta de cada banco: [{banco, status, parcela, taxa, prazo, valor_liberado, mensagem}]
  banks jsonb not null default '[]',
  external_id text,
  error text,
  updated_at timestamptz not null default now(),
  consent_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index credit_checks_org_idx on public.credit_checks (organization_id, created_at desc);
create index credit_checks_cpf_idx on public.credit_checks (organization_id, cpf_hash, created_at desc);
create index credit_checks_lead_idx on public.credit_checks (lead_id);
alter table public.credit_checks enable row level security;
create policy credit_checks_select on public.credit_checks for select to authenticated
  using ((select private.can_manage(organization_id)));
