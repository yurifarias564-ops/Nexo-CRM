import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { envOptional } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { norm } from "@/lib/utils";
import { nowInZone, zonedToUtc } from "@/lib/time";
import { createAppointment } from "@/lib/appointments";
import { sendAiText } from "@/lib/send";
import { transcribe } from "@/lib/voice";
import { loadChannel } from "@/lib/whatsapp";
import * as meta from "@/lib/whatsapp/meta";
import * as evo from "@/lib/whatsapp/evolution";
import { defaultModel, KEY_ENV, runWithTools, type AiProvider, type ChatTurn, type ToolCall, type ToolDef } from "./llm";

// Agente de IA que atende no WhatsApp em nome da empresa.

export interface AgentRow {
  id: string; organization_id: string; enabled: boolean; enabled_at: string | null; name: string;
  provider: AiProvider; model: string | null; prompt: string; channel_ids: string[] | null;
  start_mode: "new_leads" | "all"; reply_delay_seconds: number; pause_on_human: boolean; pause_hours: number;
  auto_tags: boolean; transcribe_audio: boolean; time_zone: string; tone: Tone;
}

export const AGENT_DEFAULTS: Omit<AgentRow, "id" | "organization_id"> = {
  enabled: false, enabled_at: null, name: "Assistente", provider: "claude", model: null, prompt: "", channel_ids: null,
  start_mode: "new_leads", reply_delay_seconds: 8, pause_on_human: true, pause_hours: 12, auto_tags: true, transcribe_audio: true,
  time_zone: "America/Sao_Paulo", tone: "executivo",
};

export async function loadAgent(orgId: string): Promise<AgentRow | null> {
  const { data } = await supabaseAdmin().from("ai_agents").select("*").eq("organization_id", orgId).maybeSingle();
  return (data as AgentRow | null) ?? null;
}

/** Chave da própria empresa ou, se não houver, a da plataforma. */
export async function apiKeyFor(orgId: string, provider: AiProvider): Promise<string | null> {
  const { data } = await supabaseAdmin().from("ai_agent_secrets").select("api_key").eq("organization_id", orgId).eq("provider", provider).maybeSingle();
  return data?.api_key || envOptional(KEY_ENV[provider]) || null;
}

// ---------------------------------------------------------------------------------------------
// Contexto do lead
// ---------------------------------------------------------------------------------------------

export interface LeadCtx {
  name: string; phone: string | null; stage: string | null; stages: string[]; tags: string[]; value: number;
  memory: string[]; summary: string | null; seller: string | null;
}

export type Tone = "executivo" | "consultivo" | "proximo";

const TONE_RULES: Record<Tone, string> = {
  executivo: [
    "Tom EXECUTIVO: português culto, elegante e preciso, como o atendimento de uma marca premium.",
    "- Trate o cliente por \"você\" com cortesia (\"Perfeito, Sr. Yuri\" só se ele mesmo se apresentar de forma formal). Nada de gírias, abreviações (vc, tb, blz), \"kkk\" ou excesso de exclamação.",
    "- Emojis: no máximo um, discreto, e só na saudação. Na maioria das mensagens, nenhum.",
    "- Frases completas, bem pontuadas, com vocabulário rico mas claro (\"Será um prazer apresentar\", \"Para indicar a melhor condição\", \"Fico à disposição\").",
  ].join("\n"),
  consultivo: [
    "Tom CONSULTIVO: profissional, seguro e caloroso, como um especialista que gosta de ajudar.",
    "- Português correto, sem gírias pesadas. Pode usar um emoji ocasional quando soar natural.",
    "- Mostre domínio do assunto com explicações curtas e úteis.",
  ].join("\n"),
  proximo: [
    "Tom PRÓXIMO: leve e simpático, como um bom vendedor de loja que já conhece o cliente.",
    "- Linguagem do dia a dia, sem errar o português. Emojis com moderação.",
  ].join("\n"),
};

