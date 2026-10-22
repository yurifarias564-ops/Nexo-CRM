-- =============================================================================
-- Time comercial v2 — mesmo modelo do playbook (Notebook CE):
--  - Função (SDR / Closer) e loja de cada pessoa; metas por função.
--  - Lojas com meta de faturamento do período e meta de OS por dia.
--  - Metas de RESULTADO ligadas a uma atividade (conversão = resultado ÷ feito).
--  - Meta individual fixa por pessoa (dia / semana / mês); sem ela vale a padrão.
--  - OS fechadas registradas uma a uma (valor, nº da OS, SDR de origem).
--  - Bloco de notas do dia por pessoa.
--  - Ciclo da consultoria (data de início → períodos de 30 dias) e marco zero.
-- =============================================================================

-- Lojas -----------------------------------------------------------------------
create table public.team_stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  revenue_goal numeric(14, 2) check (revenue_goal is null or revenue_goal >= 0),
  os_daily_goal numeric(10, 2) check (os_daily_goal is null or os_daily_goal >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index team_stores_org_idx on public.team_stores (organization_id, position);
alter table public.team_stores enable row level security;
create policy team_stores_select on public.team_stores for select to authenticated using ((select private.can_access(organization_id)));
create policy team_stores_insert on public.team_stores for insert to authenticated with check ((select private.can_manage(organization_id)));
create policy team_stores_update on public.team_stores for update to authenticated
  using ((select private.can_manage(organization_id))) with check ((select private.can_manage(organization_id)));
create policy team_stores_delete on public.team_stores for delete to authenticated using ((select private.can_manage(organization_id)));

-- Pessoas: função e loja --------------------------------------------------------
alter table public.team_sellers
  add column role text check (role in ('sdr', 'closer')),
  add column store_id uuid references public.team_stores (id) on delete set null;
create index team_sellers_store_idx on public.team_sellers (store_id);

create or replace function private.team_sellers_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null and not exists (
    select 1 from public.organization_members m where m.organization_id = new.organization_id and m.user_id = new.user_id
  ) then
    raise exception 'Usuário não pertence à empresa' using errcode = '23514';
  end if;
  if new.store_id is not null and not exists (
    select 1 from public.team_stores s where s.id = new.store_id and s.organization_id = new.organization_id
  ) then
    raise exception 'Loja de outra empresa' using errcode = '23514';
  end if;
  return new;
end $$;

-- Indicadores: função, resultado de, meta semanal, origem OS ---------------------
-- Origem ganha "os_count"/"os_value". Sem apagar nada: a coluna antiga vira
-- source_v1 (sem uso) e a nova "source" aceita as origens novas.
alter table public.team_metrics rename column source to source_v1;
alter table public.team_metrics add column source text not null default 'manual'
  check (source in ('manual', 'calls', 'calls_answered', 'won_count', 'won_value', 'appointments', 'followups_sent', 'os_count', 'os_value'));
update public.team_metrics set source = source_v1;
alter table public.team_metrics
  add column role text not null default 'todos' check (role in ('todos', 'sdr', 'closer')),
  add column result_of uuid references public.team_metrics (id) on delete cascade,
  add column weekly_target numeric(14, 2) check (weekly_target is null or weekly_target >= 0);
create index team_metrics_result_of_idx on public.team_metrics (result_of);

create or replace function private.team_metrics_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.result_of is not null then
    if new.result_of = new.id or not exists (
      select 1 from public.team_metrics p where p.id = new.result_of and p.organization_id = new.organization_id
        and p.result_of is null and p.source = 'manual'
    ) then
      raise exception 'Resultado precisa estar ligado a uma atividade manual da mesma empresa' using errcode = '23514';
    end if;
    if new.source <> 'manual' then
      raise exception 'Resultado é sempre preenchido à mão' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger team_metrics_check before insert or update on public.team_metrics
  for each row execute function private.team_metrics_check();

-- Metas individuais fixas (substituem as metas por mês da v1) ---------------------
-- team_goals (metas por mês da v1) deixa de ser usada; fica vazia.

create table public.team_seller_goals (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  seller_id uuid not null references public.team_sellers (id) on delete cascade,
  metric_id uuid not null references public.team_metrics (id) on delete cascade,
  daily_target numeric(14, 2) check (daily_target is null or daily_target >= 0),
  weekly_target numeric(14, 2) check (weekly_target is null or weekly_target >= 0),
  monthly_target numeric(14, 2) check (monthly_target is null or monthly_target >= 0),
  updated_at timestamptz not null default now(),
  primary key (seller_id, metric_id)
);
create index team_seller_goals_org_idx on public.team_seller_goals (organization_id);
create index team_seller_goals_metric_idx on public.team_seller_goals (metric_id);
alter table public.team_seller_goals enable row level security;
create policy team_seller_goals_select on public.team_seller_goals for select to authenticated using ((select private.can_access(organization_id)));
create policy team_seller_goals_insert on public.team_seller_goals for insert to authenticated with check ((select private.can_manage(organization_id)));
create policy team_seller_goals_update on public.team_seller_goals for update to authenticated
  using ((select private.can_manage(organization_id))) with check ((select private.can_manage(organization_id)));
create policy team_seller_goals_delete on public.team_seller_goals for delete to authenticated using ((select private.can_manage(organization_id)));
create trigger team_seller_goals_check before insert or update on public.team_seller_goals
  for each row execute function private.team_rows_check();

-- Lançamento manual só em atividade/resultado manual (os_* vêm das OS) -------------
-- (team_rows_check já recusa indicador não manual em team_entries)

-- OS fechadas -------------------------------------------------------------------
create table public.team_sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  seller_id uuid not null references public.team_sellers (id) on delete cascade,
  store_id uuid references public.team_stores (id) on delete set null,
  sdr_id uuid references public.team_sellers (id) on delete set null,
  day date not null,
  value numeric(14, 2) not null default 0 check (value >= 0 and value <= 100000000),
  os_number text check (os_number is null or char_length(os_number) <= 40),
  note text check (note is null or char_length(note) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index team_sales_org_day_idx on public.team_sales (organization_id, day);
create index team_sales_seller_idx on public.team_sales (seller_id, day);
create index team_sales_store_idx on public.team_sales (store_id);
create index team_sales_sdr_idx on public.team_sales (sdr_id);
create index team_sales_created_by_idx on public.team_sales (created_by);

create or replace function private.team_sales_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_store uuid;
begin
  select s.store_id into v_store from public.team_sellers s where s.id = new.seller_id and s.organization_id = new.organization_id;
  if not found then raise exception 'Vendedor de outra empresa' using errcode = '23514'; end if;
  if new.sdr_id is not null and not exists (
    select 1 from public.team_sellers s where s.id = new.sdr_id and s.organization_id = new.organization_id
  ) then
    raise exception 'SDR de outra empresa' using errcode = '23514';
  end if;
  if new.day > current_date + 1 then raise exception 'Não é possível registrar em data futura' using errcode = '23514'; end if;
  if tg_op = 'INSERT' then new.store_id := coalesce(new.store_id, v_store); end if;
  if new.store_id is not null and not exists (
    select 1 from public.team_stores t where t.id = new.store_id and t.organization_id = new.organization_id
  ) then
    raise exception 'Loja de outra empresa' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger team_sales_check before insert or update on public.team_sales
  for each row execute function private.team_sales_check();

alter table public.team_sales enable row level security;
create policy team_sales_select on public.team_sales for select to authenticated using ((select private.can_access(organization_id)));
create policy team_sales_insert on public.team_sales for insert to authenticated
  with check (private.team_can_fill(seller_id) and created_by = (select auth.uid()));
create policy team_sales_update on public.team_sales for update to authenticated
  using (private.team_can_fill(seller_id)) with check (private.team_can_fill(seller_id));
create policy team_sales_delete on public.team_sales for delete to authenticated using (private.team_can_fill(seller_id));

-- Bloco de notas do dia -----------------------------------------------------------
create table public.team_notes (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  seller_id uuid not null references public.team_sellers (id) on delete cascade,
  day date not null,
  body text not null default '' check (char_length(body) <= 8000),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (seller_id, day)
);
create index team_notes_org_day_idx on public.team_notes (organization_id, day);
create index team_notes_updated_by_idx on public.team_notes (updated_by);

create or replace function private.team_notes_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.team_sellers s where s.id = new.seller_id and s.organization_id = new.organization_id) then
    raise exception 'Vendedor de outra empresa' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger team_notes_check before insert or update on public.team_notes
  for each row execute function private.team_notes_check();

alter table public.team_notes enable row level security;
create policy team_notes_select on public.team_notes for select to authenticated using ((select private.can_access(organization_id)));
create policy team_notes_insert on public.team_notes for insert to authenticated
  with check (private.team_can_fill(seller_id) and updated_by = (select auth.uid()));
create policy team_notes_update on public.team_notes for update to authenticated
  using (private.team_can_fill(seller_id)) with check (private.team_can_fill(seller_id) and updated_by = (select auth.uid()));

-- Configuração: ciclo da consultoria e marco zero -----------------------------------
create table public.team_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  cycle_start date,
  baseline jsonb not null default '{}'::jsonb,
  baseline_note text check (baseline_note is null or char_length(baseline_note) <= 2000),
  updated_at timestamptz not null default now()
);
alter table public.team_settings enable row level security;
create policy team_settings_select on public.team_settings for select to authenticated using ((select private.can_access(organization_id)));
create policy team_settings_insert on public.team_settings for insert to authenticated with check ((select private.can_manage(organization_id)));
create policy team_settings_update on public.team_settings for update to authenticated
  using ((select private.can_manage(organization_id))) with check ((select private.can_manage(organization_id)));

