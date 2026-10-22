-- Limpeza OPCIONAL (rode no SQL Editor do Supabase quando quiser; nada no sistema depende disso).
-- Remove sobras vazias da primeira versão do Time comercial e um índice repetido.
drop table if exists public.team_goals;
alter table public.team_metrics drop column if exists source;   -- substituída pela coluna "origin"
drop index if exists public.activities_org_type_idx;
