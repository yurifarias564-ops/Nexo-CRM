-- =============================================================================
-- Ligações pelo WhatsApp (Calling API da Meta — número da API oficial)
--  - wa_calls: cada ligação (feita ou recebida), com a negociação WebRTC (SDP),
--    situação, duração e a gravação. TODA ligação é gravada e o histórico é
--    permanente: apagar o lead, a conversa ou o número NÃO apaga a ligação.
--  - Permissão do cliente para receber ligações (vale 7 dias ou permanente).
--  - Configuração por número: ligações ativas e modo de gravação.
-- Escrita só pelo servidor (rotas da API e webhook); a equipe só lê.
-- =============================================================================

create table public.wa_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel_id uuid references public.whatsapp_channels (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  wa_id text not null,
  contact_name text,
  wa_call_id text,
  direction text not null check (direction in ('out', 'in')),
  status text not null default 'starting'
    check (status in ('starting', 'ringing', 'accepting', 'connected', 'rejected', 'missed', 'failed', 'completed', 'canceled')),
  started_by uuid references public.profiles (id) on delete set null,
  answered_by uuid references public.profiles (id) on delete set null,
  sdp_offer text,
  sdp_answer text,
  recording_mode text not null default 'meta' check (recording_mode in ('meta', 'browser')),
  recording_path text,
  recording_mime text,
  backup_path text,
  backup_mime text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_s integer check (duration_s is null or duration_s >= 0),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index wa_calls_wa_call_id_uq on public.wa_calls (channel_id, wa_call_id) where wa_call_id is not null;
create index wa_calls_org_created_idx on public.wa_calls (organization_id, created_at desc);
create index wa_calls_conversation_idx on public.wa_calls (conversation_id, created_at desc);
create index wa_calls_lead_idx on public.wa_calls (lead_id);
create index wa_calls_started_by_idx on public.wa_calls (started_by);
create index wa_calls_answered_by_idx on public.wa_calls (answered_by);
create index wa_calls_channel_idx on public.wa_calls (channel_id);

alter table public.wa_calls enable row level security;
create policy wa_calls_select on public.wa_calls for select to authenticated using ((select private.can_access(organization_id)));
-- sem políticas de escrita: só o servidor (service role) grava

-- Permissão do cliente para receber ligação
alter table public.conversations
  add column call_permission_until timestamptz,
  add column call_permission_permanent boolean not null default false;

-- Configuração de ligações por número
alter table public.whatsapp_channels
  add column calling_enabled boolean not null default false,
  add column call_recording text not null default 'meta' check (call_recording in ('meta', 'browser')),
  add column call_recording_purpose text not null default 'qualidade do atendimento'
    check (char_length(call_recording_purpose) between 1 and 250);

alter publication supabase_realtime add table public.wa_calls;
