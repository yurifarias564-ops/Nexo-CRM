-- =============================================================================
-- Privacidade do vendedor (papel "agent")
--  - Dono/administrador: veem tudo da empresa.
--  - Vendedor: vê só os leads dele (responsável = ele) e os leads ainda sem
--    responsável que chegaram por um número (canal) vinculado a ele; as conversas,
--    mensagens, tags, atividades, agendamentos e ligações desses leads; e no Time
--    comercial só os próprios dados.
--  - Número com um único vendedor vinculado: lead novo já cai com ele de responsável.
-- =============================================================================

-- Vínculo número ↔ vendedor ------------------------------------------------------
create table public.channel_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel_id uuid not null references public.whatsapp_channels (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index channel_members_user_idx on public.channel_members (user_id, channel_id);
create index channel_members_org_idx on public.channel_members (organization_id);
alter table public.channel_members enable row level security;

-- Funções de acesso ---------------------------------------------------------------
create or replace function private.sees_all(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_role(org, array['owner','admin']::public.member_role[]);
$$;

create or replace function private.lead_on_my_channel(p_lead uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations c
    join public.channel_members cm on cm.channel_id = c.channel_id and cm.user_id = (select auth.uid())
    where c.lead_id = p_lead
  );
$$;

create or replace function private.lead_visible(p_lead uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead
      and private.can_access(l.organization_id)
      and (
        private.sees_all(l.organization_id)
        or l.assigned_to = (select auth.uid())
        or (l.assigned_to is null and private.lead_on_my_channel(l.id))
      )
  );
$$;

create or replace function private.conversation_visible(p_conv uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conv
      and private.can_access(c.organization_id)
      and (
        private.sees_all(c.organization_id)
        or (c.lead_id is not null and private.lead_visible(c.lead_id))
        or (c.lead_id is null and exists (
              select 1 from public.channel_members cm
              where cm.channel_id = c.channel_id and cm.user_id = (select auth.uid())))
      )
  );
$$;

create or replace function private.is_my_seller(p_seller uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_sellers s where s.id = p_seller and s.user_id = (select auth.uid()));
$$;

-- Quem preenche o checklist: administradores ou a própria pessoa
create or replace function private.team_can_fill(p_seller uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_sellers s
    where s.id = p_seller
      and private.can_access(s.organization_id)
      and (private.can_manage(s.organization_id) or s.user_id = (select auth.uid()))
  );
$$;

revoke execute on function private.sees_all(uuid), private.lead_on_my_channel(uuid), private.lead_visible(uuid),
  private.conversation_visible(uuid), private.is_my_seller(uuid) from public, anon;
grant execute on function private.sees_all(uuid), private.lead_on_my_channel(uuid), private.lead_visible(uuid),
  private.conversation_visible(uuid), private.is_my_seller(uuid) to authenticated;

-- Vínculo: integridade e permissões ---------------------------------------------------
create or replace function private.channel_members_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.whatsapp_channels where id = new.channel_id and organization_id = new.organization_id) then
    raise exception 'Número inválido para esta empresa' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organization_members where organization_id = new.organization_id and user_id = new.user_id) then
    raise exception 'Pessoa não pertence à empresa' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger channel_members_check before insert or update on public.channel_members
  for each row execute function private.channel_members_check();

create policy channel_members_select on public.channel_members for select to authenticated
  using ((select private.can_access(organization_id)) and ((select private.sees_all(organization_id)) or user_id = (select auth.uid())));
create policy channel_members_insert on public.channel_members for insert to authenticated
  with check ((select private.can_manage(organization_id)));
create policy channel_members_delete on public.channel_members for delete to authenticated
  using ((select private.can_manage(organization_id)));

-- Atribuição automática pelo número ---------------------------------------------------
-- Lead sem responsável que fala por um número com UM vendedor vinculado vai para ele.
create or replace function private.assign_by_channel()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if new.lead_id is null then return new; end if;
  select min(cm.user_id::text)::uuid into v_user from public.channel_members cm
  where cm.channel_id = new.channel_id having count(*) = 1;
  if v_user is not null then
    update public.leads set assigned_to = v_user where id = new.lead_id and assigned_to is null;
  end if;
  return new;
end $$;
create trigger conversations_assign_by_channel after insert or update of lead_id, channel_id on public.conversations
  for each row execute function private.assign_by_channel();

