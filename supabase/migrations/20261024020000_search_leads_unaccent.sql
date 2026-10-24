-- @supabase-only (a extensão unaccent não existe no banco de teste local)
-- Busca de lead por voz ignora acentos e maiúsculas (nomes vindos do WhatsApp: "Vitória", "JOÃO 🌸"...)
create extension if not exists unaccent with schema extensions;

create or replace function public.search_leads(org uuid, q text, max_results integer default 5)
returns table(id uuid, name text, phone text, stage_id uuid, score real)
language sql stable set search_path to ''
as $$
  with p as (
    select lower(extensions.unaccent(coalesce(q, ''))) as qq,
           regexp_replace(coalesce(q, ''), '\D', '', 'g') as digits
  )
  select l.id, l.name, l.phone, l.stage_id,
         greatest(
           extensions.similarity(lower(extensions.unaccent(l.name)), p.qq),
           extensions.word_similarity(p.qq, lower(extensions.unaccent(l.name)))
         )::real as score
  from public.leads l, p
  where l.organization_id = org
    and (
      lower(extensions.unaccent(l.name)) operator(extensions.%) p.qq
      or p.qq operator(extensions.<%) lower(extensions.unaccent(l.name))
      or lower(extensions.unaccent(l.name)) like '%' || p.qq || '%'
      or (length(p.digits) >= 4 and l.phone like '%' || p.digits || '%')
    )
  order by score desc, l.last_message_at desc nulls last
  limit least(max_results, 20);
$$;
