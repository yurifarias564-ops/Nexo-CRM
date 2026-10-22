import { requireApiContext } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, HttpError, ok } from "@/lib/http";
import { parseMoney, readRows } from "@/lib/spreadsheet";
import { between, normalizePhone, norm } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 20_000;

/** Importa leads de .xlsx/.csv. Atualiza quem já existe (pelo telefone) e cria os novos. */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`import:${ctx.userId}`, 5, 600, "Muitas importações seguidas. Aguarde alguns minutos.");
    const form = await req.formData();
    const file = form.get("file");
    const targetStage = String(form.get("stageId") ?? "");
    if (!(file instanceof File)) throw new HttpError(422, "Envie um arquivo .xlsx ou .csv");
    if (file.size > MAX_BYTES) throw new HttpError(413, "Arquivo maior que 8 MB");
    if (!/\.(xlsx|csv)$/i.test(file.name)) throw new HttpError(422, "Formato não suportado. Use .xlsx ou .csv");

    const { rows, recognized } = await readRows(file);
    if (!recognized.includes("name") && !recognized.includes("phone")) {
      throw new HttpError(422, "Não encontrei as colunas Nome ou Telefone na primeira linha da planilha");
    }
    if (rows.length > MAX_ROWS) throw new HttpError(413, `Máximo de ${MAX_ROWS.toLocaleString("pt-BR")} linhas por importação`);

    const sb = await supabaseServer();
    const [{ data: stages }, { data: tags }] = await Promise.all([
      sb.from("stages").select("id, name, pipeline_id, position, pipelines(position)").order("position"),
      sb.from("tags").select("id, name"),
    ]);
    type S = { id: string; name: string; pipeline_id: string; position: number; pipelines: { position: number } | { position: number }[] | null };
    const stageList = ((stages ?? []) as S[]).sort((a, b) => {
      const pa = (Array.isArray(a.pipelines) ? a.pipelines[0] : a.pipelines)?.position ?? 0;
      const pb = (Array.isArray(b.pipelines) ? b.pipelines[0] : b.pipelines)?.position ?? 0;
      return pa - pb || a.position - b.position;
    });
    const defaultStage = stageList.find((s) => s.id === targetStage) ?? stageList[0];
    if (!defaultStage) throw new HttpError(409, "Crie ao menos uma etapa no funil antes de importar");
    const stageByName = new Map(stageList.map((s) => [norm(s.name), s]));
    const tagByName = new Map(((tags ?? []) as { id: string; name: string }[]).map((t) => [norm(t.name), t.id]));

    // Telefones já existentes → atualização em vez de duplicar
    const phones = [...new Set(rows.map((r) => normalizePhone(r.phone)).filter((p): p is string => Boolean(p)))];
    const existing = new Set<string>();
    for (let i = 0; i < phones.length; i += 500) {
      const { data } = await sb.from("leads").select("phone").in("phone", phones.slice(i, i + 500));
      (data ?? []).forEach((l) => l.phone && existing.add(l.phone));
    }

    const errors: { row: number; message: string }[] = [];
    const seen = new Set<string>();
    const records: Record<string, unknown>[] = [];
    const tagLinks: { phone: string | null; name: string; tags: string[] }[] = [];
    let pos = -Date.now() / 1000;

    rows.forEach((r, i) => {
      const line = i + 2;
      const phone = normalizePhone(r.phone);
      if (r.phone && !phone) { errors.push({ row: line, message: `Telefone inválido: ${r.phone}` }); return; }
      const name = (r.name ?? "").slice(0, 160) || (phone ? `+${phone}` : "");
      if (!name) { errors.push({ row: line, message: "Linha sem nome e sem telefone" }); return; }
      if (phone) {
        if (seen.has(phone)) { errors.push({ row: line, message: `Telefone repetido na planilha: ${r.phone}` }); return; }
        seen.add(phone);
      }
      const stage = r.stage ? stageByName.get(norm(r.stage)) : undefined;
      if (r.stage && !stage) errors.push({ row: line, message: `Etapa "${r.stage}" não existe — lead colocado em "${defaultStage.name}"` });
      const st = stage ?? defaultStage;
      const value = parseMoney(r.value);
      const email = r.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email) ? r.email.slice(0, 254) : null;
      pos = between(pos, undefined);
      const rec: Record<string, unknown> = { organization_id: ctx.org.id, pipeline_id: st.pipeline_id, stage_id: st.id, name, phone };
      if (email) rec.email = email;
      if (value !== null) rec.value = value;
      if (r.source) rec.source = r.source.slice(0, 80);
      if (r.notes) rec.notes = r.notes.slice(0, 5000);
      if (!phone || !existing.has(phone)) rec.position = pos; // não reordena leads existentes
      records.push(rec);
      const tagNames = (r.tags ?? "").split(/[,;|]/).map((t) => t.trim()).filter(Boolean).slice(0, 20);
      if (tagNames.length) tagLinks.push({ phone, name, tags: tagNames });
    });

    // PostgREST exige mesmas chaves em lote: separa novos (com position) de atualizações
    const withPhone = records.filter((r) => r.phone);
    const noPhone = records.filter((r) => !r.phone);
    const idByPhone = new Map<string, string>();
    const idByName = new Map<string, string>();

    const groups = new Map<string, Record<string, unknown>[]>();
    for (const r of withPhone) {
      const k = Object.keys(r).sort().join(",");
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    for (const group of groups.values()) {
      for (let i = 0; i < group.length; i += 500) {
        const { data, error } = await sb.from("leads").upsert(group.slice(i, i + 500), { onConflict: "organization_id,phone" }).select("id, phone");
        if (error) throw error;
        (data ?? []).forEach((l) => l.phone && idByPhone.set(l.phone, l.id));
      }
    }
    const npGroups = new Map<string, Record<string, unknown>[]>();
    for (const r of noPhone) {
      const k = Object.keys(r).sort().join(",");
      npGroups.set(k, [...(npGroups.get(k) ?? []), r]);
    }
    for (const group of npGroups.values()) {
      for (let i = 0; i < group.length; i += 500) {
        const { data, error } = await sb.from("leads").insert(group.slice(i, i + 500).map(({ phone: _p, ...rest }) => rest)).select("id, name");
        if (error) throw error;
        (data ?? []).forEach((l) => idByName.set(l.name, l.id));
      }
    }

    // Tags (cria as que não existem)
    const missing = [...new Set(tagLinks.flatMap((t) => t.tags))].filter((t) => !tagByName.has(norm(t)));
    for (const name of missing.slice(0, 200)) {
      const r = await sb.from("tags").insert({ organization_id: ctx.org.id, name: name.slice(0, 40) }).select("id, name").maybeSingle();
      if (r.data) tagByName.set(norm(r.data.name), r.data.id);
      else if (r.error && r.error.code !== "23505") throw r.error;
    }
    if (missing.length) {
      const { data: all } = await sb.from("tags").select("id, name");
      (all ?? []).forEach((t) => tagByName.set(norm(t.name), t.id));
    }
    const links: { lead_id: string; tag_id: string; organization_id: string }[] = [];
    for (const t of tagLinks) {
      const leadId = t.phone ? idByPhone.get(t.phone) : idByName.get(t.name);
      if (!leadId) continue;
      for (const tn of t.tags) {
        const tagId = tagByName.get(norm(tn));
        if (tagId) links.push({ lead_id: leadId, tag_id: tagId, organization_id: ctx.org.id });
      }
    }
    for (let i = 0; i < links.length; i += 1000) {
      const { error } = await sb.from("lead_tags").upsert(links.slice(i, i + 1000), { onConflict: "lead_id,tag_id", ignoreDuplicates: true });
      if (error) throw error;
    }

    const updated = withPhone.filter((r) => existing.has(r.phone as string)).length;
    return ok({ inserted: records.length - updated, updated, skipped: rows.length - records.length, errors: errors.slice(0, 200) });
  } catch (e) {
    return fail(e);
  }
}
