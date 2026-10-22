-- =============================================================================
-- NEXO CRM — schema inicial
-- Multi-empresa (multi-tenant) com Row Level Security em todas as tabelas.
-- Regra de ouro: um usuário só lê/escreve dados de empresas das quais é membro
-- E cuja assinatura esteja ativa. O bloqueio por falta de pagamento é aplicado
-- no próprio banco, não só na interface.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
create type public.member_role as enum ('owner', 'admin', 'agent');
create type public.subscription_status as enum ('pending', 'active', 'past_due', 'canceled');
create type public.stage_kind as enum ('open', 'won', 'lost');
create type public.wa_provider as enum ('meta', 'evolution');
create type public.channel_status as enum ('disconnected', 'connecting', 'connected', 'error');
create type public.msg_direction as enum ('in', 'out');
create type public.msg_status as enum ('pending', 'sent', 'delivered', 'read', 'failed', 'received');
create type public.msg_type as enum ('text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contact', 'other');

-- -----------------------------------------------------------------------------
-- Empresas, membros, perfis
-- -----------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);


create table public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role public.member_role not null default 'agent' check (role <> 'owner'),
  invited_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index organization_invites_pending_uq
  on public.organization_invites (organization_id, lower(email)) where accepted_at is null;
create index organization_invites_email_idx on public.organization_invites (lower(email)) where accepted_at is null;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  current_organization_id uuid references public.organizations (id) on delete set null,
  created_at timestamptz not null default now()
);

-- user_id referencia profiles (que referencia auth.users): permite à API
-- buscar nome/e-mail dos membros num único select (embed).
create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null default 'agent',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

