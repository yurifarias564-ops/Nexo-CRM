-- =============================================================================
-- Ingestão de mensagens do WhatsApp (chamada somente pelo servidor)
-- Atômica e idempotente: reenvio do mesmo evento nunca duplica mensagem,
-- e a importação de histórico usa o mesmo caminho em lotes.
-- =============================================================================

create or replace function public.ingest_message(
  p_channel uuid,
  p_wa_id text,
  p_contact_name text,
  p_external_id text,
  p_direction public.msg_direction,
  p_type public.msg_type,
  p_body text,
  p_media_ref text,
  p_media_mime text,
  p_status public.msg_status,
  p_sent_at timestamptz,
  p_sent_by uuid default null,
  p_is_history boolean default false
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_phone text;
  v_alt text;
  v_lead uuid;
  v_conv uuid;
  v_msg uuid;
  v_stage uuid;
  v_preview text;
begin
  select organization_id into v_org from public.whatsapp_channels where id = p_channel;
  if v_org is null then raise exception 'Canal inexistente'; end if;

  v_phone := nullif(regexp_replace(coalesce(p_wa_id, ''), '\D', '', 'g'), '');
  if v_phone is not null and v_phone !~ '^[0-9]{8,15}$' then v_phone := null; end if;

  -- Brasil: o WhatsApp pode entregar o celular com ou sem o 9º dígito.
  if v_phone is not null and v_phone like '55%' then
    if length(v_phone) = 12 and substr(v_phone, 5, 1) in ('6','7','8','9') then
      v_alt := substr(v_phone, 1, 4) || '9' || substr(v_phone, 5);
    elsif length(v_phone) = 13 and substr(v_phone, 5, 1) = '9' then
      v_alt := substr(v_phone, 1, 4) || substr(v_phone, 6);
    end if;
  end if;

  -- Lead: encontra pelo telefone (ou variante) ou cria na primeira etapa do primeiro funil
  if v_phone is not null then
    select id into v_lead from public.leads
    where organization_id = v_org and phone in (v_phone, coalesce(v_alt, v_phone))
    order by (phone = v_phone) desc
    limit 1;
    if v_lead is null then
      select s.id into v_stage
      from public.stages s join public.pipelines p on p.id = s.pipeline_id
      where s.organization_id = v_org
      order by p.position, s.position
      limit 1;
      if v_stage is not null then
        insert into public.leads (organization_id, pipeline_id, stage_id, name, phone, source, position)
        select v_org, s.pipeline_id, s.id,
               coalesce(nullif(trim(p_contact_name), ''), '+' || v_phone), v_phone, 'WhatsApp',
               coalesce((select min(position) from public.leads where stage_id = v_stage), 0) - 1
        from public.stages s where s.id = v_stage
        on conflict (organization_id, phone) do nothing
        returning id into v_lead;
        if v_lead is null then
          select id into v_lead from public.leads where organization_id = v_org and phone = v_phone;
        end if;
      end if;
    end if;
  end if;

  insert into public.conversations (organization_id, channel_id, lead_id, wa_id, contact_name)
  values (v_org, p_channel, v_lead, p_wa_id, nullif(trim(p_contact_name), ''))
  on conflict (channel_id, wa_id) do update
    set contact_name = coalesce(excluded.contact_name, public.conversations.contact_name),
        lead_id = coalesce(public.conversations.lead_id, excluded.lead_id)
  returning id into v_conv;

  insert into public.messages (organization_id, conversation_id, channel_id, external_id, direction, type,
                               body, media_ref, media_mime, status, sent_by, sent_at)
  values (v_org, v_conv, p_channel, p_external_id, p_direction, p_type,
          p_body, p_media_ref, p_media_mime, p_status, p_sent_by, coalesce(p_sent_at, now()))
  on conflict (channel_id, external_id) do nothing
  returning id into v_msg;

  if v_msg is null then
    -- Já existia (reenvio / eco). Nada a contabilizar.
    select id into v_msg from public.messages where channel_id = p_channel and external_id = p_external_id;
    return v_msg;
  end if;

  v_preview := left(coalesce(nullif(p_body, ''),
    case p_type when 'image' then '📷 Imagem' when 'audio' then '🎤 Áudio' when 'video' then '🎬 Vídeo'
                when 'document' then '📄 Documento' when 'sticker' then 'Figurinha' when 'location' then '📍 Localização'
                when 'contact' then '👤 Contato' else 'Mensagem' end), 140);

  update public.conversations c set
    last_message_preview = case when c.last_message_at is null or p_sent_at >= c.last_message_at then v_preview else c.last_message_preview end,
    last_message_at = greatest(coalesce(c.last_message_at, p_sent_at), p_sent_at),
    unread_count = c.unread_count + case when p_direction = 'in' and not p_is_history then 1 else 0 end
  where c.id = v_conv;

  if v_lead is not null then
    update public.leads l set last_message_at = greatest(coalesce(l.last_message_at, p_sent_at), p_sent_at)
    where l.id = v_lead and (l.last_message_at is null or l.last_message_at < p_sent_at);
  end if;

  return v_msg;
end $$;

-- Lote (importação de histórico): recebe um array JSON de mensagens
create or replace function public.ingest_messages(p_channel uuid, p_items jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare item jsonb; n integer := 0;
begin
  for item in select * from jsonb_array_elements(p_items) loop
    perform public.ingest_message(
      p_channel,
      item ->> 'wa_id',
      item ->> 'contact_name',
      item ->> 'external_id',
      (item ->> 'direction')::public.msg_direction,
      coalesce(item ->> 'type', 'text')::public.msg_type,
      item ->> 'body',
      item ->> 'media_ref',
      item ->> 'media_mime',
      coalesce(item ->> 'status', 'received')::public.msg_status,
      (item ->> 'sent_at')::timestamptz,
      null,
      true
    );
    n := n + 1;
  end loop;
  return n;
end $$;

-- Atualização de status (só avança: enviado → entregue → lido; falha prevalece)
create or replace function public.update_message_status(p_channel uuid, p_external_id text, p_status public.msg_status)
returns void
language sql security definer set search_path = '' as $$
  update public.messages m set status = p_status
  where m.channel_id = p_channel and m.external_id = p_external_id
    and (
      p_status = 'failed'
      or (case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end)
       > (case m.status when 'pending' then 0 when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 99 end)
    );
$$;

revoke execute on function public.ingest_message(uuid, text, text, text, public.msg_direction, public.msg_type, text, text, text, public.msg_status, timestamptz, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.ingest_messages(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.update_message_status(uuid, text, public.msg_status) from public, anon, authenticated;
grant execute on function public.ingest_message(uuid, text, text, text, public.msg_direction, public.msg_type, text, text, text, public.msg_status, timestamptz, uuid, boolean) to service_role;
grant execute on function public.ingest_messages(uuid, jsonb) to service_role;
grant execute on function public.update_message_status(uuid, text, public.msg_status) to service_role;
