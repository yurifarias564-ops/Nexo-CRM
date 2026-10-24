alter table public.whatsapp_channels add column zapi_instance_id text check (zapi_instance_id is null or zapi_instance_id ~ '^[A-Za-z0-9]{8,64}$');
create unique index whatsapp_channels_zapi_uq on public.whatsapp_channels (zapi_instance_id) where zapi_instance_id is not null;
alter table public.whatsapp_channel_secrets add column zapi_token text, add column zapi_client_token text;