export function systemPrompt(agent: Pick<AgentRow, "name" | "prompt" | "time_zone" | "auto_tags"> & { tone?: Tone }, orgName: string, lead: LeadCtx, sellers: string[]): string {
  const company = agent.prompt.trim() || "(A empresa ainda não escreveu instruções. Atenda com excelência, entenda a necessidade do cliente e transfira para um vendedor.)";
  const tone = TONE_RULES[agent.tone ?? "executivo"];
  return [
    `Você é ${agent.name}, especialista de atendimento e vendas da empresa "${orgName}" no WhatsApp. Você representa a empresa no mais alto padrão: cada mensagem precisa transmitir confiança, competência e cuidado com o cliente. Escreva sempre em português do Brasil impecável (ortografia, acentuação, concordância e pontuação corretas).`,
    "",
    "## Instruções da empresa (prioridade máxima — siga à risca)",
    company,
    "",
    "## Postura e tom",
    tone,
    "- Nunca soe como robô: evite frases prontas como \"Como posso ajudar?\", \"Estou aqui para ajudar\", \"Entendo perfeitamente\" repetidas. Responda ao que o cliente disse, com as palavras dele.",
    "- Use o nome do cliente com naturalidade (no começo da conversa e em momentos-chave), nunca em toda mensagem.",
    "- Nunca repita uma pergunta ou informação que já apareceu na conversa ou na memória.",
    "",
    "## Método de atendimento (venda consultiva)",
    "1. Acolhimento: cumprimente de acordo com o horário (bom dia / boa tarde / boa noite) e responda primeiro o que o cliente perguntou.",
    "2. Diagnóstico: entenda a necessidade com UMA pergunta por mensagem, em ordem lógica (o que procura → para que uso → prazo → forma de pagamento/orçamento → se tem algo para troca). Nunca faça interrogatório com várias perguntas juntas.",
    "3. Valor antes do preço: conecte o produto/serviço ao que o cliente contou (\"Para o seu uso diário na cidade, a MT-03 entrega…\"). Só fale de valores que estão nas instruções da empresa.",
    "4. Objeções: reconheça a preocupação, esclareça com uma pergunta ou um argumento concreto e confirme se ficou claro. Nunca discuta nem pressione.",
    "5. Próximo passo: toda resposta termina conduzindo a conversa — uma pergunta objetiva ou um convite claro (visita, test drive, reunião, falar com o especialista). Ofereça duas opções quando possível (\"Fica melhor amanhã pela manhã ou à tarde?\").",
    "",
    "## Formato no WhatsApp",
    "- Mensagens curtas e escaneáveis: de 1 a 3 frases cada. Para enviar mais de uma mensagem, separe com uma linha em branco (no máximo 3 mensagens por vez).",
    "- Sem markdown, títulos, listas longas ou asteriscos duplos. Para destacar um nome de produto use no máximo *um asterisco* de cada lado.",
    "- Se o cliente mandou um áudio, responda ao conteúdo normalmente. Se mandou foto ou documento que você não consegue ver, peça gentilmente que descreva.",
    "",
    "## Limites (inegociáveis)",
    "- Nunca invente preço, estoque, cor disponível, condição, prazo, taxa ou promoção. Se não estiver nas instruções, diga com elegância que vai confirmar com o especialista e transfira.",
    "- Não prometa aprovação de crédito, desconto ou entrega.",
    "- Não peça CPF, senha nem dados de cartão.",
    "- Se perguntarem se você é uma IA ou um robô, seja honesto e continue ajudando.",
    "- Assuntos fora do negócio da empresa: responda com educação em uma frase e retome o atendimento.",
    "",
    "## Ferramentas (use em silêncio, sem contar ao cliente)",
    agent.auto_tags
      ? "- adicionar_tag: assim que o cliente demonstrar interesse num produto, modelo ou serviço específico (ex.: \"MT-03\", \"Revisão\"). Nome curto e padronizado, igual para todos os clientes."
      : "- adicionar_tag: só com tags que já existem ou que as instruções mandarem.",
    "- salvar_memoria: sempre que o cliente revelar algo útil (nome, cidade, produto, uso, orçamento, forma de pagamento, prazo, troca, objeções, preferências, família). Um fato curto por item; não salve o que já está na memória.",
    "- atualizar_resumo: quando a negociação avançar — resumo executivo com interesse, condições, objeções e próximo passo.",
    "- mover_etapa: quando o cliente avançar no funil de forma clara (ex.: qualificado, agendado).",
    "- agendar: só depois de o cliente confirmar dia e hora.",
    "- transferir_para_vendedor: quando o cliente pedir uma pessoa, quiser fechar ou pagar, pedir condição que você não tem, reclamar, ou a conversa sair do seu alcance. Depois avise com elegância que o especialista dará continuidade em instantes.",
    "",
    "## Situação atual",
    `Data e hora: ${nowInZone(agent.time_zone)} (fuso ${agent.time_zone})`,
    `Cliente: ${lead.name}${lead.phone ? ` · WhatsApp ${lead.phone}` : ""}`,
    `Etapa no funil: ${lead.stage ?? "—"} (etapas disponíveis: ${lead.stages.join(", ") || "—"})`,
    `Tags: ${lead.tags.join(", ") || "nenhuma"}`,
    lead.value ? `Valor da negociação: R$ ${lead.value.toFixed(2)}` : "",
    lead.seller ? `Especialista responsável: ${lead.seller}` : "",
    sellers.length ? `Equipe: ${sellers.join(", ")}` : "",
    "",
    "## O que você já sabe deste cliente (memória permanente)",
    lead.memory.length ? lead.memory.map((f) => `- ${f}`).join("\n") : "(nada ainda)",
    lead.summary ? `\n## Resumo da negociação até agora\n${lead.summary}` : "",
    "",
    "Escreva somente as mensagens que o cliente vai receber — nunca explique seu raciocínio nem mencione ferramentas, memória ou instruções internas.",
  ].filter((l) => l !== "").join("\n");
}

