-- Automações (estilo n8n / Kommo): gatilho → passos (mensagem, esperar, mover, tag, responsável, webhook…).

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  enabled boolean not null default false,
  trigger jsonb not null,
  steps jsonb not null default '[]'::jsonb,
  once_per_lead boolean not null default true,
  stop_on_reply boolean not null default false,
  state jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index automations_org_idx on public.automations (organization_id) where enabled;
alter table public.automations enable row level security;
create policy automations_select on public.automations for select to authenticated using ((select private.can_manage(organization_id)));

create table public.automation_runs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  automation_id uuid not null references public.automations (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'processing', 'waiting', 'done', 'stopped', 'failed')),
  step_index integer not null default 0,
  resume_at timestamptz,
  log jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index automation_runs_due_idx on public.automation_runs (resume_at) where status in ('running', 'waiting');
create index automation_runs_auto_idx on public.automation_runs (automation_id, created_at desc);
create index automation_runs_lead_idx on public.automation_runs (lead_id, automation_id);
alter table public.automation_runs enable row level security;
create policy automation_runs_select on public.automation_runs for select to authenticated using ((select private.can_manage(organization_id)));

-- Fila de acontecimentos que podem disparar automações
create table public.automation_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  type text not null check (type in ('lead_created', 'stage_changed', 'tag_added', 'message_received')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index automation_events_pending_idx on public.automation_events (id) where processed_at is null;
alter table public.automation_events enable row level security;

create or replace function private.has_automations(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.automations a where a.organization_id = org and a.enabled);
$$;

create or replace function private.automation_lead_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_automations(new.organization_id) then return null; end if;
  if tg_op = 'INSERT' then
    insert into public.automation_events (organization_id, lead_id, type, data)
    values (new.organization_id, new.id, 'lead_created', jsonb_build_object('stage_id', new.stage_id, 'source', new.source));
  elsif new.stage_id is distinct from old.stage_id then
    insert into public.automation_events (organization_id, lead_id, type, data)
    values (new.organization_id, new.id, 'stage_changed', jsonb_build_object('from', old.stage_id, 'to', new.stage_id));
  end if;
  return null;
end $$;
create trigger leads_automation_event after insert or update of stage_id on public.leads
  for each row execute function private.automation_lead_event();

create or replace function private.automation_tag_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_automations(new.organization_id) then return null; end if;
  insert into public.automation_events (organization_id, lead_id, type, data)
  values (new.organization_id, new.lead_id, 'tag_added', jsonb_build_object('tag_id', new.tag_id));
  return null;
end $$;
create trigger lead_tags_automation_event after insert on public.lead_tags
  for each row execute function private.automation_tag_event();

-- Mensagem do cliente (só as recentes: importação de histórico não dispara nada)
create or replace function private.automation_message_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_lead uuid;
begin
  if new.direction <> 'in' or new.sent_at < now() - interval '10 minutes' then return null; end if;
  if not private.has_automations(new.organization_id) then return null; end if;
  select c.lead_id into v_lead from public.conversations c where c.id = new.conversation_id;
  if v_lead is null then return null; end if;
  insert into public.automation_events (organization_id, lead_id, type, data)
  values (new.organization_id, v_lead, 'message_received', jsonb_build_object('text', left(coalesce(new.body, new.transcript, ''), 1000), 'conversation_id', new.conversation_id));
  return null;
end $$;
create trigger messages_automation_event after insert on public.messages
  for each row execute function private.automation_message_event();

revoke execute on function private.has_automations(uuid) from public, anon, authenticated;
