-- @supabase-only  (pg_cron, pg_net e Vault não existem no Postgres de teste)
-- =============================================================================
-- Disparador: a cada minuto o banco chama a rota /api/cron/scheduled-messages
-- do app, mas SÓ quando existe mensagem vencida (sem custo quando não há).
-- Configuração (uma vez, no SQL Editor, depois do deploy):
--   select vault.create_secret('https://seu-dominio.com.br', 'app_url');
--   select vault.create_secret('<mesmo valor de CRON_SECRET>', 'cron_secret');
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function private.dispatch_scheduled_messages()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if not exists (select 1 from public.scheduled_messages where status = 'pending' and send_at <= now())
     and not exists (select 1 from public.scheduled_messages where status = 'sending' and claimed_at < now() - interval '10 minutes') then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/cron/scheduled-messages',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;
revoke execute on function private.dispatch_scheduled_messages() from public, anon, authenticated;

select cron.schedule('nexo-scheduled-messages', '* * * * *', 'select private.dispatch_scheduled_messages()');
