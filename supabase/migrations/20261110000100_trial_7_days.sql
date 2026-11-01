-- Teste grátis de 7 dias: toda empresa nova já nasce com acesso liberado por 7 dias.
-- Depois disso a vigência vence e o CRM leva para a tela de assinatura (pagamento via Asaas).
alter table public.subscriptions add column if not exists is_trial boolean not null default false;

create or replace function private.subscription_trial()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending' and new.asaas_subscription_id is null and new.current_period_end is null then
    new.status := 'active';
    new.is_trial := true;
    new.current_period_end := now() + interval '7 days';
  end if;
  return new;
end $$;
revoke all on function private.subscription_trial() from public;

drop trigger if exists subscriptions_trial on public.subscriptions;
create trigger subscriptions_trial before insert on public.subscriptions
  for each row execute function private.subscription_trial();
