-- Clientes esperando resposta: a última mensagem da conversa é do cliente e o atendimento não foi finalizado.
-- "Finalizar atendimento" tira o lead da lista até ele mandar mensagem de novo.
alter table public.leads add column if not exists attendance_closed_at timestamptz;
create index if not exists leads_waiting_idx on public.leads (organization_id, last_message_at) where last_message_dir = 'in';

create or replace function public.unanswered_leads(org uuid, p_seller uuid default null)
returns table (id uuid, name text, phone text, assigned_to uuid, last_message_at timestamptz, last_message_preview text, conversation_id uuid)
language sql stable security invoker set search_path = '' as $$
  select l.id, l.name, l.phone, l.assigned_to, l.last_message_at, l.last_message_preview,
         (select c.id from public.conversations c where c.lead_id = l.id order by c.last_message_at desc nulls last limit 1)
  from public.leads l
  left join public.stages s on s.id = l.stage_id
  where l.organization_id = org
    and l.last_message_dir = 'in'
    and l.last_message_at is not null
    and (l.attendance_closed_at is null or l.attendance_closed_at < l.last_message_at)
    and coalesce(s.kind::text, 'open') <> 'lost'
    and (p_seller is null or l.assigned_to = p_seller)
  order by l.last_message_at asc
  limit 500;
$$;
revoke execute on function public.unanswered_leads(uuid, uuid) from public, anon;
grant execute on function public.unanswered_leads(uuid, uuid) to authenticated;
