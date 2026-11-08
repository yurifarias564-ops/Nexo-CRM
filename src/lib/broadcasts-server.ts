import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/http";
import { loadChannel, type ChannelWithSecrets } from "@/lib/whatsapp";
import * as meta from "@/lib/whatsapp/meta";
import { META_APP_ID } from "@/lib/meta-config";
import { mediaKind, MAX_MEDIA_BYTES, sendBroadcastTemplate, sendMediaFile, sendText, uploadMetaMediaFor } from "@/lib/send";
import { friendly } from "@/lib/scheduled";
import {
  estimateCost, idleBefore, jitter, MAX_RECIPIENTS, planSteps, renderVars, templateParamValues,
  type Audience, type BroadcastRow, type CostEstimate, type MediaItem, type TemplateCategory, type TemplateParam,
} from "@/lib/broadcasts";

const BUCKET = "automation-media";

export async function channelFor(orgId: string, channelId: string): Promise<ChannelWithSecrets> {
  const ch = await loadChannel(channelId).catch(() => null);
  if (!ch || ch.organization_id !== orgId) throw new HttpError(404, "Número não encontrado");
  if (ch.provider === "instagram") throw new HttpError(422, "Disparo é só pelo WhatsApp");
  if (ch.status !== "connected") throw new HttpError(409, `O número "${ch.name}" não está conectado`);
  return ch;
}

export async function resolveAudience(orgId: string, a: Audience) {
  const { data, error } = await supabaseAdmin().rpc("broadcast_audience", {
    p_org: orgId, p_tag_ids: a.tagIds, p_stage_ids: a.stageIds, p_idle_before: idleBefore(a.idleMonths),
    p_lead_ids: a.leadIds, p_exclude: a.excludeLeadIds,
  }).limit(MAX_RECIPIENTS + 1);
  if (error) throw error;
  return (data ?? []) as { lead_id: string; name: string | null; phone: string }[];
}

export interface TemplateChoice { name: string; language: string; params: TemplateParam[] }

export async function findTemplate(ch: ChannelWithSecrets, name: string, language: string) {
  const token = ch.secrets.meta_access_token;
  if (!token || !ch.meta_waba_id) throw new HttpError(409, "Número oficial sem credenciais");
  return (await meta.listAllTemplates(ch.meta_waba_id, token)).find((x) => x.name === name && x.language === language) ?? null;
}

/** Confere o modelo na Meta: precisa estar aprovado e com os campos preenchidos. */
export async function checkTemplate(ch: ChannelWithSecrets, t: TemplateChoice) {
  const token = ch.secrets.meta_access_token;
  if (!token || !ch.meta_waba_id) throw new HttpError(409, "Número oficial sem credenciais");
  const all = await meta.listAllTemplates(ch.meta_waba_id, token);
  const tpl = all.find((x) => x.name === t.name && x.language === t.language);
  if (!tpl) throw new HttpError(404, "Modelo não encontrado nessa conta");
  if (tpl.status !== "APPROVED") throw new HttpError(422, "Esse modelo ainda não foi aprovado pela Meta");
  if (!tpl.sendable) throw new HttpError(422, "Esse modelo tem campos que o disparo ainda não preenche (link dinâmico ou variável no título)");
  if (t.params.length !== tpl.params || t.params.some((p) => p.kind === "text" && !p.value.trim())) throw new HttpError(422, `Preencha os ${tpl.params} campos do modelo`);
  return tpl;
}

export async function costFor(ch: ChannelWithSecrets, phones: string[], category: TemplateCategory): Promise<CostEstimate> {
  const currency = ch.meta_waba_id && ch.secrets.meta_access_token ? await meta.wabaCurrency(ch.meta_waba_id, ch.secrets.meta_access_token) : null;
  return estimateCost(phones, category, currency);
}

export interface CreateInput {
  name: string;
  channelId: string;
  audience: Audience;
  audienceLabel: string;
  body: string | null;
  template: TemplateChoice | null;
  sendAt: Date;
  timeZone: string;
  intervalSeconds: number;
  /** Custo que a pessoa viu e confirmou (API oficial): se mudou, pedimos para conferir de novo. */
  confirmedCost: number | null;
}

