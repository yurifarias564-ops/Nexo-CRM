-- =============================================================================
-- Acompanhamento do time comercial
--  - team_sellers: vendedores(as) da empresa (podem ou não ter login no CRM).
--  - team_metrics: indicadores configuráveis (ex.: "Contatos no Instagram"),
--    preenchidos à mão ou calculados do CRM (ligações, vendas, agendamentos...).
--  - team_goals: meta diária/mensal de cada vendedor por mês (sobrepõe o padrão).
--  - team_entries: lançamento do dia (o "checklist" — um por vendedor/indicador/dia).
--  - team_values(): realizado por vendedor/indicador/dia (manual + automático).
-- =============================================================================

create table public.team_sellers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  user_id uuid references public.profiles (id) on delete set null,
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index team_sellers_org_idx on public.team_sellers (organization_id, position);
create index team_sellers_user_idx on public.team_sellers (user_id);
create unique index team_sellers_org_user_uq on public.team_sellers (organization_id, user_id) where user_id is not null;

create table public.team_metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  unit text not null default 'count' check (unit in ('count', 'money')),
  source text not null default 'manual'
    check (source in ('manual', 'calls', 'calls_answered', 'won_count', 'won_value', 'appointments', 'followups_sent')),
  daily_target numeric(14, 2) check (daily_target is null or daily_target >= 0),
  monthly_target numeric(14, 2) check (monthly_target is null or monthly_target >= 0),
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index team_metrics_org_idx on public.team_metrics (organization_id, position);

create table public.team_goals (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  seller_id uuid not null references public.team_sellers (id) on delete cascade,
  metric_id uuid not null references public.team_metrics (id) on delete cascade,
  period date not null check (extract(day from period) = 1),
  daily_target numeric(14, 2) check (daily_target is null or daily_target >= 0),
  monthly_target numeric(14, 2) check (monthly_target is null or monthly_target >= 0),
  updated_at timestamptz not null default now(),
  primary key (seller_id, metric_id, period)
);
create index team_goals_org_idx on public.team_goals (organization_id, period);
create index team_goals_metric_idx on public.team_goals (metric_id);

create table public.team_entries (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  seller_id uuid not null references public.team_sellers (id) on delete cascade,
  metric_id uuid not null references public.team_metrics (id) on delete cascade,
  day date not null,
  value numeric(14, 2) not null default 0 check (value >= 0 and value <= 1000000000),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (seller_id, metric_id, day)
);
create index team_entries_org_day_idx on public.team_entries (organization_id, day);
create index team_entries_metric_idx on public.team_entries (metric_id);
create index team_entries_updated_by_idx on public.team_entries (updated_by);

-- -----------------------------------------------------------------------------
-- Integridade: tudo da mesma empresa; vendedor com login precisa ser membro;
-- lançamento manual só em indicador manual e nunca no futuro distante.
-- -----------------------------------------------------------------------------
create or replace function private.team_sellers_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null and not exists (
    select 1 from public.organization_members m where m.organization_id = new.organization_id and m.user_id = new.user_id
  ) then
    raise exception 'Usuário não pertence à empresa' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger team_sellers_check before insert or update on public.team_sellers
  for each row execute function private.team_sellers_check();

create or replace function private.team_rows_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_src text;
begin
  if not exists (select 1 from public.team_sellers s where s.id = new.seller_id and s.organization_id = new.organization_id) then
    raise exception 'Vendedor de outra empresa' using errcode = '23514';
  end if;
  select m.source into v_src from public.team_metrics m where m.id = new.metric_id and m.organization_id = new.organization_id;
  if v_src is null then
    raise exception 'Indicador de outra empresa' using errcode = '23514';
  end if;
  if tg_table_name = 'team_entries' then
    if v_src <> 'manual' then
      raise exception 'Este indicador é calculado automaticamente pelo CRM' using errcode = '23514';
    end if;
    if new.day > current_date + 1 then
      raise exception 'Não é possível lançar em data futura' using errcode = '23514';
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger team_goals_check before insert or update on public.team_goals
  for each row execute function private.team_rows_check();
create trigger team_entries_check before insert or update on public.team_entries
  for each row execute function private.team_rows_check();

-- Quem pode preencher o checklist de um vendedor: administradores, qualquer
-- membro para vendedores sem login, e o próprio vendedor quando tem login.
create or replace function private.team_can_fill(p_seller uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_sellers s
    where s.id = p_seller
      and private.can_access(s.organization_id)
      and (s.user_id is null or s.user_id = (select auth.uid()) or private.can_manage(s.organization_id))
  );
