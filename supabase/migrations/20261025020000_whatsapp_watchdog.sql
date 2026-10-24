-- Vigia da conexão do WhatsApp (QR Code): estado da queda e próxima tentativa automática
alter table public.whatsapp_channels
  add column disconnected_at timestamptz,
  add column next_retry_at timestamptz,
  add column retry_count integer not null default 0,
  add column needs_qr boolean not null default false,
  add column last_check_at timestamptz;
create index whatsapp_channels_watch_idx on public.whatsapp_channels (provider, status) where provider = 'evolution';
