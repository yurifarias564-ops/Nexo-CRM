-- Portais (OLX, Webmotors e outros): cada empresa tem um endereço secreto que recebe leads.
create table public.inbound_links (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  token text not null unique check (char_length(token) >= 32),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  received integer not null default 0
);
alter table public.inbound_links enable row level security;
create policy inbound_links_select on public.inbound_links for select to authenticated
  using ((select private.can_manage(organization_id)));

-- Conta da OLX conectada (o token só o servidor lê)
create table public.olx_accounts (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  access_token text not null,
  webhook_ok boolean not null default false,
  last_error text,
  connected_at timestamptz not null default now()
);
alter table public.olx_accounts enable row level security;

-- Chat da OLX de cada lead (para responder pelo CRM)
create table public.olx_chats (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  chat_id text not null,
  last_message_id text,
  list_id text,
  updated_at timestamptz not null default now(),
  unique (organization_id, chat_id)
);
create index olx_chats_lead_idx on public.olx_chats (lead_id);
alter table public.olx_chats enable row level security;
create policy olx_chats_select on public.olx_chats for select to authenticated
  using ((select private.is_member(organization_id)));
