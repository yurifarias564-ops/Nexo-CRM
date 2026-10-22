-- @supabase-only  (Storage não existe no Postgres de teste)
-- Gravações das ligações (bucket privado; só o servidor lê e grava). Sem regra de
-- expiração: os arquivos ficam guardados para sempre.
insert into storage.buckets (id, name, public, file_size_limit)
values ('calls', 'calls', false, 104857600)
on conflict (id) do nothing;