export async function createBroadcast(ctx: { orgId: string; userId: string }, input: CreateInput, files: File[], headerFile: File | null) {
  const db = supabaseAdmin();
  const ch = await channelFor(ctx.orgId, input.channelId);
  const provider = ch.provider as "meta" | "zapi" | "evolution";
  const people = await resolveAudience(ctx.orgId, input.audience);
  if (!people.length) throw new HttpError(422, "Nenhum lead com telefone nesse público");
  if (people.length > MAX_RECIPIENTS) throw new HttpError(422, `Máximo de ${MAX_RECIPIENTS.toLocaleString("pt-BR")} pessoas por disparo. Filtre mais o público.`);
  if (input.sendAt.getTime() < Date.now() - 5 * 60_000) throw new HttpError(422, "A data do disparo já passou");

  let tplCategory: TemplateCategory | null = null;
  let tplBody: string | null = null;
  let cost: CostEstimate | null = null;
  if (provider === "meta") {
    if (!input.template) throw new HttpError(422, "Na API oficial o disparo precisa de um modelo aprovado pela Meta");
    if (files.length) throw new HttpError(422, "Na API oficial a mídia vai no cabeçalho do modelo");
    const tpl = await checkTemplate(ch, input.template);
    tplCategory = (["MARKETING", "UTILITY", "AUTHENTICATION"].includes(tpl.category) ? tpl.category : "MARKETING") as TemplateCategory;
    tplBody = tpl.body.slice(0, 4096) || null;
    const needsMedia = tpl.header && tpl.header.format !== "TEXT";
    if (needsMedia && !headerFile) throw new HttpError(422, `Esse modelo pede ${tpl.header!.format === "IMAGE" ? "uma foto" : tpl.header!.format === "VIDEO" ? "um vídeo" : "um documento"} no cabeçalho`);
    cost = await costFor(ch, people.map((p) => p.phone), tplCategory);
    if (input.confirmedCost !== null && cost.total !== null && Math.abs(cost.total - input.confirmedCost) > 0.009) {
      throw new HttpError(409, "O público mudou desde a prévia e o custo ficou diferente. Revise o valor e confirme de novo.");
    }
  } else {
    if (input.template) throw new HttpError(422, "Modelos só existem na API oficial");
    if (!input.body && !files.length) throw new HttpError(422, "Escreva a mensagem ou adicione uma mídia");
  }
  if (files.length > 2) throw new HttpError(422, "No máximo 2 mídias por disparo");

  const id = crypto.randomUUID();
  const store = async (f: File, i: number): Promise<MediaItem> => {
    if (f.size === 0) throw new HttpError(422, "Arquivo vazio");
    if (f.size > MAX_MEDIA_BYTES) throw new HttpError(413, `"${f.name}" passa de 16 MB`);
    const mime = (f.type || "application/octet-stream").split(";")[0]!.toLowerCase();
    const name = f.name.replace(/[^\w.\- ]+/g, "_").slice(0, 100) || `arquivo-${i + 1}`;
    const path = `${ctx.orgId}/broadcasts/${id}/${i}-${name.replace(/\s+/g, "_")}`;
    const up = await db.storage.from(BUCKET).upload(path, Buffer.from(await f.arrayBuffer()), { contentType: mime, upsert: true });
    if (up.error) throw new HttpError(502, "Não consegui guardar o arquivo. Tente de novo.");
    return { path, mime, kind: mediaKind(mime), name, size: f.size };
  };
  const media = await Promise.all(files.map(store));
  const header = headerFile ? await store(headerFile, 9) : null;

  const { error } = await db.from("broadcasts").insert({
    id, organization_id: ctx.orgId, created_by: ctx.userId, name: input.name, channel_id: ch.id, provider,
    audience: { ...input.audience, label: input.audienceLabel }, body: provider === "meta" ? tplBody : input.body, media,
    template_name: input.template?.name ?? null, template_language: input.template?.language ?? null, template_category: tplCategory,
    template_params: input.template?.params ?? [], template_header: header,
    send_at: input.sendAt.toISOString(), time_zone: input.timeZone,
    interval_seconds: provider === "meta" ? 0 : input.intervalSeconds, total: people.length,
    cost_currency: cost?.currency ?? null, cost_unit: cost?.unit ?? null, cost_estimated: cost?.total ?? null, cost_other_country: cost?.otherCountry ?? 0,
  });
  if (error) throw error;
  for (let i = 0; i < people.length; i += 500) {
    const chunk = people.slice(i, i + 500).map((p) => ({ broadcast_id: id, organization_id: ctx.orgId, lead_id: p.lead_id, phone: p.phone, name: p.name }));
    const { error: e2 } = await db.from("broadcast_recipients").insert(chunk);
    if (e2) {
      await db.from("broadcasts").delete().eq("id", id);
      throw e2;
    }
  }
  return { id, total: people.length, cost };
}

// ============================ Disparador ============================

type Rcpt = { id: number; broadcast_id: string; organization_id: string; lead_id: string; phone: string; name: string | null };

async function download(item: MediaItem) {
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(item.path);
  if (error || !data) throw new HttpError(502, "Não consegui abrir a mídia do disparo");
  return data;
}

async function orgActive(orgId: string) {
  const { data: sub } = await supabaseAdmin().from("subscriptions").select("status, current_period_end").eq("organization_id", orgId).maybeSingle();
  return sub?.status === "active" && (!sub.current_period_end || new Date(sub.current_period_end) > new Date());
}

