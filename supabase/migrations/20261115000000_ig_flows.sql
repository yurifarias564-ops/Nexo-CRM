-- Automações do Instagram: post agendado + gatilho de comentário + fluxo de botões no Direct.

alter table public.whatsapp_channels add column if not exists ig_scopes text;

create table public.ig_flows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  channel_id uuid not null references public.whatsapp_channels (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  enabled boolean not null default false,
  -- publicação: agendar uma nova, usar uma já publicada ou valer para qualquer publicação
  post_mode text not null default 'schedule' check (post_mode in ('schedule', 'existing', 'any')),
  post_media jsonb,
  post_caption text check (post_caption is null or char_length(post_caption) <= 2200),
  post_at timestamptz,
  time_zone text not null default 'America/Sao_Paulo',
  post_status text not null default 'none' check (post_status in ('none', 'scheduled', 'processing', 'published', 'failed', 'canceled')),
  post_container_id text,
  post_media_id text,
  post_permalink text,
  post_error text,
  post_attempts integer not null default 0,
  published_at timestamptz,
  -- gatilho: palavras no comentário (vazio = qualquer comentário) e resposta pública opcional
  keywords text[] not null default '{}' check (cardinality(keywords) <= 20),
  comment_reply text check (comment_reply is null or char_length(comment_reply) <= 300),
  -- fluxo no Direct: etapas com botão e mensagem final com link
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 10),
  final_text text check (final_text is null or char_length(final_text) <= 640),
  final_button text check (final_button is null or char_length(final_button) <= 20),
  final_url text check (final_url is null or (final_url ~ '^https://' and char_length(final_url) <= 500)),
  final_require_follow boolean not null default false,
  not_following_text text check (not_following_text is null or char_length(not_following_text) <= 640),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ig_flows_schedule_ck check (post_status <> 'scheduled' or (post_at is not null and post_media is not null))
);
create index ig_flows_org_idx on public.ig_flows (organization_id, created_at desc);
create index ig_flows_channel_idx on public.ig_flows (channel_id) where enabled;
create index ig_flows_due_idx on public.ig_flows (post_at) where post_status in ('scheduled', 'processing');
create index ig_flows_media_idx on public.ig_flows (post_media_id) where post_media_id is not null;
create index ig_flows_created_by_idx on public.ig_flows (created_by);

create table public.ig_flow_runs (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.ig_flows (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  igsid text not null,
  username text,
  comment_id text,
  step integer not null default 0,
  status text not null default 'active' check (status in ('active', 'done', 'failed')),
  follow_blocks integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (flow_id, igsid)
);
create index ig_flow_runs_org_idx on public.ig_flow_runs (organization_id);
create index ig_flow_runs_user_idx on public.ig_flow_runs (igsid, updated_at desc) where status = 'active';

alter table public.ig_flows enable row level security;
alter table public.ig_flow_runs enable row level security;
create policy ig_flows_select on public.ig_flows for select to authenticated using ((select private.can_manage(organization_id)));
create policy ig_flow_runs_select on public.ig_flow_runs for select to authenticated using ((select private.can_manage(organization_id)));
revoke insert, update, delete on public.ig_flows, public.ig_flow_runs from authenticated, anon;

-- O canal do fluxo precisa ser um Instagram da mesma empresa.
create or replace function private.ig_flow_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.whatsapp_channels c where c.id = new.channel_id and c.organization_id = new.organization_id and c.provider = 'instagram') then
    raise exception 'Conta do Instagram de outra empresa' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger ig_flow_check before insert or update on public.ig_flows
  for each row execute function private.ig_flow_check();

create or replace function private.ig_flow_run_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.ig_flows f where f.id = new.flow_id and f.organization_id = new.organization_id) then
    raise exception 'Fluxo de outra empresa' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger ig_flow_run_check before insert on public.ig_flow_runs
  for each row execute function private.ig_flow_run_check();

-- Reserva a publicação vencida para um único executor (evita postar duas vezes).
create or replace function public.claim_ig_posts(p_limit integer default 3)
returns setof public.ig_flows
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.ig_flows f
     set post_attempts = f.post_attempts + 1
   where f.id in (
     select id from public.ig_flows
      where (post_status = 'scheduled' and post_at <= now()) or post_status = 'processing'
      order by post_at
      limit least(greatest(p_limit, 1), 10)
      for update skip locked
   )
  returning f.*;
end $$;
revoke execute on function public.claim_ig_posts(integer) from public, anon, authenticated;
grant execute on function public.claim_ig_posts(integer) to service_role;
