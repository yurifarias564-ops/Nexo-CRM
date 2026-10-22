-- =============================================================================
-- 1) Limite de uso por usuário (proteção contra abuso e custo de IA)
-- 2) Métricas do painel numa única chamada (respeita RLS: security invoker)
-- =============================================================================

create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);
alter table public.rate_limits enable row level security;
-- Sem políticas: só o servidor usa.

-- Retorna true se ainda está dentro do limite (e contabiliza a chamada).
create or replace function public.hit_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare h integer;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into h;
  return h <= p_limit;
end $$;
revoke execute on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

-- -----------------------------------------------------------------------------
-- Painel de métricas
-- -----------------------------------------------------------------------------
create index if not exists activities_org_type_created_idx on public.activities (organization_id, type, created_at);
create index if not exists messages_org_sent_idx on public.messages (organization_id, sent_at);

create or replace function public.dashboard_stats(org uuid, p_from timestamptz, p_to timestamptz, p_tz text default 'America/Sao_Paulo')
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with
  st as (
    select s.id, s.name, s.color, s.kind, s.position, p.name as pipeline, p.position as ppos
    from public.stages s join public.pipelines p on p.id = s.pipeline_id
    where s.organization_id = org
  ),
  moves as (
    select distinct on (a.lead_id, st.kind) a.lead_id, st.kind
    from public.activities a
    join st on st.id = (a.payload ->> 'to')::uuid
    where a.organization_id = org and a.type = 'stage_changed'
      and a.created_at >= p_from and a.created_at < p_to and st.kind in ('won', 'lost')
  ),
  closed as (
    select m.kind, m.lead_id, l.value, l.assigned_to
    from moves m join public.leads l on l.id = m.lead_id
  ),
  new_leads as (
    select l.* from public.leads l
    where l.organization_id = org and l.created_at >= p_from and l.created_at < p_to
  ),
  days as (
    select d::date as day
    from generate_series((p_from at time zone p_tz)::date, ((p_to - interval '1 second') at time zone p_tz)::date, interval '1 day') d
  ),
  msg as (
    select (m.sent_at at time zone p_tz)::date as day,
           count(*) filter (where m.direction = 'in') as inbound,
           count(*) filter (where m.direction = 'out') as outbound
    from public.messages m
    where m.organization_id = org and m.sent_at >= p_from and m.sent_at < p_to
    group by 1
  )
  select jsonb_build_object(
    'new_leads', (select count(*) from new_leads),
    'open_count', (select count(*) from public.leads l join st on st.id = l.stage_id where l.organization_id = org and st.kind = 'open'),
    'open_value', (select coalesce(sum(l.value), 0) from public.leads l join st on st.id = l.stage_id where l.organization_id = org and st.kind = 'open'),
    'won_count', (select count(*) from closed where kind = 'won'),
    'won_value', (select coalesce(sum(value), 0) from closed where kind = 'won'),
    'lost_count', (select count(*) from closed where kind = 'lost'),
    'by_stage', coalesce((
      select jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name, 'color', st.color, 'kind', st.kind, 'pipeline', st.pipeline,
                                          'count', coalesce(x.n, 0), 'value', coalesce(x.v, 0)) order by st.ppos, st.position)
      from st left join (
        select l.stage_id, count(*) n, sum(l.value) v from public.leads l where l.organization_id = org group by l.stage_id
      ) x on x.stage_id = st.id
    ), '[]'::jsonb),
    'by_source', coalesce((
      select jsonb_agg(jsonb_build_object('name', s, 'count', n) order by n desc)
      from (select coalesce(nullif(source, ''), 'Manual') s, count(*) n from new_leads group by 1) t
    ), '[]'::jsonb),
    'by_tag', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'color', t.color, 'count', x.n) order by x.n desc)
      from (
        select lt.tag_id, count(*) n from public.lead_tags lt join new_leads nl on nl.id = lt.lead_id group by lt.tag_id order by n desc limit 8
      ) x join public.tags t on t.id = x.tag_id
    ), '[]'::jsonb),
    'by_owner', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', assigned_to, 'won_count', n, 'won_value', v) order by v desc)
      from (select assigned_to, count(*) n, sum(value) v from closed where kind = 'won' group by assigned_to) t
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'in', coalesce(msg.inbound, 0), 'out', coalesce(msg.outbound, 0)) order by d.day)
      from days d left join msg on msg.day = d.day
    ), '[]'::jsonb)
  );
$$;
revoke execute on function public.dashboard_stats(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.dashboard_stats(uuid, timestamptz, timestamptz, text) to authenticated;
