-- =============================================================================
-- Relatórios mensais
--  - report_templates: modelos (PDF/Word) enviados pelo usuário — biblioteca
--    pessoal, reutilizável em todas as empresas que ele administra.
--  - monthly_goals: metas do mês por empresa.
--  - report_settings: para onde/quando enviar o relatório de cada empresa.
--  - report_notes: comentários do mês (contexto para a análise).
--  - report_runs: histórico de geração/envio (único por empresa+mês no automático).
--  - Ligações: registradas em activities (type = 'call').
-- =============================================================================

create type public.goal_metric as enum ('new_leads', 'won_count', 'won_value', 'calls', 'followups', 'appointments');
create type public.report_run_status as enum ('generating', 'generated', 'sent', 'failed');
create type public.report_run_kind as enum ('auto', 'manual', 'preview');

create table public.report_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  file_name text not null,
  file_mime text not null,
  file_path text not null,
  blueprint jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index report_templates_owner_idx on public.report_templates (owner_id, created_at desc);
alter table public.report_templates enable row level security;
create policy report_templates_select on public.report_templates for select to authenticated
  using (owner_id = (select auth.uid()));
create policy report_templates_delete on public.report_templates for delete to authenticated
  using (owner_id = (select auth.uid()));

create table public.monthly_goals (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  period date not null check (extract(day from period) = 1),
  metric public.goal_metric not null,
  target numeric(14, 2) not null check (target >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, period, metric)
);
alter table public.monthly_goals enable row level security;
create policy goals_select on public.monthly_goals for select to authenticated
  using ((select private.can_access(organization_id)));
create policy goals_insert on public.monthly_goals for insert to authenticated
  with check ((select private.can_manage(organization_id)));
create policy goals_update on public.monthly_goals for update to authenticated
  using ((select private.can_manage(organization_id))) with check ((select private.can_manage(organization_id)));
create policy goals_delete on public.monthly_goals for delete to authenticated
  using ((select private.can_manage(organization_id)));

create table public.report_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  enabled boolean not null default false,
  template_id uuid references public.report_templates (id) on delete set null,
  template_name text,
  channel_id uuid references public.whatsapp_channels (id) on delete set null,
  target_type text check (target_type in ('group', 'phone')),
  target_id text,
  target_name text,
  send_hour smallint not null default 18 check (send_hour between 0 and 23),
  time_zone text not null default 'America/Sao_Paulo',
  caption text check (caption is null or char_length(caption) <= 1000),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index report_settings_template_idx on public.report_settings (template_id);
create index report_settings_channel_idx on public.report_settings (channel_id);
create index report_settings_updated_by_idx on public.report_settings (updated_by);
alter table public.report_settings enable row level security;
create policy report_settings_select on public.report_settings for select to authenticated
  using ((select private.can_access(organization_id)));
-- Escrita só pelo servidor (valida modelo, canal e destino).

create table public.report_notes (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  period date not null check (extract(day from period) = 1),
  notes text not null default '' check (char_length(notes) <= 5000),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, period)
);
create index report_notes_updated_by_idx on public.report_notes (updated_by);
alter table public.report_notes enable row level security;
create policy report_notes_select on public.report_notes for select to authenticated
  using ((select private.can_access(organization_id)));
create policy report_notes_insert on public.report_notes for insert to authenticated
  with check ((select private.can_access(organization_id)) and updated_by = (select auth.uid()));
create policy report_notes_update on public.report_notes for update to authenticated
  using ((select private.can_access(organization_id))) with check ((select private.can_access(organization_id)) and updated_by = (select auth.uid()));

create table public.report_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  period date not null check (extract(day from period) = 1),
  kind public.report_run_kind not null,
  status public.report_run_status not null default 'generating',
  pdf_path text,
  summary text,
  target_name text,
  error text,
  attempts integer not null default 1,
  requested_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
-- Um envio automático por empresa e mês (impede relatório duplicado no grupo)
create unique index report_runs_auto_uq on public.report_runs (organization_id, period) where kind = 'auto';
create index report_runs_org_idx on public.report_runs (organization_id, created_at desc);
create index report_runs_requested_by_idx on public.report_runs (requested_by);
alter table public.report_runs enable row level security;
create policy report_runs_select on public.report_runs for select to authenticated
  using ((select private.can_access(organization_id)));

