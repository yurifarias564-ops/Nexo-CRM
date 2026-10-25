-- Revisão geral: travas contra duplicidade nas automações, IA e eventos da Meta.

-- Mensagens enviadas por automação (não contam como "pessoa respondeu", então não pausam a IA)
alter table public.messages add column if not exists by_automation boolean not null default false;

-- Até qual mensagem do cliente a IA já respondeu (evita responder duas vezes a mesma)
alter table public.conversations add column if not exists ai_answered_until timestamptz;

-- No máximo uma execução ativa da mesma automação para o mesmo lead
create unique index if not exists automation_runs_active_uniq
  on public.automation_runs (automation_id, lead_id)
  where status in ('running', 'processing', 'waiting');

-- Pega acontecimentos de forma exclusiva (duas execuções ao mesmo tempo nunca pegam o mesmo)
create or replace function public.automation_claim_events(p_limit integer)
returns setof public.automation_events
language sql
security definer
set search_path = ''
as $$
  update public.automation_events e
     set processed_at = now()
   where e.id in (
     select x.id from public.automation_events x
      where x.processed_at is null
      order by x.id
      limit greatest(1, least(p_limit, 1000))
      for update skip locked
   )
  returning e.*;
$$;
revoke all on function public.automation_claim_events(integer) from public, anon, authenticated;
grant execute on function public.automation_claim_events(integer) to service_role;

-- Eventos da Meta: marca "enviando" antes de mandar (sem envio duplicado) e espera entre tentativas
alter table public.meta_events add column if not exists next_attempt_at timestamptz;
alter table public.meta_events drop constraint if exists meta_events_status_check;
alter table public.meta_events add constraint meta_events_status_check check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'));
