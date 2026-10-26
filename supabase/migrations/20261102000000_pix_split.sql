-- Pix Nexo (recurso pago): a plataforma abre uma conta de recebimento para a loja (subconta Asaas da plataforma).
-- Cada venda Pix cai nessa conta já dividida: a taxa da plataforma vai na hora para a carteira da plataforma (split)
-- e o resto fica no saldo da loja, que ela vê na aba Finanças e saca para o banco dela.
-- 1º mês de uso da loja: R$ 0,10 por venda; depois: R$ 1,00 (valores editáveis só pelo dono da plataforma).

alter table public.platform_settings add column if not exists pix_fee_first_cents integer not null default 10 check (pix_fee_first_cents between 0 and 10000);
alter table public.platform_settings add column if not exists pix_fee_after_cents integer not null default 100 check (pix_fee_after_cents between 0 and 10000);
alter table public.platform_settings add column if not exists pix_first_days integer not null default 30 check (pix_first_days between 0 and 365);
-- Preço mensal do adicional Pix Nexo (entra na mensalidade da loja quando ela ativa)
alter table public.platform_settings add column if not exists pix_addon_cents integer not null default 4990 check (pix_addon_cents between 0 and 1000000);
alter table public.platform_settings add column if not exists platform_wallet_id text;

-- Conta de recebimento da loja
create table public.org_payment_accounts (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  asaas_account_id text,
  wallet_id text not null,
  person_type text not null check (person_type in ('PF', 'PJ')),
  account_name text not null,
  doc_masked text not null,
  -- awaiting_docs: falta enviar documentos · in_review: em análise · approved: pode receber · rejected: recusada
  status text not null default 'awaiting_docs' check (status in ('awaiting_docs', 'in_review', 'approved', 'rejected')),
  onboarding_url text,
  status_checked_at timestamptz,
  webhook_ok boolean not null default false,
  -- Recurso ligado (adicional contratado). Desligar não fecha a conta: o saldo continua disponível para saque.
  enabled boolean not null default true,
  addon_cents integer not null default 0 check (addon_cents >= 0),
  -- Chave Pix do banco da loja para onde vão os saques
  payout_key_type text check (payout_key_type in ('cpf', 'cnpj', 'phone', 'email', 'random')),
  payout_key text,
  payout_key_changed_at timestamptz,
  auto_payout boolean not null default false,
  last_auto_payout_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.org_payment_accounts enable row level security;
create policy org_payment_accounts_select on public.org_payment_accounts for select to authenticated
  using ((select private.can_manage(organization_id)));

-- Chave de API da subconta e token do aviso de pagamento (só o servidor lê)
create table public.org_payment_secrets (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  api_key text not null,
  webhook_token text not null,
  updated_at timestamptz not null default now()
);
alter table public.org_payment_secrets enable row level security;

-- Vendas Pix feitas pelo CRM (conversa hoje; loja/catálogo no futuro) e a taxa da plataforma de cada uma
create table public.pix_charges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  source text not null default 'conversa' check (source in ('conversa', 'loja', 'link')),
  asaas_payment_id text unique,
  value numeric(14, 2) not null check (value > 0),
  description text,
  payer_name text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'overdue', 'refunded', 'canceled')),
  fee_cents integer not null default 0 check (fee_cents >= 0),
  fee_status text not null default 'pending' check (fee_status in ('pending', 'confirmed', 'canceled', 'none')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index pix_charges_org_idx on public.pix_charges (organization_id, created_at desc);
create index pix_charges_fee_idx on public.pix_charges (fee_status, paid_at);
create index pix_charges_conv_idx on public.pix_charges (conversation_id, created_at desc);
-- Sem leitura direta pelo navegador: a receita da plataforma é privada (só o dono vê, pela aba Parceiros).
-- A loja vê as vendas dela pela API do CRM (aba Finanças).
alter table public.pix_charges enable row level security;

-- Saques da loja para o banco dela
create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  asaas_transfer_id text unique,
  value numeric(14, 2) not null check (value > 0),
  key_display text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed', 'canceled')),
  fail_reason text,
  auto boolean not null default false,
  requested_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payouts_org_idx on public.payouts (organization_id, created_at desc);
alter table public.payouts enable row level security;
create policy payouts_select on public.payouts for select to authenticated
  using ((select private.can_manage(organization_id)));

-- A empresa é da própria plataforma (dono = conta da casa)? Ela não paga taxa nem adicional para si mesma.
create or replace function public.org_is_house(org uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (
    select 1 from public.organization_members m
    join auth.users u on u.id = m.user_id
    join private.house_accounts h on h.email = lower(u.email)
    where m.organization_id = org and m.role = 'owner'
  );
end;
$$;
revoke all on function public.org_is_house(uuid) from public, anon, authenticated;
