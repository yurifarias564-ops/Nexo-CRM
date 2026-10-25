-- Análise de crédito (revisão): respostas de bancos sem perder nenhuma, chave por ferramenta,
-- consentimento registrado e consultas apagadas junto com o lead.

-- A chave vale só para a ferramenta em que foi cadastrada (nunca vai para outro endereço)
alter table public.credit_secrets add column if not exists provider text not null default 'directd'
  check (provider in ('directd', 'bancos', 'webhook'));

-- Mensagem do cliente que autorizou a consulta (LGPD)
alter table public.credit_checks add column if not exists consent_message_id uuid;

-- Lead apagado: as consultas dele também (dados pessoais)
alter table public.credit_checks drop constraint if exists credit_checks_lead_id_fkey;
alter table public.credit_checks add constraint credit_checks_lead_id_fkey
  foreign key (lead_id) references public.leads (id) on delete cascade;

-- Junta a resposta de bancos de forma atômica (dois bancos respondendo juntos não se sobrescrevem)
create or replace function public.credit_merge_banks(p_id bigint, p_org uuid, p_banks jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_banks jsonb;
begin
  -- Trava a linha: a segunda resposta espera a primeira terminar e já vê o que ela gravou
  perform 1 from public.credit_checks where id = p_id and organization_id = p_org for update;
  if not found then return null; end if;
  select coalesce(jsonb_agg(x.b order by x.ord), '[]'::jsonb) into v_banks
  from (
    select distinct on (lower(e.b->>'banco')) e.b, e.ord
    from (
      select o.value as b, 0 as src, o.ordinality as ord
        from public.credit_checks c, jsonb_array_elements(c.banks) with ordinality o
       where c.id = p_id and c.organization_id = p_org
      union all
      select n.value, 1, 1000 + n.ordinality from jsonb_array_elements(coalesce(p_banks, '[]'::jsonb)) with ordinality n
    ) e
    order by lower(e.b->>'banco'), e.src desc
  ) x;
  update public.credit_checks set banks = v_banks, updated_at = now()
   where id = p_id and organization_id = p_org;
  return v_banks;
end;
$$;
revoke all on function public.credit_merge_banks(bigint, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.credit_merge_banks(bigint, uuid, jsonb) to service_role;
