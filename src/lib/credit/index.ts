import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/http";
import { cronSecret } from "@/lib/cron";
import { postPinnedFull, publicTarget } from "@/lib/net/safe-post";
import { appUrl } from "@/lib/env";
import { sendAiText } from "@/lib/send";
import { loadChannel, sendTextVia } from "@/lib/whatsapp";
import {
  CREDIT_DEFAULTS, CreditInput, cpfDigits, decide, isCpf, maskCpf, overallFromBanks, parseBanks, scrubCpf, STATUS_LABEL, STATUS_TAG, wordStatus,
  type BankResult, type CreditProvider, type CreditSettings, type CreditStatus, type ProviderResult,
} from "./shared";

const db = () => supabaseAdmin();

export async function loadCreditSettings(orgId: string): Promise<CreditSettings> {
  const { data } = await db().from("credit_settings").select("*").eq("organization_id", orgId).maybeSingle();
  if (!data) return { ...CREDIT_DEFAULTS };
  return {
    enabled: data.enabled, provider: data.provider === "manual" ? "directd" : data.provider, banks: data.banks ?? [], webhook_url: data.webhook_url, min_score: data.min_score, review_score: data.review_score,
    max_income_pct: Number(data.max_income_pct), monthly_rate: Number(data.monthly_rate), handoff: data.handoff, max_per_day: data.max_per_day,
    notify_phone: data.notify_phone ?? null,
  };
}

/** Garante a linha de configuração (o endereço de retorno existe desde o primeiro acesso). */
export async function ensureCreditSettings(orgId: string) {
  await db().from("credit_settings").upsert({ organization_id: orgId }, { onConflict: "organization_id", ignoreDuplicates: true });
}

/** Endereço para a plataforma de bancos devolver o resultado depois. */
export async function creditCallbackUrl(orgId: string): Promise<string | null> {
  const { data } = await db().from("credit_settings").select("callback_token").eq("organization_id", orgId).maybeSingle();
  return data?.callback_token ? `${appUrl()}/api/credit/callback/${data.callback_token}` : null;
}

/** Gera um novo endereço de retorno (o antigo para de funcionar). */
export async function rotateCallback(orgId: string) {
  await ensureCreditSettings(orgId);
  await db().from("credit_settings").update({ callback_token: randomBytes(16).toString("hex"), updated_at: new Date().toISOString() }).eq("organization_id", orgId);
}

/** Chave da ferramenta — só devolve se foi cadastrada para esta mesma ferramenta. */
export async function creditCredential(orgId: string, provider?: CreditProvider): Promise<string | null> {
  const { data } = await db().from("credit_secrets").select("credential, provider").eq("organization_id", orgId).maybeSingle();
  if (!data) return null;
  if (provider && data.provider !== provider) return null;
  return data.credential;
}

export async function creditCredentialInfo(orgId: string) {
  const { data } = await db().from("credit_secrets").select("credential, provider").eq("organization_id", orgId).maybeSingle();
  return data ? { provider: data.provider as string, hint: `…${String(data.credential).slice(-4)}` } : null;
}

const cpfHash = (orgId: string, cpf: string) => createHmac("sha256", `${cronSecret()}:credito`).update(`${orgId}:${cpfDigits(cpf)}`).digest("hex");

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.round(n) : null;
};

const safeMsg = (m: unknown) => scrubCpf(String(m ?? "")).slice(0, 200);

// ---------------------------------------------------------------------------------------------
// Ferramentas de crédito
// ---------------------------------------------------------------------------------------------

