import "server-only";
import { createHmac } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendText } from "@/lib/send";
import { loadChannel, sendTextVia } from "@/lib/whatsapp";
import { cronSecret } from "@/lib/cron";
import { postPinned, publicTarget } from "@/lib/net/safe-post";
import { norm } from "@/lib/utils";
import { matchesKeywords, portsOf, renderVars, Step, Trigger, TRIGGER_NODE, waitMs, type AutomationBody, type Graph } from "./schema";
import { apiKeyFor, loadAgent } from "@/lib/ai/agent";
import { defaultModel, runWithTools } from "@/lib/ai/llm";
import { checkReply, rulesPrompt, stripEmojis } from "@/lib/ai/rules";

// Motor das automações: lê a fila de acontecimentos, cria as execuções e roda os passos.
// Chamado a cada minuto pelo cron (e logo depois de mensagens recebidas).

type Auto = AutomationBody & { id: string; organization_id: string; state: { rr?: number }; graph?: Graph | null };
type Run = { id: number; organization_id: string; automation_id: string; lead_id: string | null; status: string; step_index: number; log: LogItem[]; created_at: string; node_id: string | null; reply_node: string | null; waiting_for: string | null };
type LogItem = { at: string; step: number; type: string; ok: boolean; info?: string; node?: string };

/** Bloco ligado na saída `port` do bloco `from` (null = fim do fluxo). */
const nextOf = (g: Graph, from: string, port: string) => g.edges.find((e) => e.from === from && e.port === port)?.to ?? null;

const db = () => supabaseAdmin();
const now = () => new Date().toISOString();

async function enabledAutos(orgId: string): Promise<Auto[]> {
  const { data } = await db().from("automations").select("*").eq("organization_id", orgId).eq("enabled", true);
  return ((data ?? []) as Auto[]).filter((a) => Trigger.safeParse(a.trigger).success);
}

async function stageKind(stageId: string): Promise<string | null> {
  const { data } = await db().from("stages").select("kind").eq("id", stageId).maybeSingle();
  return data?.kind ?? null;
}

function matches(t: Trigger, ev: { type: string; data: Record<string, unknown> }, kind: string | null, source: string | null): boolean {
  switch (t.type) {
    case "lead_created": return ev.type === "lead_created" && (!t.source || norm(source ?? "").includes(norm(t.source)));
    case "stage_changed": return ev.type === "stage_changed" && (!t.stage_id || ev.data.to === t.stage_id);
    case "won": return ev.type === "stage_changed" && kind === "won";
    case "lost": return ev.type === "stage_changed" && kind === "lost";
    case "tag_added": return ev.type === "tag_added" && ev.data.tag_id === t.tag_id;
    case "message_received": return ev.type === "message_received" && matchesKeywords(String(ev.data.text ?? ""), t.keywords);
    default: return false;
  }
}

/** Máximo de execuções da mesma automação para o mesmo lead em 24h (trava contra loop entre automações). */
const MAX_RUNS_PER_DAY = 5;

async function insertRun(a: Auto, leadId: string) {
  // Fluxo em canvas: começa no bloco ligado ao gatilho (sem nada ligado, não roda)
  const start = a.graph ? nextOf(a.graph, TRIGGER_NODE, "out") : null;
  if (a.graph && !start) return false;
  // O índice único do banco impede duas execuções ativas da mesma automação no mesmo lead
  const { error } = await db().from("automation_runs").insert({ organization_id: a.organization_id, automation_id: a.id, lead_id: leadId, status: "running", resume_at: now(), node_id: start });
  if (error && error.code !== "23505") throw error;
  return !error;
}

async function startRun(a: Auto, leadId: string) {
  const { count } = await db().from("automation_runs").select("id", { count: "exact", head: true }).eq("automation_id", a.id).eq("lead_id", leadId)
    .gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
  if ((count ?? 0) >= MAX_RUNS_PER_DAY) return;
  if (a.once_per_lead) {
    const { data } = await db().from("automation_runs").select("id").eq("automation_id", a.id).eq("lead_id", leadId).limit(1).maybeSingle();
    if (data) return;
  } else {
    // Não deixa a mesma automação rodar em paralelo para o mesmo lead
    const { data } = await db().from("automation_runs").select("id").eq("automation_id", a.id).eq("lead_id", leadId).in("status", ["running", "processing", "waiting"]).limit(1).maybeSingle();
    if (data) return;
  }
  await insertRun(a, leadId);
}

