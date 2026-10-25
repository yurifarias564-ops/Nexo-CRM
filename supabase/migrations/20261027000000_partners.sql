-- Parceiros (painel do dono da plataforma): acompanhar todas as empresas clientes, vencimento,
-- forma de pagamento, acesso de suporte e cobrança no grupo do WhatsApp. Tudo só pelo servidor.

alter table public.subscriptions
  add column billing_type text,
  add column card_brand text,
  add column card_last4 text,
  add column next_due_date date;

create table public.partner_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  billing_group_id text check (billing_group_id is null or char_length(billing_group_id) <= 100),
  billing_group_name text check (billing_group_name is null or char_length(billing_group_name) <= 200),
  notes text check (notes is null or char_length(notes) <= 2000),
  updated_at timestamptz not null default now()
);
alter table public.partner_settings enable row level security;

-- Configuração única da plataforma: de qual número sai a cobrança nos grupos
create table public.platform_settings (
  id boolean primary key default true check (id),
  billing_channel_id uuid references public.whatsapp_channels (id) on delete set null,
  billing_hour smallint not null default 9 check (billing_hour between 0 and 23),
  updated_at timestamptz not null default now()
);
alter table public.platform_settings enable row level security;

-- Cobranças já enviadas no grupo (não manda duas vezes)
create table public.partner_billing_notices (
  payment_id text not null,
  kind text not null check (kind in ('due', 'overdue', 'manual')),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (payment_id, kind)
);
alter table public.partner_billing_notices enable row level security;

-- Acesso de suporte do dono da plataforma às contas dos clientes (para poder sair depois)
create table public.platform_support_access (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
alter table public.platform_support_access enable row level security;

-- Registro de tudo o que o dono da plataforma faz nas contas dos clientes
create table public.platform_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index platform_audit_org_idx on public.platform_audit (organization_id, created_at desc);
alter table public.platform_audit enable row level security;

-- Visão geral de cada empresa (só o servidor chama)
create or replace function public.platform_partners()
returns table (
  id uuid, name text, created_at timestamptz,
  owner_id uuid, owner_name text, owner_email text,
  status public.subscription_status, current_period_end timestamptz, next_due_date date, value_cents integer,
  billing_type text, card_brand text, card_last4 text, asaas_subscription_id text,
  members bigint, leads bigint, leads_30d bigint, won_30d bigint, channels_connected bigint, last_activity timestamptz,
  billing_group_id text, billing_group_name text, notes text
) language sql stable security definer set search_path = '' as $$
  select o.id, o.name, o.created_at,
    ow.user_id, p.full_name, p.email,
    s.status, s.current_period_end, s.next_due_date, s.value_cents, s.billing_type, s.card_brand, s.card_last4, s.asaas_subscription_id,
    (select count(*) from public.organization_members m where m.organization_id = o.id),
    (select count(*) from public.leads l where l.organization_id = o.id),
    (select count(*) from public.leads l where l.organization_id = o.id and l.created_at > now() - interval '30 days'),
    (select count(*) from public.leads l join public.stages st on st.id = l.stage_id where l.organization_id = o.id and st.kind = 'won' and l.stage_changed_at > now() - interval '30 days'),
    (select count(*) from public.whatsapp_channels c where c.organization_id = o.id and c.status = 'connected'),
    (select max(c.last_message_at) from public.conversations c where c.organization_id = o.id),
    ps.billing_group_id, ps.billing_group_name, ps.notes
  from public.organizations o
  left join public.subscriptions s on s.organization_id = o.id
  left join lateral (select m.user_id from public.organization_members m where m.organization_id = o.id and m.role = 'owner' order by m.created_at limit 1) ow on true
  left join public.profiles p on p.id = ow.user_id
  left join public.partner_settings ps on ps.organization_id = o.id
  order by o.created_at desc;
$$;
revoke execute on function public.platform_partners() from public, anon, authenticated;
grant execute on function public.platform_partners() to service_role;
