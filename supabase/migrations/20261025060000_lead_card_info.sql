-- Card do lead: foto, última mensagem e tempo parado
alter table public.leads
  add column avatar_url text,
  add column avatar_checked_at timestamptz,
  add column last_message_preview text,
  add column last_message_dir public.msg_direction,
  add column stage_changed_at timestamptz not null default now();

-- Quando entrou na etapa atual (aproximado pelo histórico já existente)
update public.leads l set stage_changed_at = coalesce(
  (select max(a.created_at) from public.activities a where a.lead_id = l.id and a.type = 'stage_changed'), l.created_at);

-- Última mensagem de cada lead
update public.leads l set last_message_preview = x.preview, last_message_dir = x.direction
from (
  select distinct on (c.lead_id) c.lead_id, left(coalesce(m.body, '[' || m.type || ']'), 120) as preview, m.direction
  from public.messages m join public.conversations c on c.id = m.conversation_id
  where c.lead_id is not null
  order by c.lead_id, m.sent_at desc
) x where x.lead_id = l.id;

create or replace function private.leads_stage_changed_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.stage_id is distinct from old.stage_id then new.stage_changed_at := now(); end if;
  return new;
end $$;
create trigger leads_stage_changed_at before update of stage_id on public.leads
  for each row execute function private.leads_stage_changed_at();

create or replace function private.messages_to_lead()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.leads l
     set last_message_preview = left(coalesce(new.body, '[' || new.type || ']'), 120),
         last_message_dir = new.direction
    from public.conversations c
   where c.id = new.conversation_id and l.id = c.lead_id
     and (l.last_message_at is null or new.sent_at >= l.last_message_at - interval '1 second');
  return null;
end $$;
create trigger messages_to_lead after insert on public.messages
  for each row execute function private.messages_to_lead();

create index leads_avatar_check_idx on public.leads (avatar_checked_at nulls first) where phone is not null;