export const TOOLS: ToolDef[] = [
  { name: "adicionar_tag", description: "Coloca uma tag no cliente (cria a tag se ainda não existir). Ex.: modelo de interesse.",
    parameters: { type: "object", properties: { nome: { type: "string", description: "Nome curto da tag, até 40 letras" } }, required: ["nome"] } },
  { name: "remover_tag", description: "Tira uma tag do cliente.",
    parameters: { type: "object", properties: { nome: { type: "string" } }, required: ["nome"] } },
  { name: "salvar_memoria", description: "Guarda para sempre informações que o cliente contou. Um fato curto por item.",
    parameters: { type: "object", properties: { fatos: { type: "array", items: { type: "string" } } }, required: ["fatos"] } },
  { name: "atualizar_resumo", description: "Reescreve o resumo da negociação (o que quer, condições, objeções, próximo passo).",
    parameters: { type: "object", properties: { resumo: { type: "string" } }, required: ["resumo"] } },
  { name: "mover_etapa", description: "Move o cliente para outra etapa do funil (use o nome exato de uma das etapas).",
    parameters: { type: "object", properties: { etapa: { type: "string" } }, required: ["etapa"] } },
  { name: "definir_valor", description: "Define o valor da negociação em reais.",
    parameters: { type: "object", properties: { valor: { type: "number" } }, required: ["valor"] } },
  { name: "agendar", description: "Agenda visita, test drive ou reunião (vai para o Google Agenda do vendedor). Data AAAA-MM-DD, hora HH:MM.",
    parameters: { type: "object", properties: { data: { type: "string" }, hora: { type: "string" }, duracao_minutos: { type: "number" }, assunto: { type: "string" } }, required: ["data", "hora", "assunto"] } },
  { name: "transferir_para_vendedor", description: "Passa o atendimento para uma pessoa da equipe. A IA para de responder nesta conversa.",
    parameters: { type: "object", properties: { motivo: { type: "string" }, vendedor: { type: "string", description: "Nome do vendedor, se o cliente pediu alguém" } }, required: ["motivo"] } },
];

