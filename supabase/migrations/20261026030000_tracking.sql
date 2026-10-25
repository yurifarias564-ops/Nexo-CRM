-- Rastreio de campanhas (estilo Tintim): links rastreados, cliques com protocolo, origem de cada lead.

create table public.tracking_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  name text not null check (char_length(name) between 1 and 80),
  -- 'link' = link rastreado para WhatsApp; 'site' = script do site (botões de WhatsApp)
  kind text not null default 'link' check (kind in ('link', 'site')),
  channel_id uuid references public.whatsapp_channels (id) on delete set null,
  phone text check (phone is null or phone ~ '^[0-9]{10,15}$'),
  message text check (message is null or char_length(message) <= 1000),
  utm_source text check (utm_source is null or char_length(utm_source) <= 200),
  utm_medium text check (utm_medium is null or char_length(utm_medium) <= 200),
  utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 200),
  utm_content text check (utm_content is null or char_length(utm_content) <= 200),
  utm_term text check (utm_term is null or char_length(utm_term) <= 200),
  archived boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index tracking_links_org_idx on public.tracking_links (organization_id, created_at desc);
alter table public.tracking_links enable row level security;
create policy tracking_links_select on public.tracking_links for select to authenticated using ((select private.can_manage(organization_id)));

create table public.tracking_clicks (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  link_id uuid not null references public.tracking_links (id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  fbclid text, gclid text, ttclid text,
  referrer text, landing_url text, user_agent text, ip_hash text,
  lead_id uuid references public.leads (id) on delete set null,
  matched_at timestamptz,
  created_at timestamptz not null default now()
);
create index tracking_clicks_org_idx on public.tracking_clicks (organization_id, created_at desc);
create index tracking_clicks_link_idx on public.tracking_clicks (link_id, created_at desc);
alter table public.tracking_clicks enable row level security;
create policy tracking_clicks_select on public.tracking_clicks for select to authenticated using ((select private.can_manage(organization_id)));

-- Origem de cada lead (primeiro contato rastreado)
create table public.lead_origins (
  lead_id uuid primary key references public.leads (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel text not null check (channel in ('meta_ads', 'instagram', 'facebook', 'google', 'tiktok', 'youtube', 'site', 'bio', 'email', 'indicacao', 'direto', 'outro')),
  source_type text not null check (source_type in ('link', 'anuncio_whatsapp', 'site', 'manual')),
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  ad_id text, ad_title text, ad_url text, ctwa_clid text, fbclid text, gclid text,
  link_id uuid references public.tracking_links (id) on delete set null,
  click_id bigint references public.tracking_clicks (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lead_origins_org_idx on public.lead_origins (organization_id, created_at desc);
alter table public.lead_origins enable row level security;
create policy lead_origins_select on public.lead_origins for select to authenticated
  using ((select private.can_access(organization_id)) and private.lead_visible(lead_id));