-- Realizado: inclui OS fechadas e faturamento das OS --------------------------------
create or replace function public.team_values(org uuid, p_from date, p_to date, tz text default 'America/Sao_Paulo')
returns table (seller_id uuid, metric_id uuid, day date, value numeric)
language sql stable security invoker set search_path = '' as $$
  with
  rng as (select (p_from::timestamp at time zone tz) as t0, ((p_to + 1)::timestamp at time zone tz) as t1),
  sel as (select s.id, s.user_id from public.team_sellers s where s.organization_id = org),
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
  os as (
    select ts.seller_id as sid, ts.day as d, count(*) as n, coalesce(sum(ts.value), 0) as v
    from public.team_sales ts
    where ts.organization_id = org and ts.day between p_from and p_to
    group by 1, 2
  ),
  auto as (
    select sel.id as seller_id, met.id as metric_id, x.d as day, x.val as value
    from sel cross join met
    join lateral (
      select c.d, (case met.source when 'calls' then c.n else c.answered end)::numeric as val
        from calls c where sel.user_id is not null and c.uid = sel.user_id and met.source in ('calls', 'calls_answered')
      union all
      select w.d, (case met.source when 'won_count' then w.n else w.v end)::numeric
        from won w where sel.user_id is not null and w.uid = sel.user_id and met.source in ('won_count', 'won_value')
      union all
      select p.d, p.n::numeric from appts p where sel.user_id is not null and p.uid = sel.user_id and met.source = 'appointments'
      union all
      select f.d, f.n::numeric from fups f where sel.user_id is not null and f.uid = sel.user_id and met.source = 'followups_sent'
      union all
      select o.d, (case met.source when 'os_count' then o.n else o.v end)::numeric
        from os o where o.sid = sel.id and met.source in ('os_count', 'os_value')
    ) x on true
  )
  select e.seller_id, e.metric_id, e.day, e.value
  from public.team_entries e
  where e.organization_id = org and e.day between p_from and p_to
  union all
  select a.seller_id, a.metric_id, a.day, a.value from auto a where a.value > 0;
$$;

alter publication supabase_realtime add table public.team_sales, public.team_notes;