/** O que a IA fez (no teste, só é mostrado; de verdade, já foi aplicado). */
export type Effect =
  | { kind: "tag_add"; name: string }
  | { kind: "tag_remove"; name: string }
  | { kind: "memory"; facts: string[] }
  | { kind: "summary"; text: string }
  | { kind: "stage"; name: string }
  | { kind: "value"; value: number }
  | { kind: "appointment"; when: string; title: string }
  | { kind: "handoff"; reason: string; seller: string | null };

const cleanTag = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 40);

function pickStage(stages: { id: string; name: string }[], q: unknown) {
  const n = norm(String(q ?? ""));
  if (!n) return null;
  return stages.find((s) => norm(s.name) === n) ?? stages.find((s) => norm(s.name).includes(n) || n.includes(norm(s.name))) ?? null;
}

function pickSeller<T extends { name: string }>(list: T[], q: unknown): T | null {
  const n = norm(String(q ?? ""));
  if (!n) return null;
  return list.find((s) => norm(s.name) === n) ?? list.find((s) => norm(s.name).split(" ").includes(n.split(" ")[0]!)) ?? null;
}

/** Valida e descreve cada ação. Em modo real aplica no banco. */
function makeExec(opts: {
  live: boolean; db: SupabaseClient; orgId: string; leadId: string | null; conversationId: string | null; agent: AgentRow;
  stages: { id: string; name: string }[]; sellers: { id: string; name: string }[]; leadSeller: string | null; existingTags: string[];
  effects: Effect[];
}) {
  const { live, db, orgId, leadId, effects } = opts;
  return async (name: string, args: Record<string, unknown>): Promise<string> => {
    try {
      switch (name) {
        case "adicionar_tag": {
          let tag = cleanTag(args.nome);
          if (!tag) return "erro: nome vazio";
          const existing = opts.existingTags.find((t) => norm(t) === norm(tag));
          if (existing) tag = existing;
          else if (!opts.agent.auto_tags) return "erro: só é permitido usar tags que já existem";
          if (live && leadId) {
            let { data: t } = await db.from("tags").select("id, name").eq("organization_id", orgId).ilike("name", tag.replace(/[%_]/g, "\\$&")).maybeSingle();
            if (!t) {
              const ins = await db.from("tags").insert({ organization_id: orgId, name: tag }).select("id, name").single();
              t = ins.data ?? (await db.from("tags").select("id, name").eq("organization_id", orgId).ilike("name", tag).maybeSingle()).data;
            }
            if (!t) return "erro ao criar a tag";
            await db.from("lead_tags").upsert({ lead_id: leadId, tag_id: t.id, organization_id: orgId }, { onConflict: "lead_id,tag_id", ignoreDuplicates: true });
            tag = t.name;
          }
          if (!opts.existingTags.some((t) => norm(t) === norm(tag))) opts.existingTags.push(tag);
          effects.push({ kind: "tag_add", name: tag });
          return `ok: tag "${tag}" no cliente`;
        }
        case "remover_tag": {
          const tag = opts.existingTags.find((t) => norm(t) === norm(cleanTag(args.nome)));
          if (!tag) return "o cliente não tem essa tag";
          if (live && leadId) {
            const { data: t } = await db.from("tags").select("id").eq("organization_id", orgId).ilike("name", tag).maybeSingle();
            if (t) await db.from("lead_tags").delete().eq("lead_id", leadId).eq("tag_id", t.id);
          }
          opts.existingTags.splice(opts.existingTags.indexOf(tag), 1);
          effects.push({ kind: "tag_remove", name: tag });
          return "ok";
        }
        case "salvar_memoria": {
          const facts = (Array.isArray(args.fatos) ? args.fatos : [args.fatos]).map((f) => String(f ?? "").trim().slice(0, 500)).filter(Boolean).slice(0, 15);
          if (!facts.length) return "nada para salvar";
          if (live && leadId) {
            for (const fact of facts) {
              await db.from("ai_lead_memory").insert({ organization_id: orgId, lead_id: leadId, fact, source: "ai" }).then(() => undefined, () => undefined);
            }
          }
          effects.push({ kind: "memory", facts });
          return "ok: guardado";
        }
        case "atualizar_resumo": {
          const text = String(args.resumo ?? "").trim().slice(0, 4000);
          if (!text) return "resumo vazio";
          if (live && leadId) await db.from("leads").update({ ai_summary: text, ai_summary_at: new Date().toISOString() }).eq("id", leadId);
          effects.push({ kind: "summary", text });
          return "ok";
        }
        case "mover_etapa": {
          const st = pickStage(opts.stages, args.etapa);
          if (!st) return `etapa não encontrada. Etapas: ${opts.stages.map((s) => s.name).join(", ")}`;
          if (live && leadId) {
            const { data: top } = await db.from("leads").select("position").eq("stage_id", st.id).order("position").limit(1).maybeSingle();
            const { error } = await db.from("leads").update({ stage_id: st.id, position: (top?.position ?? 0) - 1024 }).eq("id", leadId);
            if (error) return `erro: ${error.message}`;
          }
          effects.push({ kind: "stage", name: st.name });
          return `ok: movido para ${st.name}`;
        }
        case "definir_valor": {
          const v = Number(args.valor);
          if (!Number.isFinite(v) || v < 0 || v > 1e10) return "valor inválido";
          if (live && leadId) await db.from("leads").update({ value: Math.round(v * 100) / 100 }).eq("id", leadId);
          effects.push({ kind: "value", value: v });
          return "ok";
        }
        case "agendar": {
          const start = zonedToUtc(`${String(args.data ?? "")}T${String(args.hora ?? "")}`, opts.agent.time_zone);
          if (!start) return "data ou hora inválida (use AAAA-MM-DD e HH:MM)";
          if (start.getTime() < Date.now()) return "esse horário já passou";
          const minutes = Math.min(Math.max(Number(args.duracao_minutos) || 60, 15), 480);
          const title = String(args.assunto ?? "Atendimento").slice(0, 200);
          if (live && leadId) {
            const userId = opts.leadSeller ?? opts.sellers[0]?.id;
            if (!userId) return "não há vendedor para agendar; transfira para um vendedor";
            await createAppointment(db, { orgId, userId }, {
              leadId, start, end: new Date(start.getTime() + minutes * 60_000), timeZone: opts.agent.time_zone,
              title, notes: "Agendado pela IA no WhatsApp", moveToScheduleStage: true,
            });
          }
          effects.push({ kind: "appointment", when: `${args.data} ${args.hora}`, title });
          return "ok: agendado";
        }
        case "transferir_para_vendedor": {
          const reason = String(args.motivo ?? "").slice(0, 300);
          const seller = pickSeller(opts.sellers, args.vendedor);
          if (live) {
            if (opts.conversationId) await db.from("conversations").update({ ai_state: "paused", ai_paused_until: null }).eq("id", opts.conversationId);
            if (leadId) {
              if (seller) await db.from("leads").update({ assigned_to: seller.id }).eq("id", leadId);
              await db.from("activities").insert({ organization_id: orgId, lead_id: leadId, actor_id: null, type: "ai_handoff", payload: { reason, seller: seller?.name ?? null } });
            }
          }
          effects.push({ kind: "handoff", reason, seller: seller?.name ?? null });
          return "ok: transferido. Avise o cliente que um vendedor vai continuar o atendimento.";
        }
      }
      return "ferramenta desconhecida";
    } catch (e) {
      return `erro: ${(e as Error).message?.slice(0, 200) ?? "falha"}`;
    }
  };
}

