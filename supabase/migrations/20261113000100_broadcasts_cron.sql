-- @supabase-only  (pg_cron, pg_net e Vault não existem no Postgres de teste)
-- A cada minuto o banco chama /api/cron/broadcasts, mas SÓ quando existe
-- disparo vencido ou em andamento com envio pendente (sem custo quando não há).
-- Usa os mesmos segredos do Vault das mensagens agendadas (app_url, cron_secret).

create or replace function private.dispatch_broadcasts()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if not exists (
    select 1 from public.broadcasts
     where (status = 'scheduled' and send_at <= now())
        or (status = 'sending' and (next_send_at is null or next_send_at <= now() + interval '50 seconds'))
  ) then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/cron/broadcasts',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;
revoke execute on function private.dispatch_broadcasts() from public, anon, authenticated;

select cron.schedule('nexo-broadcasts', '* * * * *', 'select private.dispatch_broadcasts()');