-- Ao vincular um vendedor a um número que só tem ele: puxa os leads sem responsável desse número.
create or replace function private.assign_channel_backlog()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.channel_members where channel_id = new.channel_id) = 1 then
    update public.leads l set assigned_to = new.user_id
    where l.assigned_to is null and l.organization_id = new.organization_id
      and exists (select 1 from public.conversations c where c.lead_id = l.id and c.channel_id = new.channel_id);
  end if;
  return new;
end $$;
create trigger channel_members_backlog after insert on public.channel_members
  for each row execute function private.assign_channel_backlog();

-- Lead criado por vendedor já fica com ele
create or replace function private.leads_default_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and new.assigned_to is null and not private.sees_all(new.organization_id) then
    new.assigned_to := (select auth.uid());
  end if;
  return new;
end $$;
create trigger leads_default_owner before insert on public.leads
  for each row execute function private.leads_default_owner();

-- Políticas -------------------------------------------------------------------------
-- Leads
drop policy leads_select on public.leads;
drop policy leads_insert on public.leads;
drop policy leads_update on public.leads;
create policy leads_select on public.leads for select to authenticated using (
  (select private.can_access(organization_id)) and (
    (select private.sees_all(organization_id)) or assigned_to = (select auth.uid())
    or (assigned_to is null and private.lead_on_my_channel(id))));
create policy leads_insert on public.leads for insert to authenticated with check (
  (select private.can_access(organization_id)) and ((select private.sees_all(organization_id)) or assigned_to = (select auth.uid())));
create policy leads_update on public.leads for update to authenticated
  using ((select private.can_access(organization_id)) and (
    (select private.sees_all(organization_id)) or assigned_to = (select auth.uid())
    or (assigned_to is null and private.lead_on_my_channel(id))))
  with check ((select private.can_access(organization_id)) and (
    (select private.sees_all(organization_id)) or assigned_to = (select auth.uid())
    or (assigned_to is null and private.lead_on_my_channel(id))));

-- Tags do lead
drop policy lead_tags_select on public.lead_tags;
drop policy lead_tags_insert on public.lead_tags;
drop policy lead_tags_delete on public.lead_tags;
create policy lead_tags_select on public.lead_tags for select to authenticated
  using ((select private.can_access(organization_id)) and ((select private.sees_all(organization_id)) or private.lead_visible(lead_id)));
create policy lead_tags_insert on public.lead_tags for insert to authenticated
  with check ((select private.can_access(organization_id)) and ((select private.sees_all(organization_id)) or private.lead_visible(lead_id)));
create policy lead_tags_delete on public.lead_tags for delete to authenticated
  using ((select private.can_access(organization_id)) and ((select private.sees_all(organization_id)) or private.lead_visible(lead_id)));

-- Atividades
drop policy activities_select on public.activities;
drop policy activities_insert on public.activities;
create policy activities_select on public.activities for select to authenticated
  using ((select private.can_access(organization_id)) and (
    (select private.sees_all(organization_id)) or actor_id = (select auth.uid())
    or (lead_id is not null and private.lead_visible(lead_id))));
create policy activities_insert on public.activities for insert to authenticated
  with check ((select private.can_access(organization_id)) and actor_id = (select auth.uid())
    and (lead_id is null or (select private.sees_all(organization_id)) or private.lead_visible(lead_id)));

-- Números (canais)
drop policy channels_select on public.whatsapp_channels;
create policy channels_select on public.whatsapp_channels for select to authenticated
  using ((select private.can_access(organization_id)) and (
    (select private.sees_all(organization_id))
    or exists (select 1 from public.channel_members cm where cm.channel_id = id and cm.user_id = (select auth.uid()))));

-- Conversas e mensagens
drop policy conversations_select on public.conversations;
drop policy conversations_update on public.conversations;
create policy conversations_select on public.conversations for select to authenticated
  using ((select private.sees_all(organization_id)) and (select private.can_access(organization_id)) or private.conversation_visible(id));
create policy conversations_update on public.conversations for update to authenticated
  using ((select private.sees_all(organization_id)) and (select private.can_access(organization_id)) or private.conversation_visible(id))
  with check ((select private.can_access(organization_id)));
drop policy messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using ((select private.sees_all(organization_id)) and (select private.can_access(organization_id)) or private.conversation_visible(conversation_id));