async function teamOf(db: SupabaseClient, orgId: string) {
  const { data } = await db.from("organization_members").select("user_id, role, profiles(full_name)").eq("organization_id", orgId);
  type R = { user_id: string; role: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null };
  return ((data ?? []) as R[]).map((m) => {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return { id: m.user_id, name: p?.full_name?.trim() || "Sem nome", role: m.role };
  }).sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : 0));
}

async function stagesOf(db: SupabaseClient, orgId: string, pipelineId: string | null) {
  let q = db.from("stages").select("id, name, position, pipeline_id").eq("organization_id", orgId).order("position");
  if (pipelineId) q = q.eq("pipeline_id", pipelineId);
  const { data } = await q;
  const rows = data ?? [];
  const pid = pipelineId ?? rows[0]?.pipeline_id;
  return rows.filter((s) => s.pipeline_id === pid).map((s) => ({ id: s.id, name: s.name }));
}

// ---------------------------------------------------------------------------------------------
// Mensagens da conversa → histórico para a IA
// ---------------------------------------------------------------------------------------------

type MsgRow = { id: string; direction: "in" | "out"; type: string; body: string | null; transcript: string | null; media_ref: string | null; media_mime: string | null; deleted_at: string | null; sent_at: string; by_ai: boolean; channel_id: string };

