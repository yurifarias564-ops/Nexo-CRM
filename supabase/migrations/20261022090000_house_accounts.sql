-- @supabase-only
-- Contas da casa (dono do sistema): e-mail já confirmado no cadastro e
-- empresa criada com assinatura ativa, sem passar pela cobrança.

create table if not exists private.house_accounts (
  email text primary key check (email = lower(email))
);
insert into private.house_accounts (email) values ('yurifarias564@gmail.com') on conflict do nothing;

create or replace function private.house_confirm_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null and exists (select 1 from private.house_accounts h where h.email = lower(new.email)) then
    new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  end if;
  return new;
end $$;

drop trigger if exists house_confirm_email on auth.users;
create trigger house_confirm_email before insert on auth.users
  for each row execute function private.house_confirm_email();

create or replace function private.house_subscription()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.organizations o
    join auth.users u on u.id = o.created_by
    join private.house_accounts h on h.email = lower(u.email)
    where o.id = new.organization_id
  ) then
    new.status := 'active';
    new.current_period_end := null;
  end if;
  return new;
end $$;

drop trigger if exists house_subscription on public.subscriptions;
create trigger house_subscription before insert on public.subscriptions
  for each row execute function private.house_subscription();