/** Envia para um destinatário. Lança erro com mensagem amigável se falhar. */
async function sendOne(b: BroadcastRow & { organization_id: string }, r: Rcpt, cache: { files: Map<string, File>; headerId?: string; channel?: ChannelWithSecrets }) {
  const db = supabaseAdmin();
  const target = { leadId: r.lead_id, channelId: b.channel_id };
  if (b.provider === "meta") {
    const params = templateParamValues(b.template_params, r.name);
    let header: { type: "image" | "video" | "document"; mediaId: string; filename?: string } | undefined;
    if (b.template_header) {
      if (!cache.headerId) {
        cache.channel ??= await loadChannel(b.channel_id);
        cache.headerId = await uploadMetaMediaFor(cache.channel, await download(b.template_header), b.template_header.mime, b.template_header.name);
      }
      const k = b.template_header.kind;
      header = { type: k === "image" || k === "video" ? k : "document", mediaId: cache.headerId, filename: b.template_header.name };
    }
    const rendered = b.body ? meta.renderTemplate(b.body, params) : `Modelo ${b.template_name}`;
    await sendBroadcastTemplate(b.organization_id, target, b.template_name!, b.template_language!, params, rendered, header);
    return;
  }
  const text = b.body ? renderVars(b.body, r.name) : "";
  for (const step of planSteps(Boolean(text), b.media)) {
    if (step.kind === "text") {
      await sendText(db, b.organization_id, null, target, text, { automation: true });
      continue;
    }
    const item = b.media[step.index]!;
    let file = cache.files.get(item.path);
    if (!file) {
      file = new File([await download(item)], item.name, { type: item.mime });
      cache.files.set(item.path, file);
    }
    await sendMediaFile(db, b.organization_id, null, target, file, step.withText ? text : "", { automation: true });
  }
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * Roda os disparos vencidos dentro de um tempo limite. Respeita o ritmo de cada
 * disparo e confere o status antes de cada envio: pausar ou cancelar para na hora.
 */
export async function dispatchBroadcasts(budgetMs = 50_000) {
  const db = supabaseAdmin();
  const t0 = Date.now();
  const left = () => budgetMs - (Date.now() - t0);
  const result = { broadcasts: 0, sent: 0, failed: 0 };

  await db.from("broadcasts").update({ status: "sending", started_at: new Date().toISOString() })
    .eq("status", "scheduled").lte("send_at", new Date().toISOString());
  const { data: list } = await db.from("broadcasts").select("*").eq("status", "sending")
    .or(`next_send_at.is.null,next_send_at.lte.${new Date(Date.now() + 5000).toISOString()}`).order("send_at").limit(20);

  for (const b of (list ?? []) as (BroadcastRow & { organization_id: string })[]) {
    if (left() < 3000) break;
    result.broadcasts++;
    if (!(await orgActive(b.organization_id))) {
      await db.from("broadcasts").update({ status: "paused" }).eq("id", b.id);
      continue;
    }
    const cache = { files: new Map<string, File>() } as { files: Map<string, File>; headerId?: string; channel?: ChannelWithSecrets };
    const batch = b.interval_seconds > 0 ? 1 : 10;
    let stop = false;
    while (!stop && left() > 3000) {
      const { data: st } = await db.from("broadcasts").select("status").eq("id", b.id).maybeSingle();
      if (st?.status !== "sending") break;
      const { data: rows, error } = await db.rpc("claim_broadcast_recipients", { p_broadcast: b.id, p_limit: batch });
      if (error) throw error;
      const claimed = (rows ?? []) as Rcpt[];
      if (!claimed.length) break;
      await Promise.all(claimed.map(async (r) => {
        try {
          await sendOne(b, r, cache);
          await db.from("broadcast_recipients").update({ status: "sent", sent_at: new Date().toISOString(), error: null }).eq("id", r.id);
          result.sent++;
        } catch (e) {
          await db.from("broadcast_recipients").update({ status: "failed", error: friendly(e).slice(0, 500) }).eq("id", r.id);
          result.failed++;
          if (!(e instanceof HttpError)) console.error("[broadcast]", b.id, r.id, e);
        }
      }));
      await db.rpc("refresh_broadcast", { p_broadcast: b.id });
      if (b.interval_seconds > 0) {
        const wait = jitter(b.interval_seconds, Math.random()) * 1000;
        if (wait + 2000 > left()) {
          await db.from("broadcasts").update({ next_send_at: new Date(Date.now() + wait).toISOString() }).eq("id", b.id);
          stop = true;
        } else {
          await sleep(wait);
        }
      }
    }
    await db.rpc("refresh_broadcast", { p_broadcast: b.id });
  }
  return result;
}

export { META_APP_ID };
