-- Meta Ads: conexão com a conta de anúncios, investimento por anúncio e eventos de conversão (pixel / API de Conversões).

create table public.meta_connections (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  ad_account_id text check (ad_account_id is null or ad_account_id ~ '^act_[0-9]{5,25}$'),
  ad_account_name text,
  currency text not null default 'BRL',
  pixel_id text check (pixel_id is null or pixel_id ~ '^[0-9]{5,25}$'),
  page_id text check (page_id is null or page_id ~ '^[0-9]{5,25}$'),
  send_purchase boolean not null default true,
  send_lead boolean not null default true,
  last_sync_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.meta_connections enable row level security;
create policy meta_connections_select on public.meta_connections for select to authenticated using ((select private.can_manage(organization_id)));

-- Token do Business Manager. Sem policy: só o servidor lê.
create table public.meta_secrets (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  access_token text not null,
  updated_at timestamptz not null default now()
);
alter table public.meta_secrets enable row level security;

-- Anúncios da conta (nome, status, campanha, conjunto, miniatura)
create table public.meta_ads (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  ad_id text not null,
  name text,
  status text,
  campaign_id text, campaign_name text,
  adset_id text, adset_name text,
  thumbnail_url text,
  updated_at timestamptz not null default now(),
  primary key (organization_id, ad_id)
);
alter table public.meta_ads enable row level security;
create policy meta_ads_select on public.meta_ads for select to authenticated using ((select private.can_manage(organization_id)));

-- Números do Meta por anúncio e dia
create table public.meta_ad_insights (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  ad_id text not null,
  day date not null,
  spend numeric(14, 2) not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  link_clicks bigint not null default 0,
  conversations bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, ad_id, day)
);
create index meta_ad_insights_day_idx on public.meta_ad_insights (organization_id, day);
alter table public.meta_ad_insights enable row level security;
create policy meta_ad_insights_select on public.meta_ad_insights for select to authenticated using ((select private.can_manage(organization_id)));

-- Fila de eventos para o Meta (Lead / Purchase)
create table public.meta_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  event_name text not null check (event_name in ('Lead', 'Purchase')),
  event_key text not null,
  value numeric(14, 2),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  mode text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (organization_id, event_key)
);
create index meta_events_pending_idx on public.meta_events (status, created_at) where status = 'pending';
create index meta_events_org_idx on public.meta_events (organization_id, created_at desc);
alter table public.meta_events enable row level security;
create policy meta_events_select on public.meta_events for select to authenticated using ((select private.can_manage(organization_id)));

-- Venda: lead entrou numa etapa "ganho" com valor (ou ganhou valor estando lá) → evento Purchase
create or replace function private.meta_enqueue_purchase()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_won boolean;
begin
  if new.value is null or new.value <= 0 then return null; end if;
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id and new.value is not distinct from old.value then return null; end if;
  select s.kind = 'won' into v_won from public.stages s where s.id = new.stage_id;
  if not coalesce(v_won, false) then return null; end if;
  if not exists (select 1 from public.meta_connections c where c.organization_id = new.organization_id and c.send_purchase and c.pixel_id is not null) then return null; end if;
  insert into public.meta_events (organization_id, lead_id, event_name, event_key, value)
  values (new.organization_id, new.id, 'Purchase', 'purchase:' || new.id, new.value)
  on conflict (organization_id, event_key) do update set value = excluded.value
    where public.meta_events.status in ('pending', 'failed');
  return null;
end $$;
create trigger leads_meta_purchase after insert or update of stage_id, value on public.leads
  for each row execute function private.meta_enqueue_purchase();

-- Lead que veio de anúncio/campanha → evento Lead
create or replace function private.meta_enqueue_lead()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source_type = 'manual' then return null; end if;
  if not exists (select 1 from public.meta_connections c where c.organization_id = new.organization_id and c.send_lead and c.pixel_id is not null) then return null; end if;
  insert into public.meta_events (organization_id, lead_id, event_name, event_key)
  values (new.organization_id, new.lead_id, 'Lead', 'lead:' || new.lead_id)
  on conflict (organization_id, event_key) do nothing;
  return null;
end $$;
create trigger lead_origins_meta_lead after insert on public.lead_origins
  for each row execute function private.meta_enqueue_lead();