/** Acontecimentos novos → execuções. */
async function drainEvents(limit = 300) {
  // Pega os acontecimentos de forma exclusiva: duas execuções ao mesmo tempo nunca pegam o mesmo
  const { data, error } = await db().rpc("automation_claim_events", { p_limit: limit });
  if (error) throw error;
  const evs = (data ?? []) as { id: number; organization_id: string; lead_id: string | null; type: string; data: Record<string, unknown> }[];
  if (!evs.length) return 0;
  const cache = new Map<string, Auto[]>();
  for (const ev of evs) {
    if (!ev.lead_id) continue;
    let autos = cache.get(ev.organization_id);
    if (!autos) { autos = await enabledAutos(ev.organization_id); cache.set(ev.organization_id, autos); }
    if (ev.type === "message_received") {
      // Bloco "Esperar o cliente responder": segue pela saída "Respondeu"
      const { data: waiters } = await db().from("automation_runs").select("id, reply_node").eq("lead_id", ev.lead_id).eq("status", "waiting").eq("waiting_for", "reply");
      for (const w of waiters ?? []) {
        await db().from("automation_runs").update(w.reply_node
          ? { status: "running", node_id: w.reply_node, waiting_for: null, reply_node: null, resume_at: now(), updated_at: now() }
          : { status: "done", waiting_for: null, reply_node: null, resume_at: null, updated_at: now() })
          .eq("id", w.id).eq("status", "waiting");
      }
      // Cliente respondeu: para os follow-ups que esperavam resposta (menos quem já trata a resposta no fluxo)
      const stopIds = autos.filter((a) => a.stop_on_reply).map((a) => a.id);
      if (stopIds.length) {
        await db().from("automation_runs").update({ status: "stopped", error: "Cliente respondeu", updated_at: now() })
          .eq("lead_id", ev.lead_id).in("automation_id", stopIds).in("status", ["waiting", "running"]).is("waiting_for", null);
      }
    }
    const kind = ev.type === "stage_changed" && ev.data?.to ? await stageKind(String(ev.data.to)) : null;
    for (const a of autos) {
      if (matches(a.trigger, ev, kind, (ev.data?.source as string | null) ?? null)) await startRun(a, ev.lead_id);
    }
  }
  return evs.length;
}

