-- Limpeza OPCIONAL (rode no SQL Editor do Supabase quando quiser).
-- Remove sobras vazias da primeira versão do Time comercial e um índice repetido.
drop table if exists public.team_goals;
alter table public.team_metrics drop column if exists source_v1;
drop index if exists public.activities_org_type_idx;