create index activities_org_type_idx on public.activities (organization_id, type, created_at);

-- -----------------------------------------------------------------------------
-- Números do mês para o relatório (security invoker: respeita a RLS)
-- -----------------------------------------------------------------------------
create or replace function public.report_metrics(org uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with
  st as (
    select s.id, s.name, s.kind, s.position, p.position as ppos
    from public.stages s join public.pipelines p on p.id = s.pipeline_id
    where s.organization_id = org
  ),
  moves as (
    select distinct on (a.lead_id, st.kind) a.lead_id, st.kind
    from public.activities a join st on st.id = (a.payload ->> 'to')::uuid
    where a.organization_id = org and a.type = 'stage_changed'
      and a.created_at >= p_from and a.created_at < p_to and st.kind in ('won', 'lost')
  ),
  closed as (select m.kind, l.value, l.assigned_to, l.source from moves m join public.leads l on l.id = m.lead_id),
  calls as (
    select a.payload ->> 'outcome' as outcome from public.activities a
    where a.organization_id = org and a.type = 'call' and a.created_at >= p_from and a.created_at < p_to
  ),
  newl as (select l.source from public.leads l where l.organization_id = org and l.created_at >= p_from and l.created_at < p_to)
  select jsonb_build_object(
    'new_leads', (select count(*) from newl),
    'won_count', (select count(*) from closed where kind = 'won'),
    'won_value', (select coalesce(sum(value), 0) from closed where kind = 'won'),
    'lost_count', (select count(*) from closed where kind = 'lost'),
    'calls', (select count(*) from calls),
    'calls_answered', (select count(*) from calls where outcome = 'atendeu'),
    'scheduled_sent', (select count(*) from public.scheduled_messages sm
                        where sm.organization_id = org and sm.status = 'sent' and sm.sent_at >= p_from and sm.sent_at < p_to),
    'appointments', (select count(*) from public.appointments ap
                      where ap.organization_id = org and ap.created_at >= p_from and ap.created_at < p_to),
    'appointments_held', (select count(*) from public.appointments ap
                      where ap.organization_id = org and ap.status = 'scheduled' and ap.starts_at >= p_from and ap.starts_at < p_to and ap.starts_at < now()),
    'messages_in', (select count(*) from public.messages m where m.organization_id = org and m.direction = 'in' and m.sent_at >= p_from and m.sent_at < p_to),
    'messages_out', (select count(*) from public.messages m where m.organization_id = org and m.direction = 'out' and m.sent_at >= p_from and m.sent_at < p_to),
    'open_count', (select count(*) from public.leads l join st on st.id = l.stage_id where l.organization_id = org and st.kind = 'open'),
    'open_value', (select coalesce(sum(l.value), 0) from public.leads l join st on st.id = l.stage_id where l.organization_id = org and st.kind = 'open'),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('name', s, 'count', n) order by n desc)
                  from (select coalesce(nullif(source, ''), 'Manual') s, count(*) n from newl group by 1) t), '[]'::jsonb),
    'won_by_source', coalesce((select jsonb_agg(jsonb_build_object('name', s, 'count', n, 'value', v) order by v desc)
                  from (select coalesce(nullif(source, ''), 'Manual') s, count(*) n, sum(value) v from closed where kind = 'won' group by 1) t), '[]'::jsonb),
    'by_stage', coalesce((select jsonb_agg(jsonb_build_object('name', st.name, 'count', coalesce(x.n, 0)) order by st.ppos, st.position)
                  from st left join (select stage_id, count(*) n from public.leads where organization_id = org group by stage_id) x on x.stage_id = st.id), '[]'::jsonb),
    'won_by_owner', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(p.full_name, p.email, 'Sem responsável'), 'count', n, 'value', v) order by v desc)
                  from (select assigned_to, count(*) n, sum(value) v from closed where kind = 'won' group by assigned_to) t
                  left join public.profiles p on p.id = t.assigned_to), '[]'::jsonb)
  );
$$;
revoke execute on function public.report_metrics(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_metrics(uuid, timestamptz, timestamptz) to authenticated, service_role;