function msgText(m: MsgRow): string {
  if (m.deleted_at) return "";
  if (m.type === "text") return m.body ?? "";
  if (m.type === "audio") return m.transcript ? `[áudio] ${m.transcript}` : "[mandou um áudio que não deu para ouvir]";
  const label: Record<string, string> = { image: "foto", video: "vídeo", document: "documento", sticker: "figurinha", location: "localização", contact: "contato" };
  return `[${label[m.type] ?? "anexo"}]${m.body ? ` ${m.body}` : ""}`;
}

async function downloadMedia(channelId: string, ref: string, mime: string | null): Promise<Blob | null> {
  const ch = await loadChannel(channelId);
  if (ch.provider === "zapi") {
    const u = new URL(ref);
    if (u.protocol !== "https:") return null;
    const res = await fetch(u, { signal: AbortSignal.timeout(30_000) });
    return res.ok ? await res.blob() : null;
  }
  if (ch.provider === "meta") {
    const r = await meta.downloadMedia(ref, ch.secrets.meta_access_token!);
    return new Blob([r.data], { type: r.mime || mime || "audio/ogg" });
  }
  const r = await evo.getMediaBase64(ch.evolution_instance!, ref);
  return r.base64 ? new Blob([Buffer.from(r.base64, "base64")], { type: r.mimetype || mime || "audio/ogg" }) : null;
}

/** Transcreve os áudios recentes do cliente que ainda não têm texto. */
async function transcribeRecent(db: SupabaseClient, msgs: MsgRow[]) {
  if (!envOptional("GROQ_API_KEY") && !envOptional("OPENAI_API_KEY")) return;
  const todo = msgs.filter((m) => m.direction === "in" && m.type === "audio" && !m.transcript && m.media_ref && !m.deleted_at).slice(-3);
  for (const m of todo) {
    try {
      const blob = await downloadMedia(m.channel_id, m.media_ref!, m.media_mime);
      if (!blob || blob.size > 20 * 1024 * 1024) continue;
      const text = (await transcribe(blob, "audio.ogg")).slice(0, 8000);
      if (text) { m.transcript = text; await db.from("messages").update({ transcript: text }).eq("id", m.id); }
    } catch (e) { console.error("[ia] transcrição", (e as Error).message); }
  }
}

function toHistory(msgs: MsgRow[]): ChatTurn[] {
  return msgs.map((m) => ({ role: m.direction === "in" ? "user" as const : "assistant" as const, text: msgText(m) })).filter((t) => t.text.trim());
}

/** Quebra a resposta em até 3 mensagens e tira formatação que o WhatsApp não mostra bem. */
export function splitReply(text: string): string[] {
  const clean = text.replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/^#+\s*/gm, "").trim();
  const parts = clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 3) return parts;
  return [...parts.slice(0, 2), parts.slice(2).join("\n\n")];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// Atendimento real
// ---------------------------------------------------------------------------------------------

/**
 * Chamado depois que chega mensagem do cliente. Espera alguns segundos (o cliente costuma mandar
 * várias seguidas), confere se a IA deve responder e responde uma vez só.
 */
