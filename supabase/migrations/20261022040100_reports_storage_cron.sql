-- @supabase-only  (Storage, pg_cron, pg_net e Vault não existem no Postgres de teste)
-- =============================================================================
-- Arquivos dos relatórios (bucket privado) e disparador mensal.
-- O disparador roda de hora em hora e só chama o app quando alguma empresa
-- está no último dia do mês (no fuso dela), já passou do horário escolhido
-- e ainda não recebeu o relatório automático deste mês.
-- Usa os mesmos segredos do Vault das mensagens agendadas (app_url, cron_secret).
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('reports', 'reports', false, 20971520)
on conflict (id) do nothing;
-- Sem políticas em storage.objects para este bucket: só o servidor lê/grava.

create or replace function private.dispatch_monthly_reports()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if not exists (
    select 1 from public.report_settings rs
    where rs.enabled and rs.template_id is not null and rs.channel_id is not null and rs.target_id is not null
      and (now() at time zone rs.time_zone)::date = (date_trunc('month', now() at time zone rs.time_zone) + interval '1 month - 1 day')::date
      and extract(hour from now() at time zone rs.time_zone) >= rs.send_hour
      and not exists (
        select 1 from public.report_runs rr
        where rr.organization_id = rs.organization_id and rr.kind = 'auto'
          and rr.period = date_trunc('month', now() at time zone rs.time_zone)::date
          and (rr.status in ('sent', 'generating') or rr.attempts >= 3)
      )
  ) then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/cron/reports',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
end $$;
revoke execute on function private.dispatch_monthly_reports() from public, anon, authenticated;

select cron.schedule('nexo-monthly-reports', '7 * * * *', 'select private.dispatch_monthly_reports()');
