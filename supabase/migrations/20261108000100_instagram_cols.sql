-- Conta do Instagram ligada ao canal (o token fica em whatsapp_channel_secrets.meta_access_token)
alter table public.whatsapp_channels add column if not exists ig_user_id text;
alter table public.whatsapp_channels add column if not exists ig_username text;
alter table public.whatsapp_channels add column if not exists ig_token_expires_at timestamptz;
create unique index if not exists whatsapp_channels_ig_user_uq on public.whatsapp_channels (ig_user_id) where ig_user_id is not null;