-- Mensagens agendadas
drop policy scheduled_select on public.scheduled_messages;
drop policy scheduled_insert on public.scheduled_messages;
drop policy scheduled_update on public.scheduled_messages;
create policy scheduled_select on public.scheduled_messages for select to authenticated
  using ((select private.can_access(organization_id)) and (
    (select private.sees_all(organization_id)) or created_by = (select auth.uid())
    or (lead_id is not null and private.lead_visible(lead_id))));
create policy scheduled_insert on public.scheduled_messages for insert to authenticated
  with check ((select private.can_access(organization_id)) and created_by = (select auth.uid()) and status = 'pending' and attempts = 0
    and ((select private.sees_all(organization_id)) or (lead_id is not null and private.lead_visible(lead_id))));
create policy scheduled_update on public.scheduled_messages for update to authenticated
  using ((select private.can_access(organization_id)) and status in ('pending', 'failed') and (
    (select private.sees_all(organization_id)) or created_by = (select auth.uid())
    or (lead_id is not null and private.lead_visible(lead_id))))
  with check ((select private.can_access(organization_id)) and status in ('pending', 'canceled'));

-- Agendamentos
drop policy appointments_select on public.appointments;
drop policy appointments_insert on public.appointments;
drop policy appointments_update on public.appointments;
create policy appointments_select on public.appointments for select to authenticated
  using ((select private.can_access(organization_id)) and (
    (select private.sees_all(organization_id)) or user_id = (select auth.uid()) or private.lead_visible(lead_id)));
create policy appointments_insert on public.appointments for insert to authenticated
  with check ((select private.can_access(organization_id)) and user_id = (select auth.uid())
    and ((select private.sees_all(organization_id)) or private.lead_visible(lead_id)));
create policy appointments_update on public.appointments for update to authenticated
  using ((select private.can_access(organization_id)) and (
    (select private.sees_all(organization_id)) or user_id = (select auth.uid()) or private.lead_visible(lead_id)))
  with check ((select private.can_access(organization_id)));

-- Ligações
drop policy wa_calls_select on public.wa_calls;
create policy wa_calls_select on public.wa_calls for select to authenticated
  using ((select private.can_access(organization_id)) and (
    (select private.sees_all(organization_id)) or started_by = (select auth.uid()) or answered_by = (select auth.uid())
    or (lead_id is not null and private.lead_visible(lead_id))
    or (conversation_id is not null and private.conversation_visible(conversation_id))));

drop policy voip_extensions_select on public.voip_extensions;
create policy voip_extensions_select on public.voip_extensions for select to authenticated
  using ((select private.can_access(organization_id)) and ((select private.sees_all(organization_id)) or user_id = (select auth.uid())));

-- Relatórios: só dono/administrador
drop policy report_runs_select on public.report_runs;
create policy report_runs_select on public.report_runs for select to authenticated using ((select private.can_manage(organization_id)));
drop policy report_settings_select on public.report_settings;
create policy report_settings_select on public.report_settings for select to authenticated using ((select private.can_manage(organization_id)));
drop policy report_notes_select on public.report_notes;
drop policy report_notes_insert on public.report_notes;
drop policy report_notes_update on public.report_notes;
create policy report_notes_select on public.report_notes for select to authenticated using ((select private.can_manage(organization_id)));
create policy report_notes_insert on public.report_notes for insert to authenticated
  with check ((select private.can_manage(organization_id)) and updated_by = (select auth.uid()));
create policy report_notes_update on public.report_notes for update to authenticated
  using ((select private.can_manage(organization_id)))
  with check ((select private.can_manage(organization_id)) and updated_by = (select auth.uid()));

-- Time comercial: vendedor só enxerga a si mesmo
drop policy team_sellers_select on public.team_sellers;
create policy team_sellers_select on public.team_sellers for select to authenticated
  using ((select private.can_access(organization_id)) and ((select private.sees_all(organization_id)) or user_id = (select auth.uid())));
drop policy team_entries_select on public.team_entries;
create policy team_entries_select on public.team_entries for select to authenticated
  using ((select private.can_access(organization_id)) and ((select private.sees_all(organization_id)) or private.is_my_seller(seller_id)));
