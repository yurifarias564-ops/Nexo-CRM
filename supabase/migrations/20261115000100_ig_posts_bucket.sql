-- @supabase-only  (Storage não existe no Postgres de teste)
-- Vídeos e fotos das publicações agendadas do Instagram (privado; o Instagram baixa por link assinado).
insert into storage.buckets (id, name, public, file_size_limit)
values ('ig-posts', 'ig-posts', false, 104857600)
on conflict (id) do nothing;
