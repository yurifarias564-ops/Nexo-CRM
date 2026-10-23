-- @supabase-only
-- Diz se o usuário logado é dono da plataforma (vê a configuração global da Meta).
create or replace function public.is_house()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.house_accounts h
    join auth.users u on lower(u.email) = h.email
    where u.id = auth.uid()
  );
$$;
revoke all on function public.is_house() from public, anon;
grant execute on function public.is_house() to authenticated;