/** Direct Data — Score (bureau). https://www.directd.com.br/central-de-ajuda/apis/catalogo/Score */
async function directd(cred: string, cpf: string): Promise<ProviderResult> {
  const u = new URL("https://apiv3.directd.com.br/api/Score");
  u.searchParams.set("CPF", cpfDigits(cpf));
  u.searchParams.set("TOKEN", cred);
  const res = await fetch(u, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  const data = (await res.json().catch(() => ({}))) as {
    metaDados?: { mensagem?: string; resultado?: string; resultadoId?: number };
    retorno?: { pessoaFisica?: { score?: unknown; faixaScore?: string; capacidadePagamento?: string; perfil?: string } | null; observacao?: string };
  };
  const pf = data.retorno?.pessoaFisica;
  if (!res.ok || !pf) {
    if (res.status === 401 || res.status === 403) throw new HttpError(502, "Direct Data: token inválido ou sem saldo");
    throw new HttpError(502, `Direct Data: ${safeMsg(data.metaDados?.mensagem || data.retorno?.observacao || `HTTP ${res.status}`)}`);
  }
  return {
    score: num(pf.score), band: pf.faixaScore?.slice(0, 60) ?? null, capacity: pf.capacidadePagamento?.slice(0, 80) ?? null, status: null,
    reasons: pf.perfil ? [`perfil: ${String(pf.perfil).slice(0, 80)}`] : [],
  };
}

async function postJson(url: string, cred: string | null, payload: Record<string, unknown>, label: string) {
  const target = await publicTarget(url);
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json", "user-agent": "NexoCRM-Credito" };
  if (cred) headers.authorization = `Bearer ${cred}`;
  const r = await postPinnedFull(target, JSON.stringify(payload), headers, { readBody: true, timeoutMs: 45_000 });
  if (r.status < 200 || r.status >= 300) throw new HttpError(502, `${label} respondeu HTTP ${r.status}`);
  try { return r.text.trim() ? (JSON.parse(r.text) as Record<string, unknown>) : {}; } catch { throw new HttpError(502, `${label} não respondeu em JSON`); }
}

/** Sistema próprio / correspondente / n8n: recebe os dados e devolve a decisão. */
async function webhook(url: string, cred: string | null, payload: Record<string, unknown>): Promise<ProviderResult> {
  const j = await postJson(url, cred, payload, "Sistema de crédito");
  const reason = j.motivo ?? j.mensagem ?? j.message;
  return {
    score: num(j.score), band: j.faixa ? String(j.faixa).slice(0, 60) : null,
    capacity: j.limite != null ? `limite ${String(j.limite).slice(0, 40)}` : null,
    status: wordStatus(j.status ?? j.resultado ?? j.decisao ?? j.aprovado ?? j.approved),
    reasons: reason ? [safeMsg(reason)] : [],
  };
}

/** Plataforma multibanco (Zinix, Credere…) ou n8n: manda a ficha para os bancos da loja. */
async function banksQuery(url: string, cred: string | null, payload: Record<string, unknown>): Promise<ProviderResult> {
  const j = await postJson(url, cred, payload, "Plataforma de bancos");
  const banks = parseBanks(j).map((b) => ({ ...b, mensagem: b.mensagem ? safeMsg(b.mensagem) : null }));
  const asked = ((payload.bancos as string[]) ?? []).map((b) => b.toLowerCase());
  const answered = new Set(banks.map((b) => b.banco.toLowerCase()));
  const pending = !banks.length || asked.some((b) => !answered.has(b));
  return {
    score: null, band: null, capacity: null, status: overallFromBanks(banks), banks, pending,
    externalId: j.id != null || j.protocolo != null ? String(j.id ?? j.protocolo).slice(0, 120) : null,
    reasons: pending ? ["aguardando a resposta dos bancos"] : [],
  };
}

// ---------------------------------------------------------------------------------------------
// Efeitos no lead (tag do resultado + histórico)
// ---------------------------------------------------------------------------------------------

async function tagId(orgId: string, name: string): Promise<string | null> {
  const find = async () => (await db().from("tags").select("id").eq("organization_id", orgId).ilike("name", name).maybeSingle()).data?.id as string | undefined;
  const found = await find();
  if (found) return found;
  const ins = await db().from("tags").insert({ organization_id: orgId, name }).select("id").maybeSingle();
  return (ins.data?.id as string | undefined) ?? (await find()) ?? null; // outra execução criou ao mesmo tempo
}

export async function applyCreditToLead(orgId: string, leadId: string, status: Exclude<CreditStatus, "erro">, payload: Record<string, unknown>, type = "credit_check") {
  const tagName = STATUS_TAG[status];
  const t = await tagId(orgId, tagName);
  // Só uma tag de crédito por vez
  const { data: others } = await db().from("tags").select("id").eq("organization_id", orgId).in("name", Object.values(STATUS_TAG).filter((n) => n !== tagName));
  if (others?.length) await db().from("lead_tags").delete().eq("lead_id", leadId).in("tag_id", others.map((o) => o.id));
  if (t) await db().from("lead_tags").upsert({ lead_id: leadId, tag_id: t, organization_id: orgId }, { onConflict: "lead_id,tag_id", ignoreDuplicates: true });
  await db().from("activities").insert({ organization_id: orgId, lead_id: leadId, actor_id: null, type, payload: { status, label: STATUS_LABEL[status], ...payload } });
}

type CheckRow = { id: number; organization_id: string; lead_id: string | null; status: string; banks: BankResult[]; cpf_masked: string; income: number | null; vehicle_value: number | null; down_payment: number | null; months: number | null };

const brl = (v: unknown) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Resposta dos bancos chegou depois: a própria IA avisa o cliente na conversa. */
async function tellCustomer(orgId: string, c: CheckRow & { conversation_id: string | null }, status: string, bank: string | null, s: CreditSettings) {
  if (!c.conversation_id || !c.lead_id) return;
  const { data: lead } = await db().from("leads").select("name, assigned_to").eq("id", c.lead_id).maybeSingle();
  const first = String(lead?.name ?? "").trim().split(/\s+/)[0] ?? "";
  const hi = /^\+?\d+$/.test(first) || !first ? "" : `${first}, `;
  let text: string;
  if (status === "aprovado") {
    text = `${hi ? hi.charAt(0).toUpperCase() + hi.slice(1) : ""}ótima notícia! Sua análise de crédito foi pré-aprovada${bank ? ` pelo ${bank}` : ""}.`;
    text += s.handoff ? " O especialista já está com a sua ficha aprovada e vai te chamar em instantes para fechar as condições." : " Podemos seguir para a documentação?";
  } else {
    text = `${hi ? hi.charAt(0).toUpperCase() + hi.slice(1) : ""}os bancos responderam e, nesta condição, não foi possível aprovar. Podemos tentar com uma entrada maior ou mais parcelas. Quer que eu refaça a análise?`;
  }
  try {
    await sendAiText(orgId, c.conversation_id, text);
    if (status === "aprovado" && s.handoff) {
      await db().from("conversations").update({ ai_state: "paused", ai_paused_until: null }).eq("id", c.conversation_id);
      await db().from("activities").insert({ organization_id: orgId, lead_id: c.lead_id, actor_id: null, type: "ai_handoff", payload: { reason: "crédito pré-aprovado: vendedor fecha a venda", seller: null } });
    }
  } catch (e) {
    console.error("[crédito] aviso ao cliente", (e as Error).message);
  }
}

/** Manda o resultado da análise para o WhatsApp do vendedor/equipe. */
export async function notifyCreditResult(orgId: string, checkId: number, s?: CreditSettings) {
  const cfg = s ?? (await loadCreditSettings(orgId));
  if (!cfg.notify_phone) return;
  const { data: c } = await db().from("credit_checks").select("*, leads(name, phone)").eq("id", checkId).eq("organization_id", orgId).maybeSingle();
  if (!c) return;
  const lead = (Array.isArray(c.leads) ? c.leads[0] : c.leads) as { name: string; phone: string | null } | null;
  const banks = (c.banks ?? []) as BankResult[];
  const mark = (b: BankResult) => (b.status === "aprovado" ? "✅" : b.status === "reprovado" ? "❌" : "⏳");
  const lines = [
    `💳 *Análise de crédito feita pela IA*`,
    `Cliente: ${lead?.name ?? "—"}${lead?.phone ? ` (${lead.phone})` : ""}`,
    `Resultado: *${STATUS_LABEL[c.status as CreditStatus] ?? c.status}*${c.score != null ? ` · score ${c.score}` : ""}`,
    banks.length ? `Bancos: ${banks.map((b) => `${mark(b)} ${b.banco}${b.parcela ? ` ${b.prazo ? `${b.prazo}x ` : ""}${brl(b.parcela)}` : ""}${b.taxa ? ` ${b.taxa}% a.m.` : ""}`).join(" · ")}` : "",
    `Veículo ${brl(c.vehicle_value)} · entrada ${brl(c.down_payment)} · ${c.months}x de ~${brl(c.installment)}${c.income ? ` · renda ${brl(c.income)}` : ""}`,
    c.conversation_id ? `Conversa: ${appUrl()}/inbox?c=${c.conversation_id}` : "",
  ].filter(Boolean);
  try {
    const { data: ch } = await db().from("whatsapp_channels").select("id").eq("organization_id", orgId).eq("status", "connected").order("created_at").limit(1).maybeSingle();
    if (!ch) return;
    await sendTextVia(await loadChannel(ch.id), cfg.notify_phone, lines.join("\n"));
  } catch (e) {
    console.error("[crédito] aviso ao vendedor", (e as Error).message);
  }
}

/** Status da consulta a partir dos bancos, respeitando a regra da loja (parcela x renda). */
function statusFromBanks(s: CreditSettings, c: CheckRow, banks: BankResult[]) {
  const overall = overallFromBanks(banks) ?? "analise";
  const input = { cpf: "", income: Number(c.income ?? 0), vehicle_value: Number(c.vehicle_value ?? 0), down_payment: Number(c.down_payment ?? 0), months: Number(c.months ?? 48) };
  return decide(s, input, { score: null, band: null, capacity: null, status: overall, reasons: [] }).status;
}

/** Resultado que a plataforma de bancos devolveu depois (endereço de retorno). */
export async function receiveBankCallback(token: string, body: Record<string, unknown>) {
  if (!/^[0-9a-f]{32}$/.test(token)) throw new HttpError(404, "Não encontrado");
  const { data: cfg } = await db().from("credit_settings").select("organization_id, provider").eq("callback_token", token).maybeSingle();
  if (!cfg || cfg.provider !== "bancos") throw new HttpError(404, "Não encontrado");
  const orgId = cfg.organization_id as string;
  const checkId = Number(body.consulta_id ?? body.check_id ?? body.referencia);
  const ext = body.id ?? body.protocolo;
  let q = db().from("credit_checks").select("*").eq("organization_id", orgId).eq("provider", "bancos");
  q = Number.isInteger(checkId) && checkId > 0 ? q.eq("id", checkId) : ext != null ? q.eq("external_id", String(ext)) : q.eq("id", -1);
  const { data: check } = await q.maybeSingle();
  if (!check) throw new HttpError(404, "Consulta não encontrada");

  // Um banco por chamada ou vários de uma vez
  const incoming = parseBanks(body);
  const list = (incoming.length ? incoming : body.banco ?? body.bank ? parseBanks({ bancos: [body] }) : []).map((b) => ({ ...b, mensagem: b.mensagem ? safeMsg(b.mensagem) : null }));
  if (!list.length) return { status: check.status, banks: (check.banks ?? []).length };
  const { data: merged, error } = await db().rpc("credit_merge_banks", { p_id: check.id, p_org: orgId, p_banks: list });
  if (error) throw error;
  const banks = (merged ?? []) as BankResult[];
  const s = await loadCreditSettings(orgId);
  const status = statusFromBanks(s, check as CheckRow, banks);
  await db().from("credit_checks").update({ status, reasons: banks.filter((b) => b.mensagem).map((b) => `${b.banco}: ${b.mensagem}`).slice(0, 10) }).eq("id", check.id);
  const answered = new Set(banks.map((b) => b.banco.toLowerCase()));
  const allAnswered = s.banks.every((b) => answered.has(b.toLowerCase()));
  // Resultado fechado: saiu aprovação, ou todos os bancos responderam
  const final = status === "aprovado" || allAnswered;
  const wasFinal = check.status === "aprovado" || check.status === "reprovado" || Boolean(check.notified_at);
  if (check.lead_id) {
    await applyCreditToLead(orgId, check.lead_id, status, { banks, cpf: check.cpf_masked, vehicle_value: check.vehicle_value, down_payment: check.down_payment, months: check.months }, "credit_banks");
  }
  if (final && !wasFinal) {
    await db().from("credit_checks").update({ notified_at: new Date().toISOString() }).eq("id", check.id).is("notified_at", null);
    const best = banks.find((b) => b.status === "aprovado")?.banco ?? null;
    if (check.source === "ia") await tellCustomer(orgId, check as CheckRow & { conversation_id: string | null }, status, best, s);
    await notifyCreditResult(orgId, check.id as number, s);
  }
  return { status, banks: banks.length };
}

// ---------------------------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------------------------

export interface CheckResult {
  id: number | null; status: Exclude<CreditStatus, "erro">; score: number | null; band: string | null;
  installment: number; incomePct: number | null; reasons: string[]; reused: boolean; provider: string;
  banks: BankResult[]; pending: boolean;
}

export async function runCreditCheck(orgId: string, raw: CreditInput, ctx: {
  source: "ia" | "teste"; leadId?: string | null; conversationId?: string | null; userId?: string | null; leadName?: string | null; phone?: string | null;
  consentMessageId?: string | null; settings?: CreditSettings;
}): Promise<CheckResult> {
  const input = CreditInput.parse(raw);
  if (!isCpf(input.cpf)) throw new HttpError(422, "CPF inválido");
  const s = ctx.settings ?? (await loadCreditSettings(orgId));
  const hash = cpfHash(orgId, input.cpf);
  const base = {
    organization_id: orgId, lead_id: ctx.leadId ?? null, conversation_id: ctx.conversationId ?? null, source: ctx.source,
    cpf_masked: maskCpf(input.cpf), cpf_hash: hash, income: input.income, vehicle_value: input.vehicle_value, down_payment: input.down_payment,
    months: input.months, provider: s.provider, created_by: ctx.userId ?? null, consent_message_id: ctx.consentMessageId ?? null,
  };

  // Mesmo CPF consultado há pouco: reaproveita (não paga de novo, não reenvia a ficha aos bancos)
  const reuseDays = s.provider === "directd" ? 30 : 1;
  const { data: prev } = await db().from("credit_checks").select("*").eq("organization_id", orgId).eq("cpf_hash", hash).eq("provider", s.provider)
    .neq("status", "erro").gte("created_at", new Date(Date.now() - reuseDays * 86_400_000).toISOString())
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  const sameDeal = prev && Number(prev.vehicle_value) === input.vehicle_value && Number(prev.down_payment) === input.down_payment && Number(prev.months) === input.months && Number(prev.income) === input.income;
  if (prev && sameDeal && s.provider !== "directd") {
    // Bancos / sistema próprio: devolve a mesma consulta (a resposta dos bancos continua chegando nela)
    const d = decide(s, input, { score: prev.score, band: prev.score_band, capacity: prev.payment_capacity, status: prev.status === "analise" ? null : prev.status, reasons: [] });
    const banks = (prev.banks ?? []) as BankResult[];
    const status = s.provider === "bancos" ? statusFromBanks(s, prev as CheckRow, banks) : (prev.status as Exclude<CreditStatus, "erro">);
    return { id: prev.id, status, score: prev.score, band: prev.score_band, installment: d.installment, incomePct: d.incomePct, reasons: ["consulta reaproveitada (mesmo CPF nas últimas 24h)"], reused: true, provider: s.provider, banks, pending: s.provider === "bancos" && banks.length < s.banks.length };
  }

  // Por cliente: no máximo 5 tentativas por dia (a IA pode refazer com outra entrada/prazo)
  if (ctx.leadId) {
    const { count: perLead } = await db().from("credit_checks").select("id", { count: "exact", head: true }).eq("lead_id", ctx.leadId).gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
    if ((perLead ?? 0) >= 5) throw new HttpError(429, "Limite de 5 análises por cliente no dia");
  }
  // Limite diário da empresa (protege o saldo na ferramenta de crédito)
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db().from("credit_checks").select("id", { count: "exact", head: true }).eq("organization_id", orgId).gte("created_at", dayAgo);
  if ((count ?? 0) >= s.max_per_day) throw new HttpError(429, `Limite de ${s.max_per_day} consultas por dia atingido`);

  let provider: ProviderResult | null = null;
  let reused = false;
  let preId: number | null = null;
  if (prev && s.provider === "directd" && prev.score != null) {
    provider = { score: prev.score, band: prev.score_band, capacity: prev.payment_capacity, status: null, reasons: ["consulta reaproveitada (últimos 30 dias)"] };
    reused = true;
  }

  try {
    if (!provider) {
      if (s.provider === "directd") {
        const cred = await creditCredential(orgId, "directd");
        if (!cred) throw new HttpError(409, "Falta o token da Direct Data (Agente de IA → Análise de crédito)");
        provider = await directd(cred, input.cpf);
      } else if (s.provider === "bancos") {
        if (!s.webhook_url) throw new HttpError(409, "Falta o endereço da plataforma de bancos");
        // Cria a consulta antes: os bancos podem responder depois, citando este número
        const { data: pre, error: preErr } = await db().from("credit_checks").insert({ ...base, status: "analise", reasons: ["enviando para os bancos"] }).select("id").single();
        if (preErr || !pre) throw preErr ?? new Error("Falha ao registrar a consulta");
        preId = pre.id as number;
        await ensureCreditSettings(orgId);
        const { data: org } = await db().from("organizations").select("name").eq("id", orgId).maybeSingle();
        provider = await banksQuery(s.webhook_url, await creditCredential(orgId, "bancos"), {
          evento: "ficha_financiamento", consulta_id: preId, callback_url: await creditCallbackUrl(orgId), bancos: s.banks,
          empresa: org?.name ?? "", lead_id: ctx.leadId ?? null, nome: ctx.leadName ?? null, telefone: ctx.phone ?? null,
          cpf: cpfDigits(input.cpf), renda_mensal: input.income, valor_veiculo: input.vehicle_value, entrada: input.down_payment, parcelas: input.months,
        });
      } else if (s.provider === "webhook") {
        if (!s.webhook_url) throw new HttpError(409, "Falta o endereço do sistema de crédito");
        const { data: org } = await db().from("organizations").select("name").eq("id", orgId).maybeSingle();
        provider = await webhook(s.webhook_url, await creditCredential(orgId, "webhook"), {
          evento: "analise_credito", empresa: org?.name ?? "", lead_id: ctx.leadId ?? null, nome: ctx.leadName ?? null, telefone: ctx.phone ?? null,
          cpf: cpfDigits(input.cpf), renda_mensal: input.income, valor_veiculo: input.vehicle_value, entrada: input.down_payment, parcelas: input.months,
        });
      } else {
        provider = { score: null, band: null, capacity: null, status: null, reasons: ["sem consulta automática — o vendedor finaliza no banco"] };
      }
    }
  } catch (e) {
    const err = { status: "erro", error: safeMsg((e as Error).message), updated_at: new Date().toISOString() };
    if (preId) await db().from("credit_checks").update(err).eq("id", preId);
    else await db().from("credit_checks").insert({ ...base, ...err });
    throw e;
  }

  let banks = provider.banks ?? [];
  if (preId && banks.length) {
    // Junta com respostas que chegaram pelo endereço de retorno enquanto esperávamos
    const { data: merged, error } = await db().rpc("credit_merge_banks", { p_id: preId, p_org: orgId, p_banks: banks });
    if (error) throw error;
    banks = (merged ?? banks) as BankResult[];
  } else if (preId) {
    banks = (((await db().from("credit_checks").select("banks").eq("id", preId).maybeSingle()).data?.banks ?? []) as BankResult[]);
  }
  const answered = new Set(banks.map((b) => b.banco.toLowerCase()));
  const pending = Boolean(preId) && s.banks.some((b) => !answered.has(b.toLowerCase()));
  const bankOverall = preId ? overallFromBanks(banks) : null;
  const effective: ProviderResult = preId
    ? { ...provider, status: bankOverall === "aprovado" ? "aprovado" : pending || !bankOverall ? "analise" : bankOverall, reasons: pending ? ["aguardando a resposta dos bancos"] : [] }
    : provider;
  const d = decide(s, input, effective);
  const row = {
    installment: d.installment, status: d.status, score: provider.score, score_band: provider.band, payment_capacity: provider.capacity, reasons: d.reasons,
    external_id: provider.externalId ?? null, updated_at: new Date().toISOString(),
  };
  let id = preId;
  if (preId) {
    const { error } = await db().from("credit_checks").update(row).eq("id", preId);
    if (error) throw error;
  } else {
    const { data, error } = await db().from("credit_checks").insert({ ...base, ...row, banks }).select("id").single();
    if (error) throw error;
    id = data.id as number;
  }
  return { id, status: d.status, score: provider.score, band: provider.band, installment: d.installment, incomePct: d.incomePct, reasons: d.reasons, reused, provider: s.provider, banks, pending };
}
