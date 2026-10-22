-- =============================================================================
-- TESTE AO VIVO DO BANCO — cole no Supabase > SQL Editor e clique em Run.
-- Cria 2 usuários e uma empresa de teste, roda 13 verificações e DESFAZ TUDO
-- no final (o erro "RESULTADO_TESTE" é proposital: é ele que desfaz e mostra
-- o resultado). Nenhum dado fica gravado.
-- =============================================================================
do $$
declare
  ua uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  ub uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  org uuid; st uuid; ch uuid; lead uuid; n int; ok boolean; txt text; res text := '';
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role, instance_id) values
    (ua,'teste-a@nexo.local','{"full_name":"Teste A"}','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ub,'teste-b@nexo.local','{}','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  select count(*) into n from public.profiles where id in (ua, ub);
  res := res || format(E'\n01 perfis criados no cadastro: %s (esperado 2)', n);

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
  org := public.create_organization('Empresa Teste A');
  select count(*) into n from public.stages;
  res := res || format(E'\n02 etapas visíveis SEM pagamento: %s (esperado 0)', n);
  select count(*) into n from public.subscriptions;
  res := res || format(E'\n03 vê a própria assinatura: %s (esperado 1)', n);
  update public.subscriptions set status='active'; get diagnostics n = row_count;
  res := res || format(E'\n04 tentou se auto-ativar, linhas alteradas: %s (esperado 0)', n);
  execute 'reset role';

  update public.subscriptions set status='active', current_period_end=now()+interval '30 days' where organization_id=org;

  execute 'set local role authenticated';
  select count(*) into n from public.stages;
  res := res || format(E'\n05 etapas COM pagamento: %s (esperado 7)', n);
  select id into st from public.stages where name='Novo lead';
  insert into public.leads (organization_id, pipeline_id, stage_id, name, phone)
    select organization_id, pipeline_id, id, 'Yuri Farias', '5585999998888' from public.stages where id=st returning id into lead;
  update public.leads set stage_id=(select id from public.stages where name='Negociação') where id=lead;
  insert into public.lead_tags (lead_id, tag_id, organization_id) select lead, id, org from public.tags where name='Anúncio';
  select count(*) into n from public.activities where lead_id=lead and type='stage_changed';
  res := res || format(E'\n06 mover lead registrou histórico: %s (esperado 1)', n);
  select name into txt from public.search_leads(org, 'yuri', 5) limit 1;
  res := res || format(E'\n07 busca do comando de voz por "yuri": %s (esperado Yuri Farias)', coalesce(txt,'(nada)'));
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.leads;
  res := res || format(E'\n08 outro usuário vê leads de A: %s (esperado 0)', n);
  update public.leads set name='hack' where id=lead; get diagnostics n = row_count;
  res := res || format(E'\n09 outro usuário alterou lead de A: %s (esperado 0)', n);
  execute 'reset role';

  insert into public.whatsapp_channels (organization_id, provider, name, status) values (org,'evolution','Teste','connected') returning id into ch;
  perform public.ingest_message(ch,'558599998888','Yuri','msg-1','in','text','Olá',null,null,'received',now());
  perform public.ingest_message(ch,'558599998888','Yuri','msg-1','in','text','Olá',null,null,'received',now());
  select count(*) into n from public.messages where channel_id=ch;
  res := res || format(E'\n10 mensagens após reenvio duplicado: %s (esperado 1)', n);
  select (lead_id = lead) into ok from public.conversations where channel_id=ch;
  res := res || format(E'\n11 conversa ligada ao lead (9º dígito): %s (esperado true)', ok);
  select unread_count into n from public.conversations where channel_id=ch;
  res := res || format(E'\n12 não lidas: %s (esperado 1)', n);

  update public.subscriptions set current_period_end=now()-interval '1 day' where organization_id=org;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.leads;
  res := res || format(E'\n13 assinatura vencida, leads visíveis: %s (esperado 0)', n);
  execute 'reset role';

  raise exception 'RESULTADO_TESTE (tudo foi desfeito): %', res;
end $$;
