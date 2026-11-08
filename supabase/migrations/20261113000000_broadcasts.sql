-- =============================================================================
-- Disparos em massa no WhatsApp
-- O dono escolhe o público (tags, etapas, tempo parado, leads avulsos), a
-- mensagem (texto + até 2 mídias, ou um modelo aprovado da Meta), quando enviar
-- e o ritmo. Ao criar, o público vira uma lista fixa de destinatários. Um
-- disparador no servidor reserva os destinatários de forma atômica
-- (FOR UPDATE SKIP LOCKED) e para assim que o disparo é pausado ou cancelado.
-- =============================================================================

create type public.broadcast_status as enum ('scheduled', 'sending', 'paused', 'done', 'canceled');
create type public.broadcast_rcpt_status as enum ('pending', 'sending', 'sent', 'failed', 'skipped', 'canceled');

create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  channel_id uuid not null references public.whatsapp_channels (id) on delete cascade,
  provider text not null check (provider in ('meta', 'zapi', 'evolution')),
  status public.broadcast_status not null default 'scheduled',
  audience jsonb not null default '{}'::jsonb,
  body text check (body is null or char_length(body) between 1 and 4096),
  media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 2),
  template_name text,
  template_language text,
  template_category text check (template_category is null or template_category in ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  template_params jsonb not null default '[]'::jsonb,
  template_header jsonb,
  send_at timestamptz not null,
  time_zone text not null default 'America/Sao_Paulo',
  interval_seconds integer not null default 0 check (interval_seconds between 0 and 600),
  next_send_at timestamptz,
  total integer not null default 0,
  sent integer not null default 0,
  failed integer not null default 0,
  skipped integer not null default 0,
  cost_currency text,
  cost_unit numeric(10, 4),
  cost_estimated numeric(12, 2),
  cost_other_country integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  canceled_at timestamptz,
  canceled_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint broadcasts_content_ck check (
    (provider = 'meta' and template_name is not null and template_language is not null)
    or (provider <> 'meta' and (body is not null or jsonb_array_length(media) > 0))
  )
);
create index broadcasts_org_idx on public.broadcasts (organization_id, created_at desc);
create index broadcasts_due_idx on public.broadcasts (send_at) where status in ('scheduled', 'sending');
create index broadcasts_channel_idx on public.broadcasts (channel_id);
create index broadcasts_created_by_idx on public.broadcasts (created_by);
create index broadcasts_canceled_by_idx on public.broadcasts (canceled_by);

create table public.broadcast_recipients (
  id bigint generated always as identity primary key,
  broadcast_id uuid not null references public.broadcasts (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  phone text not null,
  name text,
  status public.broadcast_rcpt_status not null default 'pending',
  error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  unique (broadcast_id, lead_id)
);
create index broadcast_rcpt_queue_idx on public.broadcast_recipients (broadcast_id, id) where status = 'pending';
create index broadcast_rcpt_status_idx on public.broadcast_recipients (broadcast_id, status);
create index broadcast_rcpt_lead_idx on public.broadcast_recipients (lead_id);
create index broadcast_rcpt_org_idx on public.broadcast_recipients (organization_id);

-- Só gestores veem; criar, pausar e cancelar passa pelo servidor (que confere o papel).
alter table public.broadcasts enable row level security;
alter table public.broadcast_recipients enable row level security;
create policy broadcasts_select on public.broadcasts for select to authenticated using ((select private.can_manage(organization_id)));
create policy broadcast_rcpt_select on public.broadcast_recipients for select to authenticated using ((select private.can_manage(organization_id)));
revoke insert, update, delete on public.broadcasts, public.broadcast_recipients from authenticated, anon;

-- Destinatário precisa ser lead da mesma empresa do disparo
create or replace function private.broadcast_rcpt_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.broadcasts b where b.id = new.broadcast_id and b.organization_id = new.organization_id)
     or not exists (select 1 from public.leads l where l.id = new.lead_id and l.organization_id = new.organization_id) then
    raise exception 'Destinatário de outra empresa' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger broadcast_rcpt_check before insert on public.broadcast_recipients
  for each row execute function private.broadcast_rcpt_check();

-- Canal precisa ser da mesma empresa
create or replace function private.broadcast_check()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.whatsapp_channels c where c.id = new.channel_id and c.organization_id = new.organization_id) then
    raise exception 'Canal de outra empresa' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger broadcast_check before insert or update of channel_id on public.broadcasts
  for each row execute function private.broadcast_check();

/**
 * Público do disparo. Critérios combinados com "E" (cada lista com "OU" dentro):
 * tem alguma das tags, está em alguma das etapas, sem movimento desde idle_before.
 * Leads avulsos (p_lead_ids) entram sempre. Só leads com telefone; um por número.
 */