/** Gatilho "lead parado": procura leads sem mensagem e sem mudar de etapa há X dias. */
async function scanIdle() {
  const { data } = await db().from("automations").select("*").eq("enabled", true).filter("trigger->>type", "eq", "idle");
  for (const a of (data ?? []) as Auto[]) {
    const t = a.trigger as Extract<Trigger, { type: "idle" }>;
    const cutoff = new Date(Date.now() - t.days * 86_400_000).toISOString();
    const { data: open } = await db().from("stages").select("id").eq("organization_id", a.organization_id).eq("kind", "open");
    const openIds = (open ?? []).map((s) => s.id).filter((sid) => !t.stage_id || sid === t.stage_id);
    if (!openIds.length) continue;
    const { data: leads } = await db().from("leads").select("id, stage_changed_at").eq("organization_id", a.organization_id).in("stage_id", openIds)
      .lt("stage_changed_at", cutoff).or(`last_message_at.is.null,last_message_at.lt.${cutoff}`).order("stage_changed_at", { ascending: false }).limit(1000);
    // Última execução de cada lead numa consulta só (sem uma consulta por lead)
    const ids = (leads ?? []).map((l) => l.id);
    const lastRun = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: runs } = await db().from("automation_runs").select("lead_id, created_at").eq("automation_id", a.id).in("lead_id", ids.slice(i, i + 200));
      for (const r of runs ?? []) if (!lastRun.has(r.lead_id) || r.created_at > lastRun.get(r.lead_id)!) lastRun.set(r.lead_id, r.created_at);
    }
    let started = 0;
    for (const l of leads ?? []) {
      if (started >= 40) break;
      // Uma vez por "parada": só dispara de novo se o lead se mexeu depois da última execução
      const last = lastRun.get(l.id);
      if (last && (a.once_per_lead || last > l.stage_changed_at)) continue;
      if (await insertRun(a, l.id)) started++;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Execução dos passos
// ---------------------------------------------------------------------------------------------

type LeadRow = { id: string; organization_id: string; name: string; phone: string | null; value: number; source: string | null; stage_id: string; pipeline_id: string; assigned_to: string | null; last_message_preview: string | null; last_message_dir: string | null };

async function leadCtx(leadId: string) {
  const { data: l } = await db().from("leads").select("id, organization_id, name, phone, value, source, stage_id, pipeline_id, assigned_to, last_message_preview, last_message_dir").eq("id", leadId).maybeSingle();
  if (!l) return null;
  const lead = l as LeadRow;
  const [{ data: st }, { data: org }, { data: seller }, { data: tags }] = await Promise.all([
    db().from("stages").select("name").eq("id", lead.stage_id).maybeSingle(),
    db().from("organizations").select("name").eq("id", lead.organization_id).maybeSingle(),
    lead.assigned_to ? db().from("profiles").select("full_name").eq("id", lead.assigned_to).maybeSingle() : Promise.resolve({ data: null }),
    db().from("lead_tags").select("tag_id").eq("lead_id", lead.id),
  ]);
  return { lead, stage: st?.name ?? null, org: org?.name ?? "", seller: (seller as { full_name: string | null } | null)?.full_name ?? null, tagIds: new Set((tags ?? []).map((t) => t.tag_id as string)) };
}

/** Quanto falta para o próximo horário comercial (0 = já está). */
function msUntilBusiness(from = new Date()) {
  if (inBusinessHours(from)) return 0;
  const t = new Date(from);
  t.setUTCMinutes(Math.ceil(t.getUTCMinutes() / 15) * 15, 0, 0);
  for (let i = 0; i < 4 * 24 * 8; i++) {
    if (inBusinessHours(t)) return t.getTime() - from.getTime();
    t.setTime(t.getTime() + 15 * 60_000);
  }
  return 0;
}

function inBusinessHours(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const wd = p.find((x) => x.type === "weekday")?.value;
  const h = Number(p.find((x) => x.type === "hour")?.value);
  return wd !== "Sun" && h >= 8 && h < 18;
}

async function clientRepliedSince(leadId: string, since: string) {
  const { data } = await db().from("messages").select("id, conversations!inner(lead_id)").eq("conversations.lead_id", leadId).eq("direction", "in").gt("sent_at", since).limit(1).maybeSingle();
  return Boolean(data);
}

/** Chave para o n8n conferir que a chamada veio do CRM (mostrada no editor da automação). */
export function webhookSecret(automationId: string) {
  return createHmac("sha256", `${cronSecret()}:webhook`).update(automationId).digest("hex").slice(0, 32);
}

async function runStep(a: Auto, step: Step, c: NonNullable<Awaited<ReturnType<typeof leadCtx>>>, run: Run): Promise<{ ok: boolean; info?: string; wait?: number; stop?: boolean }> {
  const { lead } = c;
  const vars = { name: lead.name, phone: lead.phone, stage: c.stage, value: Number(lead.value) || 0, seller: c.seller, org: c.org };
  switch (step.type) {
    case "send_message": {
      // "Parar se o cliente responder": confere de novo logo antes de enviar
      if (a.stop_on_reply && (await clientRepliedSince(lead.id, run.created_at))) return { ok: true, stop: true, info: "cliente respondeu — parou aqui" };
      const text = renderVars(step.text, vars);
      await sendText(db(), lead.organization_id, null, { leadId: lead.id }, text, { automation: true });
      return { ok: true, info: text.slice(0, 120) };
    }
    case "notify": {
      const { data: ch } = await db().from("whatsapp_channels").select("id").eq("organization_id", lead.organization_id).eq("status", "connected").order("created_at").limit(1).maybeSingle();
      if (!ch) return { ok: false, info: "Nenhum WhatsApp conectado" };
      await sendTextVia(await loadChannel(ch.id), step.phone, renderVars(step.text, vars));
      return { ok: true, info: `aviso para ${step.phone}` };
    }
    case "wait": return { ok: true, wait: waitMs(step), info: `${step.amount} ${step.unit === "minutes" ? "min" : step.unit === "hours" ? "h" : "dia(s)"}` };
    case "move_stage": {
      if (lead.stage_id === step.stage_id) return { ok: true, info: "já estava na etapa" };
      const { data: st } = await db().from("stages").select("id, name, pipeline_id").eq("id", step.stage_id).eq("organization_id", lead.organization_id).maybeSingle();
      if (!st) return { ok: false, info: "Etapa não existe mais" };
      const { data: top } = await db().from("leads").select("position").eq("stage_id", st.id).order("position").limit(1).maybeSingle();
      const { error } = await db().from("leads").update({ stage_id: st.id, pipeline_id: st.pipeline_id, position: (top?.position ?? 0) - 1024 }).eq("id", lead.id);
      if (error) return { ok: false, info: error.message };
      lead.stage_id = st.id; c.stage = st.name;
      return { ok: true, info: `→ ${st.name}` };
    }
    case "add_tag": {
      const { data: t } = await db().from("tags").select("id, name").eq("id", step.tag_id).eq("organization_id", lead.organization_id).maybeSingle();
      if (!t) return { ok: false, info: "Tag não existe mais" };
      await db().from("lead_tags").upsert({ lead_id: lead.id, tag_id: t.id, organization_id: lead.organization_id }, { onConflict: "lead_id,tag_id", ignoreDuplicates: true });
      c.tagIds.add(t.id);
      return { ok: true, info: t.name };
    }
    case "remove_tag": {
      await db().from("lead_tags").delete().eq("lead_id", lead.id).eq("tag_id", step.tag_id);
      c.tagIds.delete(step.tag_id);
      return { ok: true };
    }
    case "assign": {
      const { data: members } = await db().from("organization_members").select("user_id").eq("organization_id", lead.organization_id).in("user_id", step.user_ids);
      const valid = step.user_ids.filter((u) => (members ?? []).some((m) => m.user_id === u));
      if (!valid.length) return { ok: false, info: "Nenhum vendedor válido" };
      let pick = valid[0]!;
      if (step.mode === "round_robin") {
        const i = (a.state?.rr ?? 0) % valid.length;
        pick = valid[i]!;
        a.state = { ...a.state, rr: i + 1 };
        await db().from("automations").update({ state: a.state }).eq("id", a.id);
      }
      await db().from("leads").update({ assigned_to: pick }).eq("id", lead.id);
      const { data: p } = await db().from("profiles").select("full_name").eq("id", pick).maybeSingle();
      lead.assigned_to = pick; c.seller = p?.full_name ?? null;
      return { ok: true, info: p?.full_name ?? "vendedor" };
    }
    case "set_value": {
      await db().from("leads").update({ value: step.value }).eq("id", lead.id);
      lead.value = step.value;
      return { ok: true, info: String(step.value) };
    }
    case "add_note": {
      await db().from("activities").insert({ organization_id: lead.organization_id, lead_id: lead.id, actor_id: null, type: "note", payload: { text: renderVars(step.text, vars), via: "automação" } });
      return { ok: true };
    }
    case "condition": {
      const v = step.value ?? "";
      const pass = (() => {
        switch (step.field) {
          case "stage": return lead.stage_id === v;
          case "tag": return c.tagIds.has(v);
          case "no_tag": return !c.tagIds.has(v);
          case "value_gte": return Number(lead.value) >= Number(v);
          case "value_lte": return Number(lead.value) <= Number(v);
          case "source": return norm(lead.source ?? "").includes(norm(v));
          case "assigned": return lead.assigned_to === v;
          case "unassigned": return !lead.assigned_to;
          case "business_hours": return inBusinessHours();
          case "last_message_contains": return lead.last_message_dir === "in" && matchesKeywords(lead.last_message_preview ?? "", v.split(",").map((x) => x.trim()).filter(Boolean));
        }
      })();
      return pass ? { ok: true, info: "condição atendida" } : { ok: true, stop: true, info: "condição não atendida — parou aqui" };
    }
    case "webhook": {
      const payload = {
        evento: a.name, automacao_id: a.id, quando: now(),
        lead: { id: lead.id, nome: lead.name, telefone: lead.phone, valor: Number(lead.value) || 0, etapa: c.stage, origem: lead.source, responsavel: c.seller, tags: [...c.tagIds] },
        empresa: c.org,
      };
      const body = JSON.stringify(payload);
      // Assinatura para o n8n conferir que veio do CRM
      const sig = createHmac("sha256", webhookSecret(a.id)).update(body).digest("hex");
      const status = await postPinned(await publicTarget(step.url), body, { "content-type": "application/json", "x-nexo-signature": sig, "user-agent": "NexoCRM-Automacoes" });
      return status >= 200 && status < 300 ? { ok: true, info: `HTTP ${status}` } : { ok: false, info: `HTTP ${status}` };
    }
    case "ai": {
      const { data: convs } = await db().from("conversations").select("id").eq("lead_id", lead.id);
      const state = step.mode === "resume" ? "auto" : step.mode === "pause" ? "paused" : "off";
      for (const cv of convs ?? []) await db().from("conversations").update({ ai_state: state, ai_paused_until: null }).eq("id", cv.id);
      return { ok: true, info: state };
    }
    // Estes três são tratados pelo executor do fluxo (saídas e espera)
    case "wait_reply": return { ok: true, wait: waitMs(step), info: `até ${step.amount} ${step.unit === "minutes" ? "min" : step.unit === "hours" ? "h" : "dia(s)"}` };
    case "split": return { ok: true };
    case "wait_business": {
      const ms = msUntilBusiness();
      return ms ? { ok: true, wait: ms, info: "fora do horário — espera até abrir" } : { ok: true, info: "já em horário comercial" };
    }
    case "ai_message": {
      const text = await aiWrite(lead, c.org, step.instruction, vars);
      if (!text.ok) return { ok: false, info: text.info };
      await sendText(db(), lead.organization_id, null, { leadId: lead.id }, text.text, { automation: true });
      return { ok: true, info: text.text.slice(0, 120) };
    }
  }
}

/** IA escreve uma mensagem curta para o cliente, com o contexto da conversa e as regras do agente. */
async function aiWrite(lead: LeadRow, org: string, instruction: string, vars: Parameters<typeof renderVars>[1]): Promise<{ ok: true; text: string } | { ok: false; info: string }> {
  const agent = await loadAgent(lead.organization_id);
  const provider = agent?.provider ?? "claude";
  const key = await apiKeyFor(lead.organization_id, provider);
  if (!key) return { ok: false, info: "Falta a chave da IA (Agente de IA → Configuração)" };
  const { data: convs } = await db().from("conversations").select("id").eq("lead_id", lead.id).limit(1);
  const convId = convs?.[0]?.id;
  const { data: msgs } = convId ? await db().from("messages").select("direction, body, type, transcript").eq("conversation_id", convId).order("sent_at", { ascending: false }).limit(20) : { data: [] };
  const history = (msgs ?? []).reverse().map((m) => ({ role: m.direction === "in" ? "user" as const : "assistant" as const, text: m.type === "text" ? m.body ?? "" : m.transcript ? `[áudio] ${m.transcript}` : `[${m.type}]` })).filter((h) => h.text.trim());
  const rules = agent?.rules;
  const system = [
    `Você é ${agent?.name ?? "o atendimento"} da empresa "${org}" no WhatsApp. Escreva UMA mensagem curta (1 a 3 frases) para o cliente ${vars.name}, em português do Brasil impecável.`,
    `O que a mensagem deve fazer: ${renderVars(instruction, vars)}`,
    agent?.prompt ? `\nInstruções da empresa:\n${agent.prompt.slice(0, 6000)}` : "",
    rules ? `\n${rulesPrompt(rules)}` : "",
    "\nResponda somente com o texto da mensagem, sem aspas e sem explicações. Não invente preços, condições ou prazos.",
  ].join("\n");
  const out = await runWithTools({ provider, model: agent?.model || defaultModel(provider), apiKey: key, system, history: history.length ? history : [{ role: "user", text: "(cliente ainda não escreveu)" }], tools: [], exec: async () => "", maxRounds: 1, deadline: Date.now() + 60_000, think: false });
  let text = out.text.trim().replace(/^["“]|["”]$/g, "");
  if (rules && !rules.emojis) text = stripEmojis(text);
  if (!text) return { ok: false, info: "A IA não escreveu nada" };
  if (rules) {
    const issues = checkReply(text, rules, history.filter((h) => h.role === "user").map((h) => h.text).join("\n"));
    if (issues.length) return { ok: false, info: `Filtro bloqueou: ${issues[0]}` };
  }
  return { ok: true, text: text.slice(0, 4000) };
}

/** Fluxo em canvas: anda de bloco em bloco seguindo as conexões (Sim/Não, A/B, Respondeu…). */
async function executeGraph(run: Run, auto: Auto & { graph: Graph }, c: NonNullable<Awaited<ReturnType<typeof leadCtx>>>, finish: (p: Record<string, unknown>) => PromiseLike<unknown>) {
  const g = auto.graph;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const idx = (id: string) => g.nodes.findIndex((n) => n.id === id);
  let nodeId = run.node_id;
  for (let guard = 0; nodeId && guard < 40; guard++) {
    const node = byId.get(nodeId);
    if (!node?.step) { nodeId = null; break; }
    const p = Step.safeParse(node.step);
    if (!p.success) { run.log.push({ at: now(), step: idx(nodeId), node: nodeId, type: "inválido", ok: false, info: "Bloco mal configurado" }); await finish({ status: "failed", node_id: nodeId, error: "Bloco mal configurado" }); return; }
    const step = p.data;
    let r: Awaited<ReturnType<typeof runStep>>;
    try { r = await runStep(auto, step, c, run); }
    catch (e) { r = { ok: false, info: (e as Error).message?.slice(0, 200) }; }
    // Saída do bloco
    let port = portsOf(step.type)[0]!.id;
    if (step.type === "condition") port = r.stop ? "no" : "yes";
    if (step.type === "split") { port = Math.random() * 100 < step.percent_a ? "a" : "b"; r.info = `caminho ${port.toUpperCase()}`; }
    run.log.push({ at: now(), step: idx(nodeId), node: nodeId, type: step.type, ok: r.ok, info: r.info });
    if (!r.ok) { await finish({ status: "failed", node_id: nodeId, error: r.info ?? "Falhou" }); return; }
    if (r.stop && step.type !== "condition") { await finish({ status: "done", node_id: null, error: null, resume_at: null }); return; }
    if (step.type === "wait_reply") {
      // Espera a resposta: se chegar, segue por "Respondeu"; se o tempo acabar, por "Não respondeu"
      await finish({ status: "waiting", waiting_for: "reply", node_id: nextOf(g, nodeId, "timeout"), reply_node: nextOf(g, nodeId, "replied"), resume_at: new Date(Date.now() + (r.wait ?? 0)).toISOString() });
      return;
    }
    const next = nextOf(g, nodeId, port);
    if (r.wait) { await finish({ status: "waiting", node_id: next, waiting_for: null, resume_at: new Date(Date.now() + r.wait).toISOString() }); return; }
    // Salva o progresso a cada bloco (se o servidor cair, não repete o que já foi feito)
    await db().from("automation_runs").update({ node_id: next, log: run.log.slice(-60), updated_at: now() }).eq("id", run.id);
    nodeId = next;
  }
  await finish({ status: "done", node_id: null, waiting_for: null, resume_at: null });
}

async function execute(run: Run) {
  const { data: a } = await db().from("automations").select("*").eq("id", run.automation_id).maybeSingle();
  const finish = (patch: Record<string, unknown>) => db().from("automation_runs").update({ ...patch, log: run.log.slice(-60), updated_at: now() }).eq("id", run.id);
  if (!a || !a.enabled) { await finish({ status: "stopped", error: "Automação desligada" }); return; }
  const auto = a as Auto;
  if (auto.graph) {
    const cg = run.lead_id ? await leadCtx(run.lead_id) : null;
    if (!cg) { await finish({ status: "stopped", error: "Lead apagado" }); return; }
    // Saiu da espera de resposta pelo tempo: limpa a marca
    if (run.waiting_for) { run.waiting_for = null; await db().from("automation_runs").update({ waiting_for: null, reply_node: null }).eq("id", run.id); }
    await executeGraph(run, auto as Auto & { graph: Graph }, cg, finish);
    return;
  }
  const parsed = (auto.steps as unknown[]).map((s) => Step.safeParse(s));
  const c = run.lead_id ? await leadCtx(run.lead_id) : null;
  if (!c) { await finish({ status: "stopped", error: "Lead apagado" }); return; }

  let i = run.step_index;
  for (let guard = 0; i < parsed.length && guard < 30; guard++) {
    const p = parsed[i]!;
    if (!p.success) { run.log.push({ at: now(), step: i, type: "inválido", ok: false, info: "Passo mal configurado" }); await finish({ status: "failed", step_index: i, error: "Passo mal configurado" }); return; }
    const step = p.data;
    let r: Awaited<ReturnType<typeof runStep>>;
    try { r = await runStep(auto, step, c, run); }
    catch (e) { r = { ok: false, info: (e as Error).message?.slice(0, 200) }; }
    run.log.push({ at: now(), step: i, type: step.type, ok: r.ok, info: r.info });
    if (!r.ok) { await finish({ status: "failed", step_index: i, error: r.info ?? "Falhou" }); return; }
    i++;
    if (r.stop) { await finish({ status: "done", step_index: i, error: null }); return; }
    if (r.wait) { await finish({ status: "waiting", step_index: i, resume_at: new Date(Date.now() + r.wait).toISOString() }); return; }
    // Salva o progresso a cada passo: se o servidor cair, não repete o que já foi feito (ex.: mensagem enviada)
    await db().from("automation_runs").update({ step_index: i, log: run.log.slice(-60), updated_at: now() }).eq("id", run.id);
  }
  await finish({ status: "done", step_index: i, resume_at: null });
}

/** Roda as execuções prontas (novas ou que terminaram de esperar). */
async function runDue(limit = 60) {
  const { data } = await db().from("automation_runs").select("id").in("status", ["running", "waiting"]).lte("resume_at", now()).order("resume_at").limit(limit);
  let n = 0;
  for (const r of data ?? []) {
    // Trava: só um processo pega cada execução
    const { data: claimed } = await db().from("automation_runs").update({ status: "processing", updated_at: now() }).eq("id", r.id).in("status", ["running", "waiting"]).select("*").maybeSingle();
    if (!claimed) continue;
    await execute(claimed as Run).catch(async (e) => {
      await db().from("automation_runs").update({ status: "failed", error: (e as Error).message?.slice(0, 300), updated_at: now() }).eq("id", r.id);
    });
    n++;
  }
  // Execuções que travaram no meio (ex.: servidor caiu) voltam para a fila
  await db().from("automation_runs").update({ status: "running" }).eq("status", "processing").lt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString());
  return n;
}

export async function processAutomations(opts: { idle?: boolean } = {}) {
  const events = await drainEvents();
  if (opts.idle) await scanIdle().catch((e) => console.error("[automações] parados", e));
  const runs = await runDue();
  return { events, runs };
}
