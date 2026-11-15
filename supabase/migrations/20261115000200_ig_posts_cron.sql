-- @supabase-only  (pg_cron, pg_net e Vault não existem no Postgres de teste)
-- A cada minuto o banco chama /api/cron/ig-posts, só quando há publicação vencida ou em processamento.
create or replace function private.dispatch_ig_posts()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if not exists (select 1 from public.ig_flows where (post_status = 'scheduled' and post_at <= now()) or post_status = 'processing') then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/cron/ig-posts',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;
revoke execute on function private.dispatch_ig_posts() from public, anon, authenticated;

select cron.schedule('nexo-ig-posts', '* * * * *', 'select private.dispatch_ig_posts()');
