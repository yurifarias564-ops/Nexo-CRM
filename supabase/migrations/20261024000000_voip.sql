-- =============================================================================
-- Telefonia VoIP (Api4Com): ligação comum para o celular do lead, gravada.
-- Funciona com qualquer número de WhatsApp (coexistência ou QR Code).
--  - voip_settings: empresa conectada à central (domínio SIP e "gateway" do webhook)
--  - voip_secrets: token da API e chave do webhook (só o servidor lê)
--  - voip_extensions: ramal de cada pessoa da equipe; a senha SIP fica separada
--  - wa_calls passa a guardar também as ligações VoIP (kind = 'voip')
-- Escrita só pelo servidor; a equipe só lê.
-- =============================================================================

create table public.voip_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  provider text not null default 'api4com' check (provider in ('api4com')),
  domain text check (domain is null or domain ~ '^[a-z0-9.-]+$'),
  gateway text not null unique check (gateway ~ '^[a-z0-9-]{6,64}$'),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.voip_settings enable row level security;
create policy voip_settings_select on public.voip_settings for select to authenticated using ((select private.can_access(organization_id)));

create table public.voip_secrets (
  organization_id uuid primary key references public.voip_settings (organization_id) on delete cascade,
  api_token text not null check (char_length(api_token) between 8 and 500),
  webhook_key text not null check (char_length(webhook_key) >= 32)
);
alter table public.voip_secrets enable row level security;
-- sem políticas: só o servidor (service role)

create table public.voip_extensions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.voip_settings (organization_id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  ramal text not null check (ramal ~ '^[0-9]{2,10}$'),
  domain text,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, ramal)
);
create index voip_extensions_user_idx on public.voip_extensions (user_id);
alter table public.voip_extensions enable row level security;
create policy voip_extensions_select on public.voip_extensions for select to authenticated using ((select private.can_access(organization_id)));

create table public.voip_extension_secrets (
  extension_id uuid primary key references public.voip_extensions (id) on delete cascade,
  sip_password text not null check (char_length(sip_password) between 4 and 200)
);
alter table public.voip_extension_secrets enable row level security;
-- sem políticas: a senha SIP só sai pela rota do servidor, e só para o dono do ramal

alter table public.wa_calls
  add column kind text not null default 'whatsapp' check (kind in ('whatsapp', 'voip')),
  add column voip_call_id text,
  add column hangup_cause text;
create unique index wa_calls_voip_call_id_uq on public.wa_calls (organization_id, voip_call_id) where voip_call_id is not null;
create index wa_calls_kind_idx on public.wa_calls (organization_id, kind, created_at desc);