$$;
revoke execute on function private.team_can_fill(uuid) from public, anon;
grant execute on function private.team_can_fill(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.team_sellers enable row level security;
alter table public.team_metrics enable row level security;
alter table public.team_goals enable row level security;
alter table public.team_entries enable row level security;

create policy team_sellers_select on public.team_sellers for select to authenticated using ((select private.can_access(organization_id)));
create policy team_sellers_insert on public.team_sellers for insert to authenticated with check ((select private.can_manage(organization_id)));
create policy team_sellers_update on public.team_sellers for update to authenticated
  using ((select private.can_manage(organization_id))) with check ((select private.can_manage(organization_id)));
create policy team_sellers_delete on public.team_sellers for delete to authenticated using ((select private.can_manage(organization_id)));

create policy team_metrics_select on public.team_metrics for select to authenticated using ((select private.can_access(organization_id)));
create policy team_metrics_insert on public.team_metrics for insert to authenticated with check ((select private.can_manage(organization_id)));
create policy team_metrics_update on public.team_metrics for update to authenticated
  using ((select private.can_manage(organization_id))) with check ((select private.can_manage(organization_id)));
create policy team_metrics_delete on public.team_metrics for delete to authenticated using ((select private.can_manage(organization_id)));

create policy team_goals_select on public.team_goals for select to authenticated using ((select private.can_access(organization_id)));
create policy team_goals_insert on public.team_goals for insert to authenticated with check ((select private.can_manage(organization_id)));
create policy team_goals_update on public.team_goals for update to authenticated
  using ((select private.can_manage(organization_id))) with check ((select private.can_manage(organization_id)));
create policy team_goals_delete on public.team_goals for delete to authenticated using ((select private.can_manage(organization_id)));

create policy team_entries_select on public.team_entries for select to authenticated using ((select private.can_access(organization_id)));
create policy team_entries_insert on public.team_entries for insert to authenticated
  with check (private.team_can_fill(seller_id) and updated_by = (select auth.uid()));
create policy team_entries_update on public.team_entries for update to authenticated
  using (private.team_can_fill(seller_id)) with check (private.team_can_fill(seller_id) and updated_by = (select auth.uid()));
create policy team_entries_delete on public.team_entries for delete to authenticated using (private.team_can_fill(seller_id));

-- -----------------------------------------------------------------------------
-- Realizado por vendedor / indicador / dia (no fuso da empresa).
-- security invoker: respeita a RLS de quem chama.
-- -----------------------------------------------------------------------------
create or replace function public.team_values(org uuid, p_from date, p_to date, tz text default 'America/Sao_Paulo')
returns table (seller_id uuid, metric_id uuid, day date, value numeric)
language sql stable security invoker set search_path = '' as $$
  with
  rng as (select (p_from::timestamp at time zone tz) as t0, ((p_to + 1)::timestamp at time zone tz) as t1),
  sel as (select s.id, s.user_id from public.team_sellers s where s.organization_id = org and s.user_id is not null),
  met as (select m.id, m.source from public.team_metrics m where m.organization_id = org and m.source <> 'manual' and m.active),
  calls as (
    select a.actor_id as uid, (a.created_at at time zone tz)::date as d, count(*) as n,
           count(*) filter (where a.payload ->> 'outcome' = 'atendeu') as answered
    from public.activities a, rng
    where a.organization_id = org and a.type = 'call' and a.created_at >= rng.t0 and a.created_at < rng.t1
    group by 1, 2
  ),
  won as (
    select l.assigned_to as uid, (a.created_at at time zone tz)::date as d, count(*) as n, coalesce(sum(l.value), 0) as v
    from public.activities a
    join public.stages st on st.id = (a.payload ->> 'to')::uuid and st.kind = 'won'
    join public.leads l on l.id = a.lead_id, rng
    where a.organization_id = org and a.type = 'stage_changed' and a.created_at >= rng.t0 and a.created_at < rng.t1
    group by 1, 2
  ),
  appts as (
    select ap.user_id as uid, (ap.created_at at time zone tz)::date as d, count(*) as n
    from public.appointments ap, rng
    where ap.organization_id = org and ap.created_at >= rng.t0 and ap.created_at < rng.t1
    group by 1, 2
  ),
  fups as (
    select sm.created_by as uid, (sm.sent_at at time zone tz)::date as d, count(*) as n
    from public.scheduled_messages sm, rng
    where sm.organization_id = org and sm.status = 'sent' and sm.sent_at >= rng.t0 and sm.sent_at < rng.t1
    group by 1, 2
  ),
  auto as (
    select sel.id as seller_id, met.id as metric_id, x.d as day, x.val as value
    from sel cross join met
    join lateral (
      select c.d, (case met.source when 'calls' then c.n else c.answered end)::numeric as val
        from calls c where c.uid = sel.user_id and met.source in ('calls', 'calls_answered')
      union all
      select w.d, (case met.source when 'won_count' then w.n else w.v end)::numeric
        from won w where w.uid = sel.user_id and met.source in ('won_count', 'won_value')
      union all
      select p.d, p.n::numeric from appts p where p.uid = sel.user_id and met.source = 'appointments'
      union all
      select f.d, f.n::numeric from fups f where f.uid = sel.user_id and met.source = 'followups_sent'
    ) x on true
  )
  select e.seller_id, e.metric_id, e.day, e.value
  from public.team_entries e
  where e.organization_id = org and e.day between p_from and p_to
  union all
  select a.seller_id, a.metric_id, a.day, a.value from auto a where a.value > 0;
$$;
revoke execute on function public.team_values(uuid, date, date, text) from public, anon;
grant execute on function public.team_values(uuid, date, date, text) to authenticated, service_role;

alter publication supabase_realtime add table public.team_entries;
