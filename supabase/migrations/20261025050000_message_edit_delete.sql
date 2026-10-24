-- Mensagens apagadas e editadas (no celular ou pelo CRM), como no WhatsApp
alter table public.messages
  add column deleted_at timestamptz,
  add column edited_at timestamptz,
  add column original_body text;

-- Amostras de avisos fora do padrão (apagar/editar) para conferir o formato de cada provedor
create table public.webhook_samples (
  id bigint generated always as identity primary key,
  provider text not null,
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.webhook_samples enable row level security;
-- sem políticas: só o servidor lê/grava
