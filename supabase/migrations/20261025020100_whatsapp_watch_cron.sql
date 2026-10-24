-- @supabase-only  (pg_cron, pg_net e Vault não existem no Postgres de teste)
-- Vigia: a cada minuto o banco chama /api/cron/whatsapp-watch, mas só se existir número por QR Code.
-- Endereço e segredo ficam no Vault; o próprio app grava (private.set_cron_config) — ninguém digita segredo.

create or replace function private.set_cron_config(p_url text, p_secret text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'app_url';
  if v_id is null then perform vault.create_secret(p_url, 'app_url'); else perform vault.update_secret(v_id, p_url); end if;
  select id into v_id from vault.secrets where name = 'cron_secret';
  if v_id is null then perform vault.create_secret(p_secret, 'cron_secret'); else perform vault.update_secret(v_id, p_secret); end if;
end $$;
revoke execute on function private.set_cron_config(text, text) from public, anon, authenticated;

create or replace function public.configure_automations(p_url text, p_secret text)
returns void language sql security definer set search_path = '' as $$
  select private.set_cron_config(p_url, p_secret);
$$;
revoke execute on function public.configure_automations(text, text) from public, anon, authenticated;
grant execute on function public.configure_automations(text, text) to service_role;

create or replace function private.dispatch_whatsapp_watch()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if not exists (select 1 from public.whatsapp_channels where provider = 'evolution' and not needs_qr) then return; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/cron/whatsapp-watch',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;
revoke execute on function private.dispatch_whatsapp_watch() from public, anon, authenticated;

select cron.schedule('nexo-whatsapp-watch', '* * * * *', 'select private.dispatch_whatsapp_watch()');