export async function respondToConversation(conversationId: string, triggerMessageId: string) {
  const db = supabaseAdmin();
  const { data: conv } = await db.from("conversations").select("id, organization_id, channel_id, lead_id, created_at, ai_state, ai_paused_until").eq("id", conversationId).maybeSingle();
  if (!conv) return;
  const agent = await loadAgent(conv.organization_id);
  if (!agent?.enabled) return;
  if (agent.channel_ids?.length && !agent.channel_ids.includes(conv.channel_id)) return;
  if (agent.start_mode === "new_leads" && agent.enabled_at && conv.created_at < agent.enabled_at) return;
  if (conv.ai_state === "off") return;
  if (conv.ai_state === "paused") {
    if (!conv.ai_paused_until || new Date(conv.ai_paused_until) > new Date()) return;
    await db.from("conversations").update({ ai_state: "auto", ai_paused_until: null }).eq("id", conv.id);
  }

  await sleep(agent.reply_delay_seconds * 1000);

  // Só a última mensagem do cliente dispara; se alguém da equipe respondeu, a IA não entra
  const { data: last } = await db.from("messages").select("id, direction, by_ai").eq("conversation_id", conv.id).order("sent_at", { ascending: false }).limit(1).maybeSingle();
  if (!last || last.id !== triggerMessageId) return;
  const { data: fresh } = await db.from("conversations").select("ai_state").eq("id", conv.id).maybeSingle();
  if (fresh?.ai_state !== "auto") return;

  const { data: locked } = await db.rpc("ai_try_lock", { p_conv: conv.id, p_seconds: 120 });
  if (!locked) return;

  const started = Date.now();
  const model = agent.model || defaultModel(agent.provider);
  let calls: ToolCall[] = [];
  try {
    const key = await apiKeyFor(conv.organization_id, agent.provider);
    if (!key) throw new HttpError(409, `Falta a chave da IA (${agent.provider}). Cadastre em Agente de IA → Configuração.`);

    const [{ data: org }, { data: lead }, team, msgsRes] = await Promise.all([
      db.from("organizations").select("name").eq("id", conv.organization_id).single(),
      conv.lead_id ? db.from("leads").select("id, name, phone, value, pipeline_id, stage_id, assigned_to, ai_summary, stages(name), lead_tags(tags(name))").eq("id", conv.lead_id).maybeSingle() : Promise.resolve({ data: null }),
      teamOf(db, conv.organization_id),
      db.from("messages").select("id, direction, type, body, transcript, media_ref, media_mime, deleted_at, sent_at, by_ai, channel_id").eq("conversation_id", conv.id).order("sent_at", { ascending: false }).limit(40),
    ]);
    const msgs = ((msgsRes.data ?? []) as MsgRow[]).reverse();
    if (agent.transcribe_audio) await transcribeRecent(db, msgs);

    type L = { id: string; name: string; phone: string | null; value: number; pipeline_id: string; assigned_to: string | null; ai_summary: string | null; stages: { name: string } | { name: string }[] | null; lead_tags: { tags: { name: string } | { name: string }[] | null }[] };
    const l = lead as L | null;
    const stageName = l ? (Array.isArray(l.stages) ? l.stages[0]?.name : l.stages?.name) ?? null : null;
    const tags = (l?.lead_tags ?? []).map((x) => (Array.isArray(x.tags) ? x.tags[0]?.name : x.tags?.name)).filter((x): x is string => Boolean(x));
    const { data: mem } = l ? await db.from("ai_lead_memory").select("fact").eq("lead_id", l.id).order("created_at").limit(150) : { data: [] };
    const stages = await stagesOf(db, conv.organization_id, l?.pipeline_id ?? null);
    const seller = l?.assigned_to ? team.find((t) => t.id === l.assigned_to)?.name ?? null : null;

    const ctx: LeadCtx = {
      name: l?.name ?? "Cliente", phone: l?.phone ?? null, stage: stageName, stages: stages.map((s) => s.name), tags,
      value: Number(l?.value ?? 0), memory: (mem ?? []).map((m) => m.fact), summary: l?.ai_summary ?? null, seller,
    };
    const effects: Effect[] = [];
    const exec = makeExec({ live: true, db, orgId: conv.organization_id, leadId: l?.id ?? null, conversationId: conv.id, agent, stages, sellers: team, leadSeller: l?.assigned_to ?? null, existingTags: [...tags], effects });
    const out = await runWithTools({
      provider: agent.provider, model, apiKey: key, system: systemPrompt(agent, org?.name ?? "", ctx, team.map((t) => t.name)),
      history: toHistory(msgs), tools: TOOLS, exec,
    });
    calls = out.calls;

    const parts = splitReply(out.text);
    for (let i = 0; i < parts.length; i++) {
      if (i) await sleep(1200);
      await sendAiText(conv.organization_id, conv.id, parts[i]!.slice(0, 4000));
    }
    await db.from("ai_runs").insert({ organization_id: conv.organization_id, conversation_id: conv.id, lead_id: l?.id ?? null, provider: agent.provider, model, status: "ok", reply: out.text.slice(0, 8000), tools: calls, ms: Date.now() - started });
  } catch (e) {
    console.error("[ia] resposta", e);
    await db.from("ai_runs").insert({ organization_id: conv.organization_id, conversation_id: conv.id, lead_id: conv.lead_id, provider: agent.provider, model, status: "error", tools: calls, error: (e as Error).message?.slice(0, 1000), ms: Date.now() - started });
  } finally {
    await db.from("conversations").update({ ai_lock_until: null, ai_last_run_at: new Date().toISOString() }).eq("id", conv.id);
  }
}