-- -----------------------------------------------------------------------------
-- Assinatura (Asaas)
-- -----------------------------------------------------------------------------
create table public.subscriptions (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  status public.subscription_status not null default 'pending',
  asaas_customer_id text,
  asaas_subscription_id text unique,
  checkout_url text,
  value_cents integer,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

-- Idempotência de webhooks (Asaas, Meta, Evolution reenviam eventos)
create table public.webhook_events (
  provider text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

-- -----------------------------------------------------------------------------
-- Funções de acesso (schema privado, não exposto pela API)
-- -----------------------------------------------------------------------------
create or replace function private.is_member(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_role(org uuid, roles public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid()) and m.role = any (roles)
  );
$$;

create or replace function private.subscription_active(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.subscriptions s
    where s.organization_id = org
      and s.status = 'active'
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;

-- Acesso completo aos dados operacionais: membro + assinatura em dia
create or replace function private.can_access(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_member(org) and private.subscription_active(org);
$$;

create or replace function private.can_manage(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_role(org, array['owner','admin']::public.member_role[]) and private.subscription_active(org);
$$;

grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Funil (pipelines e etapas)
-- -----------------------------------------------------------------------------
create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index pipelines_org_idx on public.pipelines (organization_id, position);

create table public.stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  pipeline_id uuid not null references public.pipelines (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  color text not null default '#3b82f6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  kind public.stage_kind not null default 'open',
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index stages_pipeline_idx on public.stages (pipeline_id, position);
create index stages_org_idx on public.stages (organization_id);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default '#3b82f6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);
create unique index tags_org_name_uq on public.tags (organization_id, lower(name));

-- -----------------------------------------------------------------------------
-- Leads
-- -----------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  pipeline_id uuid not null references public.pipelines (id) on delete cascade,
  stage_id uuid not null references public.stages (id), -- NO ACTION: bloqueia excluir etapa com leads
  name text not null check (char_length(name) between 1 and 160),
  phone text check (phone is null or phone ~ '^[0-9]{8,15}$'),
  email text check (email is null or char_length(email) <= 254),
  value numeric(14, 2) not null default 0 check (value >= 0),
  source text,
  notes text,
  assigned_to uuid references auth.users (id) on delete set null,
  position double precision not null default 0,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_org_phone_uq unique (organization_id, phone)
);
create index leads_stage_pos_idx on public.leads (stage_id, position);
create index leads_org_created_idx on public.leads (organization_id, created_at desc);
create index leads_assigned_idx on public.leads (assigned_to);
create index leads_pipeline_idx on public.leads (pipeline_id);
create index leads_name_trgm_idx on public.leads using gin (name extensions.gin_trgm_ops);

create table public.lead_tags (
  lead_id uuid not null references public.leads (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (lead_id, tag_id)
);
create index lead_tags_tag_idx on public.lead_tags (tag_id);
create index lead_tags_org_idx on public.lead_tags (organization_id);

create table public.activities (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activities_lead_idx on public.activities (lead_id, created_at desc);
create index activities_org_idx on public.activities (organization_id, created_at desc);

-- -----------------------------------------------------------------------------
-- WhatsApp
-- -----------------------------------------------------------------------------
create table public.whatsapp_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider public.wa_provider not null,
  name text not null check (char_length(name) between 1 and 60),
  status public.channel_status not null default 'disconnected',
  phone_number text,
  meta_phone_number_id text unique,
  meta_waba_id text,
  evolution_instance text unique,
  history_imported_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index whatsapp_channels_org_idx on public.whatsapp_channels (organization_id);

-- Segredos ficam isolados: SEM nenhuma policy para usuários. Só o servidor
-- (service role) lê esta tabela. Tokens nunca chegam ao navegador.
create table public.whatsapp_channel_secrets (
  channel_id uuid primary key references public.whatsapp_channels (id) on delete cascade,
  meta_access_token text,
  webhook_secret text not null,
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel_id uuid not null references public.whatsapp_channels (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  wa_id text not null,
  contact_name text,
  unread_count integer not null default 0,
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz not null default now(),
  constraint conversations_channel_wa_uq unique (channel_id, wa_id)
);
create index conversations_org_last_idx on public.conversations (organization_id, last_message_at desc nulls last);
create index conversations_lead_idx on public.conversations (lead_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  channel_id uuid not null references public.whatsapp_channels (id) on delete cascade,
  external_id text not null,
  direction public.msg_direction not null,
  type public.msg_type not null default 'text',
  body text,
  media_ref text,
  media_mime text,
  status public.msg_status not null default 'received',
  sent_by uuid references auth.users (id) on delete set null,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint messages_channel_external_uq unique (channel_id, external_id)
);
create index messages_conversation_idx on public.messages (conversation_id, sent_at desc);
create index messages_org_idx on public.messages (organization_id);

-- -----------------------------------------------------------------------------
-- Mensagens rápidas
-- -----------------------------------------------------------------------------
create table public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  shortcut text not null check (shortcut ~ '^[a-z0-9_-]{1,32}$'),
  title text not null check (char_length(title) between 1 and 80),
  content text not null check (char_length(content) between 1 and 4096),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint quick_replies_org_shortcut_uq unique (organization_id, shortcut)
);

-- -----------------------------------------------------------------------------
-- Comandos de voz (auditoria)
-- -----------------------------------------------------------------------------
create table public.voice_commands (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  transcript text not null,
  actions jsonb not null default '[]'::jsonb,
  executed boolean not null default false,
  created_at timestamptz not null default now()
);
create index voice_commands_org_idx on public.voice_commands (organization_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Gatilhos
-- -----------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger leads_touch before update on public.leads
  for each row execute function private.touch_updated_at();

-- Garante que etapa e funil do lead pertencem à mesma empresa (anti-adulteração)
create or replace function private.leads_check_integrity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare st record;
begin
  select organization_id, pipeline_id into st from public.stages where id = new.stage_id;
  if st is null or st.organization_id <> new.organization_id then
    raise exception 'Etapa inválida para esta empresa' using errcode = '42501';
  end if;
  new.pipeline_id := st.pipeline_id;
  if new.assigned_to is not null and not exists (
    select 1 from public.organization_members
    where organization_id = new.organization_id and user_id = new.assigned_to
  ) then
    raise exception 'Responsável não pertence à empresa' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger leads_integrity before insert or update of stage_id, organization_id, assigned_to on public.leads
  for each row execute function private.leads_check_integrity();

create or replace function private.lead_tags_check_integrity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.leads where id = new.lead_id and organization_id = new.organization_id)
     or not exists (select 1 from public.tags where id = new.tag_id and organization_id = new.organization_id) then
    raise exception 'Tag ou lead de outra empresa' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger lead_tags_integrity before insert or update on public.lead_tags
  for each row execute function private.lead_tags_check_integrity();

-- Histórico automático de movimentação
create or replace function private.leads_log_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activities (organization_id, lead_id, actor_id, type, payload)
    values (new.organization_id, new.id, auth.uid(), 'lead_created', jsonb_build_object('stage_id', new.stage_id));
  elsif new.stage_id is distinct from old.stage_id then
    insert into public.activities (organization_id, lead_id, actor_id, type, payload)
    values (new.organization_id, new.id, auth.uid(), 'stage_changed',
            jsonb_build_object('from', old.stage_id, 'to', new.stage_id));
  end if;
  return null;
end $$;

create trigger leads_activity after insert or update of stage_id on public.leads
  for each row execute function private.leads_log_activity();

-- Novo usuário: cria perfil e aceita convites pendentes
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare inv record; first_org uuid;
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  for inv in
    select * from public.organization_invites
    where lower(email) = lower(new.email) and accepted_at is null
  loop
    insert into public.organization_members (organization_id, user_id, role)
    values (inv.organization_id, new.id, inv.role)
    on conflict do nothing;
    update public.organization_invites set accepted_at = now() where id = inv.id;
    first_org := coalesce(first_org, inv.organization_id);
  end loop;

  if first_org is not null then
    update public.profiles set current_organization_id = first_org where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- RPC: criar empresa com funil padrão (atômico)
-- -----------------------------------------------------------------------------
create or replace function public.create_organization(org_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare org uuid; pipe uuid; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Não autenticado' using errcode = '28000'; end if;
  if char_length(trim(org_name)) < 2 then raise exception 'Nome inválido' using errcode = '22023'; end if;

  insert into public.organizations (name, created_by) values (trim(org_name), uid) returning id into org;
  insert into public.organization_members (organization_id, user_id, role) values (org, uid, 'owner');
  insert into public.subscriptions (organization_id, status) values (org, 'pending');

  insert into public.pipelines (organization_id, name, position) values (org, 'Funil de vendas', 0) returning id into pipe;
  insert into public.stages (organization_id, pipeline_id, name, color, kind, position) values
    (org, pipe, 'Novo lead',        '#64748b', 'open', 0),
    (org, pipe, 'Qualificação',     '#3b82f6', 'open', 1),
    (org, pipe, 'Negociação',       '#8b5cf6', 'open', 2),
    (org, pipe, 'Proposta enviada', '#f59e0b', 'open', 3),
    (org, pipe, 'Ganho',            '#10b981', 'won',  4),
    (org, pipe, 'Perdido',          '#ef4444', 'lost', 5);

  insert into public.tags (organization_id, name, color) values
    (org, 'Anúncio', '#3b82f6'), (org, 'Indicação', '#10b981'), (org, 'Orgânico', '#8b5cf6');

  insert into public.quick_replies (organization_id, shortcut, title, content, created_by) values
    (org, 'oi', 'Saudação', 'Olá! Tudo bem? Aqui é da equipe. Como posso te ajudar hoje?', uid),
    (org, 'obrigado', 'Agradecimento', 'Muito obrigado pelo contato! Qualquer dúvida, estou à disposição.', uid);

  update public.profiles set current_organization_id = org where id = uid;
  return org;
end $$;

revoke execute on function public.create_organization(text) from public, anon;
grant execute on function public.create_organization(text) to authenticated;

-- Troca de empresa ativa (somente para empresas das quais é membro)
create or replace function public.switch_organization(org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_member(org) then raise exception 'Sem acesso' using errcode = '42501'; end if;
  update public.profiles set current_organization_id = org where id = auth.uid();
end $$;
revoke execute on function public.switch_organization(uuid) from public, anon;
grant execute on function public.switch_organization(uuid) to authenticated;

-- Marca conversa como lida
create or replace function public.mark_conversation_read(conv uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.conversations set unread_count = 0 where id = conv;
end $$;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- Busca de leads por similaridade (usada pelo comando de voz)
create or replace function public.search_leads(org uuid, q text, max_results int default 5)
returns table (id uuid, name text, phone text, stage_id uuid, score real)
language sql stable security invoker set search_path = '' as $$
  select l.id, l.name, l.phone, l.stage_id,
         extensions.similarity(lower(l.name), lower(q)) as score
  from public.leads l
  where l.organization_id = org
    and (lower(l.name) operator(extensions.%) lower(q) or l.name ilike '%' || q || '%' or l.phone like '%' || regexp_replace(q, '\D', '', 'g') || '%' and length(regexp_replace(q, '\D', '', 'g')) >= 4)
  order by score desc, l.last_message_at desc nulls last
  limit least(max_results, 20);
$$;
revoke execute on function public.search_leads(uuid, text, int) from public, anon;
grant execute on function public.search_leads(uuid, text, int) to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invites enable row level security;
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.webhook_events enable row level security;
alter table public.pipelines enable row level security;
alter table public.stages enable row level security;
alter table public.tags enable row level security;
alter table public.leads enable row level security;
alter table public.lead_tags enable row level security;
alter table public.activities enable row level security;
alter table public.whatsapp_channels enable row level security;
alter table public.whatsapp_channel_secrets enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.quick_replies enable row level security;
alter table public.voice_commands enable row level security;

-- Empresas / membros / perfis / assinatura: visíveis mesmo sem pagamento
-- (necessário para mostrar a tela de cobrança).
create policy org_select on public.organizations for select to authenticated
  using ((select private.is_member(id)));
create policy org_update on public.organizations for update to authenticated
  using ((select private.has_role(id, array['owner','admin']::public.member_role[])))
  with check ((select private.has_role(id, array['owner','admin']::public.member_role[])));

create policy members_select on public.organization_members for select to authenticated
  using ((select private.is_member(organization_id)));
create policy members_update on public.organization_members for update to authenticated
  using ((select private.can_manage(organization_id)) and role <> 'owner')
  with check ((select private.can_manage(organization_id)) and role <> 'owner');
create policy members_delete on public.organization_members for delete to authenticated
  using ((select private.can_manage(organization_id)) and role <> 'owner');

create policy invites_all on public.organization_invites for all to authenticated
  using ((select private.can_manage(organization_id)))
  with check ((select private.can_manage(organization_id)));

create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.organization_members a
      join public.organization_members b on a.organization_id = b.organization_id
      where a.user_id = (select auth.uid()) and b.user_id = profiles.id
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- current_organization_id só muda via switch_organization (coluna protegida)
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

create policy subs_select on public.subscriptions for select to authenticated
  using ((select private.is_member(organization_id)));
-- Nenhuma policy de escrita: só o servidor (webhook Asaas) altera assinatura.

-- Dados operacionais: exigem assinatura ativa.
create policy pipelines_select on public.pipelines for select to authenticated
  using ((select private.can_access(organization_id)));
create policy pipelines_write on public.pipelines for all to authenticated
  using ((select private.can_manage(organization_id)))
  with check ((select private.can_manage(organization_id)));

create policy stages_select on public.stages for select to authenticated
  using ((select private.can_access(organization_id)));
create policy stages_write on public.stages for all to authenticated
  using ((select private.can_manage(organization_id)))
  with check ((select private.can_manage(organization_id)));

create policy tags_select on public.tags for select to authenticated
  using ((select private.can_access(organization_id)));
create policy tags_insert on public.tags for insert to authenticated
  with check ((select private.can_access(organization_id)));
create policy tags_modify on public.tags for update to authenticated
  using ((select private.can_manage(organization_id)))
  with check ((select private.can_manage(organization_id)));
create policy tags_delete on public.tags for delete to authenticated
  using ((select private.can_manage(organization_id)));

create policy leads_select on public.leads for select to authenticated
  using ((select private.can_access(organization_id)));
create policy leads_insert on public.leads for insert to authenticated
  with check ((select private.can_access(organization_id)));
create policy leads_update on public.leads for update to authenticated
  using ((select private.can_access(organization_id)))
  with check ((select private.can_access(organization_id)));
create policy leads_delete on public.leads for delete to authenticated
  using ((select private.can_manage(organization_id)));

create policy lead_tags_select on public.lead_tags for select to authenticated
  using ((select private.can_access(organization_id)));
create policy lead_tags_insert on public.lead_tags for insert to authenticated
  with check ((select private.can_access(organization_id)));
create policy lead_tags_delete on public.lead_tags for delete to authenticated
  using ((select private.can_access(organization_id)));

create policy activities_select on public.activities for select to authenticated
  using ((select private.can_access(organization_id)));
create policy activities_insert on public.activities for insert to authenticated
  with check ((select private.can_access(organization_id)) and actor_id = (select auth.uid()));

create policy channels_select on public.whatsapp_channels for select to authenticated
  using ((select private.can_access(organization_id)));
-- Criação/alteração de canal passa pelo servidor (precisa gravar segredos).

create policy conversations_select on public.conversations for select to authenticated
  using ((select private.can_access(organization_id)));
create policy conversations_update on public.conversations for update to authenticated
  using ((select private.can_access(organization_id)))
  with check ((select private.can_access(organization_id)));
revoke update on public.conversations from authenticated;
grant update (unread_count, lead_id) on public.conversations to authenticated;

create policy messages_select on public.messages for select to authenticated
  using ((select private.can_access(organization_id)));
-- Envio de mensagem passa pelo servidor (chama a API do WhatsApp).

create policy quick_replies_select on public.quick_replies for select to authenticated
  using ((select private.can_access(organization_id)));
create policy quick_replies_write on public.quick_replies for all to authenticated
  using ((select private.can_access(organization_id)))
  with check ((select private.can_access(organization_id)));

create policy voice_select on public.voice_commands for select to authenticated
  using ((select private.can_access(organization_id)) and user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Tempo real
-- -----------------------------------------------------------------------------
alter publication supabase_realtime add table public.leads, public.lead_tags, public.conversations, public.messages, public.whatsapp_channels;
alter table public.leads replica identity full;
alter table public.lead_tags replica identity full;
