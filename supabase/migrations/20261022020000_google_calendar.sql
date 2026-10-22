-- =============================================================================
-- Google Agenda + agendamentos
-- Cada usuário conecta o próprio Google. As credenciais OAuth ficam numa
-- tabela sem políticas (só o servidor lê). Os agendamentos ficam no CRM
-- mesmo se o Google não estiver conectado.
-- =============================================================================

create type public.appointment_status as enum ('scheduled', 'canceled');

create table public.google_connections (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  google_email text,
  calendar_id text not null default 'primary',
  connected_at timestamptz not null default now()
);
alter table public.google_connections enable row level security;
create policy google_connections_select on public.google_connections for select to authenticated
  using (user_id = (select auth.uid()));

create table public.google_credentials (
  user_id uuid primary key references public.google_connections (user_id) on delete cascade,
  refresh_grant text not null,
  access_grant text,
  access_expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.google_credentials enable row level security;
-- Sem políticas: só o servidor (service role) acessa.

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  time_zone text not null default 'America/Sao_Paulo',
  status public.appointment_status not null default 'scheduled',
  google_event_id text,
  google_calendar_id text,
  google_link text,
  created_at timestamptz not null default now(),
  constraint appointments_time_ck check (ends_at > starts_at)
);
create index appointments_lead_idx on public.appointments (lead_id, starts_at desc);
create index appointments_org_start_idx on public.appointments (organization_id, starts_at);
create index appointments_user_idx on public.appointments (user_id);
alter table public.appointments enable row level security;

create policy appointments_select on public.appointments for select to authenticated
  using ((select private.can_access(organization_id)));
create policy appointments_insert on public.appointments for insert to authenticated
  with check ((select private.can_access(organization_id)) and user_id = (select auth.uid()));
create policy appointments_update on public.appointments for update to authenticated
  using ((select private.can_access(organization_id)))
  with check ((select private.can_access(organization_id)));

-- O lead do agendamento precisa ser da mesma empresa
create or replace function private.appointments_check_integrity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.leads where id = new.lead_id and organization_id = new.organization_id) then
    raise exception 'Lead de outra empresa' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger appointments_integrity before insert or update of lead_id, organization_id on public.appointments
  for each row execute function private.appointments_check_integrity();

-- Funil padrão de novas empresas passa a ter a etapa "Agendamento"
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
    (org, pipe, 'Agendamento',      '#06b6d4', 'open', 2),
    (org, pipe, 'Negociação',       '#8b5cf6', 'open', 3),
    (org, pipe, 'Proposta enviada', '#f59e0b', 'open', 4),
    (org, pipe, 'Ganho',            '#10b981', 'won',  5),
    (org, pipe, 'Perdido',          '#ef4444', 'lost', 6);

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