// ---------------------------------------------------------------------------------------------
// Teste (simulador): mesma IA, mesmo prompt, sem enviar nada e sem mudar o CRM
// ---------------------------------------------------------------------------------------------

export interface TestInput {
  agent: Pick<AgentRow, "name" | "prompt" | "provider" | "model" | "auto_tags" | "time_zone" | "tone">;
  history: ChatTurn[];
  lead: { name: string; tags: string[]; memory: string[]; summary: string | null; stage: string | null; value: number };
}

export async function testAgent(orgId: string, i: TestInput) {
  const db = supabaseAdmin();
  const key = await apiKeyFor(orgId, i.agent.provider);
  if (!key) throw new HttpError(409, `Falta a chave da IA ${i.agent.provider === "gemini" ? "Gemini" : i.agent.provider === "groq" ? "Groq" : "Claude"}. Cadastre na aba Configuração.`);
  const [{ data: org }, team, stages, { data: allTags }] = await Promise.all([
    db.from("organizations").select("name").eq("id", orgId).single(),
    teamOf(db, orgId),
    stagesOf(db, orgId, null),
    db.from("tags").select("name").eq("organization_id", orgId),
  ]);
  const agent = { ...AGENT_DEFAULTS, ...i.agent, id: "", organization_id: orgId } as AgentRow;
  const effects: Effect[] = [];
  const knownTags = [...new Set([...(allTags ?? []).map((t) => t.name), ...i.lead.tags])];
  const exec = makeExec({ live: false, db, orgId, leadId: null, conversationId: null, agent, stages, sellers: team, leadSeller: null, existingTags: knownTags, effects });
  const ctx: LeadCtx = { name: i.lead.name, phone: null, stage: i.lead.stage ?? stages[0]?.name ?? null, stages: stages.map((s) => s.name), tags: i.lead.tags, value: i.lead.value, memory: i.lead.memory, summary: i.lead.summary, seller: null };
  const model = agent.model || defaultModel(agent.provider);
  const started = Date.now();
  const out = await runWithTools({ provider: agent.provider, model, apiKey: key, system: systemPrompt(agent, org?.name ?? "", ctx, team.map((t) => t.name)), history: i.history, tools: TOOLS, exec });
  return { messages: splitReply(out.text), effects, calls: out.calls, model, ms: Date.now() - started };
}
