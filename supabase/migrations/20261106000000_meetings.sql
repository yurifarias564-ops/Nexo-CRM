-- Agendamento: cada funil decide se a coluna de agendamento abre o agendamento;
-- link da videochamada enviado ao lead e lembretes programados (editáveis pela empresa).

alter table public.pipelines add column if not exists schedule_on_move boolean not null default true;
alter table public.appointments add column if not exists meet_link text check (meet_link is null or char_length(meet_link) <= 500);
alter table public.scheduled_messages add column if not exists appointment_id uuid references public.appointments (id) on delete set null;
create index if not exists scheduled_appointment_idx on public.scheduled_messages (appointment_id) where appointment_id is not null;

create table public.meeting_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  send_link boolean not null default true,
  link_message text not null default 'Oi, {{primeiro_nome}}! Nossa reunião ficou marcada para {{data}} às {{hora}}. ✅
Para entrar é só tocar no link (não precisa instalar nada):
{{link}}' check (char_length(link_message) between 1 and 2000),
  reminders_enabled boolean not null default true,
  -- [{ "kind": "day_at", "time": "06:00", "text": "..." } | { "kind": "before", "minutes": 30, "text": "..." } | { "kind": "day_before_at", "time": "18:00", "text": "..." }]
  reminders jsonb not null default '[
    {"kind":"day_at","time":"06:00","text":"Bom dia, {{primeiro_nome}}! Passando para lembrar da nossa reunião hoje às {{hora}}. 😊"},
    {"kind":"day_at","time":"12:00","text":"{{primeiro_nome}}, tudo certo para hoje às {{hora}}? Te espero lá!"},
    {"kind":"before","minutes":30,"text":"{{primeiro_nome}}, daqui a 30 minutos {{vendedor}} estará online te esperando. É só tocar no link: {{link}}"}
  ]'::jsonb check (jsonb_typeof(reminders) = 'array' and jsonb_array_length(reminders) <= 8),
  updated_at timestamptz not null default now()
);
alter table public.meeting_settings enable row level security;
create policy meeting_settings_select on public.meeting_settings for select to authenticated
  using ((select private.is_member(organization_id)));
create policy meeting_settings_write on public.meeting_settings for all to authenticated
  using ((select private.can_manage(organization_id))) with check ((select private.can_manage(organization_id)));

-- Horário comercial da empresa (automações: "dentro do horário", "esperar abrir", gatilho fora do expediente)
create table public.business_hours (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  time_zone text not null default 'America/Sao_Paulo',
  -- 7 dias, domingo = 0: [{ "on": true, "start": "08:00", "end": "18:00" }, ...]
  days jsonb not null check (jsonb_typeof(days) = 'array' and jsonb_array_length(days) = 7),
  updated_at timestamptz not null default now()
);
alter table public.business_hours enable row level security;
create policy business_hours_select on public.business_hours for select to authenticated
  using ((select private.is_member(organization_id)));
create policy business_hours_write on public.business_hours for all to authenticated
  using ((select private.can_manage(organization_id))) with check ((select private.can_manage(organization_id)));

-- Automações: bloco "Se o cliente responder…" espera a resposta para escolher o caminho
alter table public.automation_runs drop constraint if exists automation_runs_waiting_for_check;
alter table public.automation_runs add constraint automation_runs_waiting_for_check check (waiting_for is null or waiting_for in ('reply', 'options'));
create index if not exists automation_runs_options_idx on public.automation_runs (lead_id) where status = 'waiting' and waiting_for = 'options';

-- O acontecimento "mensagem recebida" leva o id e o tipo (áudio é transcrito antes de comparar)
create or replace function private.automation_message_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_lead uuid;
begin
  if new.direction <> 'in' or new.sent_at < now() - interval '10 minutes' then return null; end if;
  if not private.has_automations(new.organization_id) then return null; end if;
  select c.lead_id into v_lead from public.conversations c where c.id = new.conversation_id;
  if v_lead is null then return null; end if;
  insert into public.automation_events (organization_id, lead_id, type, data)
  values (new.organization_id, v_lead, 'message_received', jsonb_build_object(
    'text', left(coalesce(new.body, new.transcript, ''), 1000), 'conversation_id', new.conversation_id,
    'message_id', new.id, 'msg_type', new.type));
  return null;
end $$;
