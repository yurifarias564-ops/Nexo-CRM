-- @supabase-only  (Storage não existe no Postgres de teste)
-- Arquivos das automações (foto, vídeo, áudio, documento): privado, só o servidor lê e grava.
insert into storage.buckets (id, name, public, file_size_limit)
values ('automation-media', 'automation-media', false, 16777216)
on conflict (id) do nothing;
