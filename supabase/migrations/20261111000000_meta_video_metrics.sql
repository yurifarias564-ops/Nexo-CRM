-- Métricas de vídeo por anúncio/dia (funil do vídeo na aba Campanhas)
alter table public.meta_ad_insights
  add column if not exists video_views bigint not null default 0,
  add column if not exists video_p25 bigint not null default 0,
  add column if not exists video_p50 bigint not null default 0,
  add column if not exists video_p75 bigint not null default 0,
  add column if not exists video_p95 bigint not null default 0,
  add column if not exists video_p100 bigint not null default 0,
  add column if not exists thruplays bigint not null default 0;