create or replace function public.broadcast_audience(
  p_org uuid, p_tag_ids uuid[], p_stage_ids uuid[], p_idle_before timestamptz, p_lead_ids uuid[], p_exclude uuid[] default '{}'
) returns table (lead_id uuid, name text, phone text)
language sql stable security definer set search_path = '' as $$
  with base as (
    select l.id, l.name, regexp_replace(l.phone, '\D', '', 'g') as phone,
           greatest(l.created_at, coalesce(l.last_message_at, l.created_at), coalesce(l.stage_changed_at, l.created_at)) as last_move
    from public.leads l
    where l.organization_id = p_org and l.phone is not null and length(regexp_replace(l.phone, '\D', '', 'g')) between 10 and 15
  ),
  filtered as (
    select b.* from base b
    where (coalesce(cardinality(p_tag_ids), 0) > 0 or coalesce(cardinality(p_stage_ids), 0) > 0 or p_idle_before is not null)
      and (coalesce(cardinality(p_tag_ids), 0) = 0 or exists (select 1 from public.lead_tags t where t.lead_id = b.id and t.tag_id = any (p_tag_ids)))
      and (coalesce(cardinality(p_stage_ids), 0) = 0 or exists (select 1 from public.leads x where x.id = b.id and x.stage_id = any (p_stage_ids)))
      and (p_idle_before is null or b.last_move < p_idle_before)
    union
    select b.* from base b where b.id = any (coalesce(p_lead_ids, '{}'))
  )
  select distinct on (f.phone) f.id, f.name, f.phone
  from filtered f
  where not (f.id = any (coalesce(p_exclude, '{}')))
  order by f.phone, f.last_move desc;
$$;
revoke execute on function public.broadcast_audience(uuid, uuid[], uuid[], timestamptz, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.broadcast_audience(uuid, uuid[], uuid[], timestamptz, uuid[], uuid[]) to service_role;

/** Reserva os próximos destinatários de um disparo em andamento (seguro em paralelo). */
create or replace function public.claim_broadcast_recipients(p_broadcast uuid, p_limit integer default 1)
returns setof public.broadcast_recipients
language plpgsql security definer set search_path = '' as $$
begin
  -- Travado em "enviando" há mais de 10 min: não reenvia às cegas (evita mensagem duplicada)
  update public.broadcast_recipients
     set status = 'failed', error = 'Envio interrompido. Confira a conversa antes de reenviar.'
   where broadcast_id = p_broadcast and status = 'sending' and claimed_at < now() - interval '10 minutes';

  if not exists (select 1 from public.broadcasts where id = p_broadcast and status = 'sending') then
    return;
  end if;

  return query
  update public.broadcast_recipients r
     set status = 'sending', claimed_at = now()
   where r.id in (
     select id from public.broadcast_recipients
      where broadcast_id = p_broadcast and status = 'pending'
      order by id
      limit least(greatest(p_limit, 1), 100)
      for update skip locked
   )
  returning r.*;
end $$;
revoke execute on function public.claim_broadcast_recipients(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_broadcast_recipients(uuid, integer) to service_role;

/** Recalcula os contadores e fecha o disparo quando não sobra ninguém na fila. */
create or replace function public.refresh_broadcast(p_broadcast uuid)
returns public.broadcasts
language plpgsql security definer set search_path = '' as $$
declare v public.broadcasts;
begin
  update public.broadcasts b set
    sent = c.sent, failed = c.failed, skipped = c.skipped,
    status = case when b.status = 'sending' and c.open = 0 then 'done'::public.broadcast_status else b.status end,
    finished_at = case when b.status = 'sending' and c.open = 0 then now() else b.finished_at end
  from (
    select count(*) filter (where status = 'sent') as sent,
           count(*) filter (where status = 'failed') as failed,
           count(*) filter (where status in ('skipped', 'canceled')) as skipped,
           count(*) filter (where status in ('pending', 'sending')) as open
    from public.broadcast_recipients where broadcast_id = p_broadcast
  ) c
  where b.id = p_broadcast
  returning b.* into v;
  return v;
end $$;
revoke execute on function public.refresh_broadcast(uuid) from public, anon, authenticated;
grant execute on function public.refresh_broadcast(uuid) to service_role;

/** Cancelar: para na hora. Quem ainda não recebeu fica como cancelado. */
create or replace function public.cancel_broadcast(p_broadcast uuid, p_user uuid)
returns public.broadcasts
language plpgsql security definer set search_path = '' as $$
declare v public.broadcasts;
begin
  update public.broadcasts set status = 'canceled', canceled_at = now(), canceled_by = p_user, finished_at = coalesce(finished_at, now())
   where id = p_broadcast and status in ('scheduled', 'sending', 'paused');
  update public.broadcast_recipients set status = 'canceled', error = 'Disparo cancelado'
   where broadcast_id = p_broadcast and status = 'pending';
  select * into v from public.refresh_broadcast(p_broadcast);
  return v;
end $$;
revoke execute on function public.cancel_broadcast(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_broadcast(uuid, uuid) to service_role;
