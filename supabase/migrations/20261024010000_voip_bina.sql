-- Número de saída (bina) de cada vendedor: vazio = bina dinâmica (DDD local da central)
alter table public.voip_extensions
  add column bina text check (bina is null or bina ~ '^[0-9]{10,13}$'),
  add column provider_ext_id text;