drop policy team_sales_select on public.team_sales;
create policy team_sales_select on public.team_sales for select to authenticated
  using ((select private.can_access(organization_id)) and ((select private.sees_all(organization_id)) or private.is_my_seller(seller_id)));
drop policy team_notes_select on public.team_notes;
create policy team_notes_select on public.team_notes for select to authenticated
  using ((select private.can_access(organization_id)) and ((select private.sees_all(organization_id)) or private.is_my_seller(seller_id)));
drop policy team_goals_select on public.team_goals;
create policy team_goals_select on public.team_goals for select to authenticated
  using ((select private.can_access(organization_id)) and ((select private.sees_all(organization_id)) or private.is_my_seller(seller_id)));
drop policy team_seller_goals_select on public.team_seller_goals;
create policy team_seller_goals_select on public.team_seller_goals for select to authenticated
  using ((select private.can_access(organization_id)) and ((select private.sees_all(organization_id)) or private.is_my_seller(seller_id)));

-- Painel com filtro por vendedor -----------------------------------------------------
drop function if exists public.dashboard_stats(uuid, timestamptz, timestamptz, text);
create or replace function public.dashboard_stats(org uuid, p_from timestamptz, p_to timestamptz,
  p_tz text default 'America/Sao_Paulo', p_seller uuid default null)
returns jsonb language sql stable set search_path = '' as $$
  with
  st as (
    select s.id, s.name, s.color, s.kind, s.position, p.name as pipeline, p.position as ppos
    from public.stages s join public.pipelines p on p.id = s.pipeline_id
    where s.organization_id = org
  ),
  lds as (
    select l.* from public.leads l
    where l.organization_id = org and (p_seller is null or l.assigned_to = p_seller)
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
    from moves m join lds l on l.id = m.lead_id
  ),
  new_leads as (
    select l.* from lds l where l.created_at >= p_from and l.created_at < p_to
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
      and (p_seller is null or exists (
        select 1 from public.conversations c join lds l on l.id = c.lead_id where c.id = m.conversation_id))
    group by 1
  )
  select jsonb_build_object(
    'new_leads', (select count(*) from new_leads),
    'open_count', (select count(*) from lds l join st on st.id = l.stage_id where st.kind = 'open'),
    'open_value', (select coalesce(sum(l.value), 0) from lds l join st on st.id = l.stage_id where st.kind = 'open'),
    'won_count', (select count(*) from closed where kind = 'won'),
    'won_value', (select coalesce(sum(value), 0) from closed where kind = 'won'),
    'lost_count', (select count(*) from closed where kind = 'lost'),
    'by_stage', coalesce((
      select jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name, 'color', st.color, 'kind', st.kind, 'pipeline', st.pipeline,
                                          'count', coalesce(x.n, 0), 'value', coalesce(x.v, 0)) order by st.ppos, st.position)
      from st left join (
        select l.stage_id, count(*) n, sum(l.value) v from lds l group by l.stage_id
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
      select jsonb_agg(jsonb_build_object('user_id', o.uid, 'won_count', o.n, 'won_value', o.v, 'lost_count', o.lost,
                                          'new_leads', o.nl, 'open_value', o.ov) order by o.v desc, o.nl desc)
      from (
        select u.uid,
               coalesce((select count(*) from closed c where c.kind = 'won' and c.assigned_to is not distinct from u.uid), 0) n,
               coalesce((select sum(c.value) from closed c where c.kind = 'won' and c.assigned_to is not distinct from u.uid), 0) v,
               coalesce((select count(*) from closed c where c.kind = 'lost' and c.assigned_to is not distinct from u.uid), 0) lost,
               coalesce((select count(*) from new_leads nl where nl.assigned_to is not distinct from u.uid), 0) nl,
               coalesce((select sum(l.value) from lds l join st on st.id = l.stage_id where st.kind = 'open' and l.assigned_to is not distinct from u.uid), 0) ov
        from (select distinct assigned_to as uid from lds) u
      ) o
      where o.n > 0 or o.nl > 0 or o.ov > 0 or o.lost > 0
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'in', coalesce(msg.inbound, 0), 'out', coalesce(msg.outbound, 0)) order by d.day)
      from days d left join msg on msg.day = d.day
    ), '[]'::jsonb)
  );
$$;
grant execute on function public.dashboard_stats(uuid, timestamptz, timestamptz, text, uuid) to authenticated;
