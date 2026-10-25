-- Agente de IA no WhatsApp: um por empresa, com prompt, IA escolhida, memória por lead e registro de cada resposta.

create table public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  enabled boolean not null default false,
  enabled_at timestamptz,
  name text not null default 'Assistente' check (char_length(name) between 1 and 40),
  provider text not null default 'claude' check (provider in ('claude', 'gemini', 'groq')),
  model text check (model is null or char_length(model) <= 80),
  prompt text not null default '' check (char_length(prompt) <= 30000),
  -- null = todos os números da empresa
  channel_ids uuid[],
  -- 'new_leads' = só conversas que começaram depois de ligar o agente; 'all' = todas
  start_mode text not null default 'new_leads' check (start_mode in ('new_leads', 'all')),
  reply_delay_seconds integer not null default 8 check (reply_delay_seconds between 2 and 60),
  pause_on_human boolean not null default true,
  pause_hours integer not null default 12 check (pause_hours between 1 and 720),
  auto_tags boolean not null default true,
  transcribe_audio boolean not null default true,
  time_zone text not null default 'America/Sao_Paulo',
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ai_agents enable row level security;
create policy ai_agents_select on public.ai_agents for select to authenticated using ((select private.can_access(organization_id)));

-- Chave própria da empresa para a IA (opcional). Sem policy: só o servidor lê.
create table public.ai_agent_secrets (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('claude', 'gemini', 'groq')),
  api_key text not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, provider)
);
alter table public.ai_agent_secrets enable row level security;

-- Estado da IA em cada conversa
alter table public.conversations
  add column ai_state text not null default 'auto' check (ai_state in ('auto', 'paused', 'off')),
  add column ai_paused_until timestamptz,
  add column ai_lock_until timestamptz,
  add column ai_last_run_at timestamptz;

alter table public.messages
  add column by_ai boolean not null default false,
  -- Áudio do cliente transformado em texto (para a IA entender e para mostrar no chat)
  add column transcript text check (transcript is null or char_length(transcript) <= 8000);

-- Resumo da negociação feito pela IA
alter table public.leads
  add column ai_summary text check (ai_summary is null or char_length(ai_summary) <= 4000),
  add column ai_summary_at timestamptz;

-- Memória: tudo o que o cliente contou. Fica para sempre (só some se alguém apagar).
create table public.ai_lead_memory (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  fact text not null check (char_length(fact) between 1 and 500),
  source text not null default 'ai' check (source in ('ai', 'user')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index ai_lead_memory_uq on public.ai_lead_memory (lead_id, lower(fact));
create index ai_lead_memory_org_idx on public.ai_lead_memory (organization_id, created_at desc);
alter table public.ai_lead_memory enable row level security;
create policy ai_lead_memory_select on public.ai_lead_memory for select to authenticated
  using ((select private.can_access(organization_id)) and private.lead_visible(lead_id));
create policy ai_lead_memory_delete on public.ai_lead_memory for delete to authenticated
  using ((select private.can_access(organization_id)) and private.lead_visible(lead_id));

-- Registro de cada resposta (para conferir o que a IA fez e por quê)
create table public.ai_runs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  provider text not null,
  model text not null,
  status text not null check (status in ('ok', 'error', 'skipped')),
  reply text,
  tools jsonb not null default '[]'::jsonb,
  error text,
  ms integer,
  created_at timestamptz not null default now()
);
create index ai_runs_org_idx on public.ai_runs (organization_id, created_at desc);
create index ai_runs_conv_idx on public.ai_runs (conversation_id, created_at desc);
alter table public.ai_runs enable row level security;
create policy ai_runs_select on public.ai_runs for select to authenticated using ((select private.can_manage(organization_id)));

-- Trava curta por conversa: duas mensagens seguidas não geram duas respostas
create or replace function public.ai_try_lock(p_conv uuid, p_seconds integer)
returns boolean language sql security definer set search_path = '' as $$
  with u as (
    update public.conversations set ai_lock_until = now() + make_interval(secs => p_seconds)
     where id = p_conv and (ai_lock_until is null or ai_lock_until < now())
    returning 1
  ) select exists (select 1 from u);
$$;
revoke execute on function public.ai_try_lock(uuid, integer) from public, anon, authenticated;
grant execute on function public.ai_try_lock(uuid, integer) to service_role;
