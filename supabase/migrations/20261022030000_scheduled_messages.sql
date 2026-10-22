-- =============================================================================
-- Mensagens agendadas no WhatsApp
-- O usuário agenda (texto livre ou modelo aprovado da Meta) para um lead ou
-- conversa. Um disparador no servidor reserva as mensagens vencidas de forma
-- atômica (FOR UPDATE SKIP LOCKED), então várias execuções simultâneas nunca
-- enviam a mesma mensagem duas vezes.
-- =============================================================================

create type public.scheduled_status as enum ('pending', 'sending', 'sent', 'failed', 'canceled');

create table public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  body text check (body is null or char_length(body) between 1 and 4096),
  template_name text,
  template_language text,
  template_params jsonb not null default '[]'::jsonb,
  send_at timestamptz not null,
  time_zone text not null default 'America/Sao_Paulo',
  status public.scheduled_status not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  sent_message_id uuid,
  created_at timestamptz not null default now(),
  constraint scheduled_target_ck check (lead_id is not null or conversation_id is not null),
  constraint scheduled_content_ck check (body is not null or (template_name is not null and template_language is not null))
);
create index scheduled_due_idx on public.scheduled_messages (send_at) where status = 'pending';
create index scheduled_org_idx on public.scheduled_messages (organization_id, send_at desc);
create index scheduled_lead_idx on public.scheduled_messages (lead_id, send_at desc);
create index scheduled_conv_idx on public.scheduled_messages (conversation_id);
create index scheduled_created_by_idx on public.scheduled_messages (created_by);
create index scheduled_stuck_idx on public.scheduled_messages (claimed_at) where status = 'sending';

alter table public.scheduled_messages enable row level security;

create policy scheduled_select on public.scheduled_messages for select to authenticated
  using ((select private.can_access(organization_id)));
create policy scheduled_insert on public.scheduled_messages for insert to authenticated
  with check ((select private.can_access(organization_id)) and created_by = (select auth.uid()) and status = 'pending' and attempts = 0);
-- Edição só enquanto pendente, e o usuário só pode deixar pendente ou cancelar
create policy scheduled_update on public.scheduled_messages for update to authenticated
  using ((select private.can_access(organization_id)) and status in ('pending', 'failed'))
  with check ((select private.can_access(organization_id)) and status in ('pending', 'canceled'));
revoke update on public.scheduled_messages from authenticated;
grant update (body, template_name, template_language, template_params, send_at, status, last_error) on public.scheduled_messages to authenticated;

-- Alvo (lead/conversa) precisa ser da mesma empresa
create or replace function private.scheduled_check_integrity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.lead_id is not null and not exists (select 1 from public.leads where id = new.lead_id and organization_id = new.organization_id) then
    raise exception 'Lead de outra empresa' using errcode = '42501';
  end if;
  if new.conversation_id is not null and not exists (select 1 from public.conversations where id = new.conversation_id and organization_id = new.organization_id) then
    raise exception 'Conversa de outra empresa' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger scheduled_integrity before insert or update of lead_id, conversation_id, organization_id on public.scheduled_messages
  for each row execute function private.scheduled_check_integrity();

-- Reserva atômica das mensagens vencidas (usada só pelo servidor)
create or replace function public.claim_scheduled_messages(p_limit integer default 50)
returns setof public.scheduled_messages
language plpgsql security definer set search_path = '' as $$
begin
  -- Travadas em "enviando" há mais de 10 min: não reenvia às cegas (evita duplicar)
  update public.scheduled_messages
     set status = 'failed', last_error = 'Envio interrompido. Confira a conversa antes de reenviar.'
   where status = 'sending' and claimed_at < now() - interval '10 minutes';

  return query
  update public.scheduled_messages s
     set status = 'sending', attempts = s.attempts + 1, claimed_at = now()
   where s.id in (
     select id from public.scheduled_messages
      where status = 'pending' and send_at <= now()
      order by send_at
      limit least(greatest(p_limit, 1), 200)
      for update skip locked
   )
  returning s.*;
end $$;
revoke execute on function public.claim_scheduled_messages(integer) from public, anon, authenticated;
grant execute on function public.claim_scheduled_messages(integer) to service_role;
