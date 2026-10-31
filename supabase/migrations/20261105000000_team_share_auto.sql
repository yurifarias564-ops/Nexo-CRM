-- Toda empresa nova já nasce com o link do checklist (e as que já existem ganham o delas).
create or replace function private.team_share_on_org()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.team_share_links (organization_id, token)
  values (new.id, replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  on conflict (organization_id) do nothing;
  return new;
end;
$$;
drop trigger if exists team_share_on_org on public.organizations;
create trigger team_share_on_org after insert on public.organizations
  for each row execute function private.team_share_on_org();

insert into public.team_share_links (organization_id, token)
select o.id, replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8) from public.organizations o
on conflict (organization_id) do nothing;
