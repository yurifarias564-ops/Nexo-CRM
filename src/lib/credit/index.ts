import "server-only";
import { createHmac } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/http";
import { cronSecret } from "@/lib/cron";
import { postPinnedFull, publicTarget } from "@/lib/net/safe-post";
import { appUrl } from "@/lib/env";
import { CREDIT_DEFAULTS, cpfDigits, decide, isCpf, maskCpf, overallFromBanks, parseBanks, STATUS_LABEL, STATUS_TAG, type BankResult, type CreditInput, type CreditSettings, type CreditStatus, type ProviderResult } from "./shared";

const db = () => supabaseAdmin();

export async function loadCreditSettings(orgId: string): Promise<CreditSettings> {
  const { data } = await db().from("credit_settings").select("*").eq("organization_id", orgId).maybeSingle();
  if (!data) return { ...CREDIT_DEFAULTS };
  return {
    enabled: data.enabled, provider: data.provider, banks: data.banks ?? [], webhook_url: data.webhook_url, min_score: data.min_score, review_score: data.review_score,
    max_income_pct: Number(data.max_income_pct), monthly_rate: Number(data.monthly_rate), handoff: data.handoff, max_per_day: data.max_per_day,
  };
}

/** Endereço para a plataforma de bancos devolver o resultado depois. */
export async function creditCallbackUrl(orgId: string): Promise<string | null> {
  const { data } = await db().from("credit_settings").select("callback_token").eq("organization_id", orgId).maybeSingle();
  return data?.callback_token ? `${appUrl()}/api/credit/callback/${data.callback_token}` : null;
}

export async function creditCredential(orgId: string): Promise<string | null> {
  const { data } = await db().from("credit_secrets").select("credential").eq("organization_id", orgId).maybeSingle();
  return data?.credential ?? null;
}

const cpfHash = (orgId: string, cpf: string) => createHmac("sha256", `${cronSecret()}:credito`).update(`${orgId}:${cpfDigits(cpf)}`).digest("hex");

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.round(n) : null;
};

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
    const msg = data.metaDados?.mensagem || data.retorno?.observacao || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new HttpError(502, "Direct Data: token inválido ou sem saldo");
    throw new HttpError(502, `Direct Data: ${String(msg).slice(0, 200)}`);
  }
  return {
    score: num(pf.score), band: pf.faixaScore?.slice(0, 60) ?? null, capacity: pf.capacidadePagamento?.slice(0, 80) ?? null, status: null,
    reasons: pf.perfil ? [`perfil: ${String(pf.perfil).slice(0, 80)}`] : [],
  };
}

const STATUS_WORDS: [RegExp, Exclude<CreditStatus, "erro">][] = [
  [/^(aprovad|approv|pre.?aprovad|liberad|sim$|true$)/i, "aprovado"],
  [/^(reprovad|negad|recusad|denied|reject|nao$|não$|false$)/i, "reprovado"],
  [/^(analise|análise|pendente|pending|review|em.?analise)/i, "analise"],
];

/** Sistema próprio / banco / n8n: recebe os dados e devolve a decisão. */
async function webhook(url: string, cred: string | null, payload: Record<string, unknown>): Promise<ProviderResult> {
  const target = await publicTarget(url);
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json", "user-agent": "NexoCRM-Credito" };
  if (cred) headers.authorization = `Bearer ${cred}`;
  const r = await postPinnedFull(target, JSON.stringify(payload), headers, { readBody: true, timeoutMs: 45_000 });
  if (r.status < 200 || r.status >= 300) throw new HttpError(502, `Sistema de crédito respondeu HTTP ${r.status}`);
  let j: Record<string, unknown>;
  try { j = JSON.parse(r.text) as Record<string, unknown>; } catch { throw new HttpError(502, "Sistema de crédito não respondeu em JSON"); }
  const raw = j.status ?? j.resultado ?? j.decisao ?? j.aprovado ?? j.approved;
  const word = String(raw ?? "").trim();
  const status = STATUS_WORDS.find(([re]) => re.test(word))?.[1] ?? null;
  const reason = j.motivo ?? j.mensagem ?? j.message;
  return {
    score: num(j.score), band: j.faixa ? String(j.faixa).slice(0, 60) : null,
    capacity: j.limite != null ? `limite ${String(j.limite).slice(0, 40)}` : null, status,
    reasons: reason ? [String(reason).slice(0, 200)] : [],
  };
}

/** Plataforma multibanco (Zinix, Credere…) ou n8n: manda a ficha para os bancos da loja. */
async function banksQuery(url: string, cred: string | null, payload: Record<string, unknown>): Promise<ProviderResult> {
  const target = await publicTarget(url);
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json", "user-agent": "NexoCRM-Credito" };
  if (cred) headers.authorization = `Bearer ${cred}`;
  const r = await postPinnedFull(target, JSON.stringify(payload), headers, { readBody: true, timeoutMs: 45_000 });
  if (r.status < 200 || r.status >= 300) throw new HttpError(502, `Plataforma de bancos respondeu HTTP ${r.status}`);
  let j: Record<string, unknown> = {};
  try { j = r.text.trim() ? (JSON.parse(r.text) as Record<string, unknown>) : {}; } catch { throw new HttpError(502, "Plataforma de bancos não respondeu em JSON"); }
  const banks = parseBanks(j);
  const asked = (payload.bancos as string[]) ?? [];
  const answered = new Set(banks.map((b) => b.banco.toLowerCase()));
  const pending = !banks.length || asked.some((b) => !answered.has(b.toLowerCase()) && banks.every((x) => x.status !== "aprovado"));
  return {
    score: null, band: null, capacity: null, status: overallFromBanks(banks), banks, pending,
    externalId: j.id != null || j.protocolo != null ? String(j.id ?? j.protocolo).slice(0, 120) : null,
    reasons: pending ? ["aguardando a resposta dos bancos"] : [],
  };
}

// ---------------------------------------------------------------------------------------------
// Efeitos no lead (tag do resultado + histórico)
// ---------------------------------------------------------------------------------------------

export async function applyCreditToLead(orgId: string, leadId: string, status: Exclude<CreditStatus, "erro">, payload: Record<string, unknown>, type = "credit_check") {
  const tagName = STATUS_TAG[status];
  let { data: t } = await db().from("tags").select("id").eq("organization_id", orgId).ilike("name", tagName).maybeSingle();
  if (!t) t = (await db().from("tags").insert({ organization_id: orgId, name: tagName }).select("id").single()).data;
  // Só uma tag de crédito por vez
  const { data: others } = await db().from("tags").select("id").eq("organization_id", orgId).in("name", Object.values(STATUS_TAG).filter((n) => n !== tagName));
  if (others?.length) await db().from("lead_tags").delete().eq("lead_id", leadId).in("tag_id", others.map((o) => o.id));
  if (t) await db().from("lead_tags").upsert({ lead_id: leadId, tag_id: t.id, organization_id: orgId }, { onConflict: "lead_id,tag_id", ignoreDuplicates: true });
  await db().from("activities").insert({ organization_id: orgId, lead_id: leadId, actor_id: null, type, payload: { status, label: STATUS_LABEL[status], ...payload } });
}

/** Resultado que a plataforma de bancos devolveu depois (endereço de retorno). */
export async function receiveBankCallback(token: string, body: Record<string, unknown>) {
  if (!/^[0-9a-f]{32}$/.test(token)) throw new HttpError(404, "Não encontrado");
  const { data: cfg } = await db().from("credit_settings").select("organization_id").eq("callback_token", token).maybeSingle();
  if (!cfg) throw new HttpError(404, "Não encontrado");
  const orgId = cfg.organization_id as string;
  const checkId = Number(body.consulta_id ?? body.check_id ?? body.referencia);
  const ext = body.id ?? body.protocolo;
  let q = db().from("credit_checks").select("*").eq("organization_id", orgId);
  q = Number.isInteger(checkId) && checkId > 0 ? q.eq("id", checkId) : ext != null ? q.eq("external_id", String(ext)) : q.eq("id", -1);
  const { data: check } = await q.maybeSingle();
  if (!check) throw new HttpError(404, "Consulta não encontrada");

  // Junta as respostas: cada banco pode responder numa chamada diferente
  const incoming = parseBanks(body);
  const single = !incoming.length && (body.banco ?? body.bank) ? parseBanks({ bancos: [body] }) : [];
  const merged = new Map<string, BankResult>(((check.banks ?? []) as BankResult[]).map((b) => [b.banco.toLowerCase(), b]));
  for (const b of [...incoming, ...single]) merged.set(b.banco.toLowerCase(), b);
  const banks = [...merged.values()];
  const status = overallFromBanks(banks) ?? "analise";
  const changed = status !== check.status;
  await db().from("credit_checks").update({ banks, status, updated_at: new Date().toISOString(), reasons: banks.filter((b) => b.mensagem).map((b) => `${b.banco}: ${b.mensagem}`).slice(0, 10) }).eq("id", check.id);
  if (check.lead_id && (changed || incoming.length || single.length)) {
    await applyCreditToLead(orgId, check.lead_id, status, { banks, cpf: check.cpf_masked, vehicle_value: check.vehicle_value, down_payment: check.down_payment, months: check.months }, "credit_banks");
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

export async function runCreditCheck(orgId: string, input: CreditInput, ctx: {
  source: "ia" | "teste"; leadId?: string | null; conversationId?: string | null; userId?: string | null; leadName?: string | null; phone?: string | null;
  settings?: CreditSettings;
}): Promise<CheckResult> {
  if (!isCpf(input.cpf)) throw new HttpError(422, "CPF inválido");
  const s = ctx.settings ?? (await loadCreditSettings(orgId));
  const hash = cpfHash(orgId, input.cpf);
  const base = {
    organization_id: orgId, lead_id: ctx.leadId ?? null, conversation_id: ctx.conversationId ?? null, source: ctx.source,
    cpf_masked: maskCpf(input.cpf), cpf_hash: hash, income: input.income, vehicle_value: input.vehicle_value, down_payment: input.down_payment,
    months: input.months, provider: s.provider, created_by: ctx.userId ?? null,
  };

  // Limite diário da empresa (protege o saldo na ferramenta de crédito)
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db().from("credit_checks").select("id", { count: "exact", head: true }).eq("organization_id", orgId).gte("created_at", dayAgo);
  if ((count ?? 0) >= s.max_per_day) throw new HttpError(429, `Limite de ${s.max_per_day} consultas por dia atingido`);

  // Mesmo CPF consultado no bureau nos últimos 30 dias: reaproveita o score (não paga de novo)
  let provider: ProviderResult | null = null;
  let reused = false;
  let preId: number | null = null;
  if (s.provider === "directd") {
    const { data: prev } = await db().from("credit_checks").select("score, score_band, payment_capacity").eq("organization_id", orgId).eq("cpf_hash", hash)
      .eq("provider", "directd").neq("status", "erro").not("score", "is", null).gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (prev) { provider = { score: prev.score, band: prev.score_band, capacity: prev.payment_capacity, status: null, reasons: ["consulta reaproveitada (últimos 30 dias)"] }; reused = true; }
  }

  try {
    if (!provider) {
      if (s.provider === "directd") {
        const cred = await creditCredential(orgId);
        if (!cred) throw new HttpError(409, "Falta o token da Direct Data (Agente de IA → Crédito)");
        provider = await directd(cred, input.cpf);
      } else if (s.provider === "bancos") {
        if (!s.webhook_url) throw new HttpError(409, "Falta o endereço da plataforma de bancos");
        // Cria a consulta antes: os bancos podem responder depois, citando este número
        const { data: pre, error: preErr } = await db().from("credit_checks").insert({ ...base, status: "analise", reasons: ["enviando para os bancos"] }).select("id").single();
        if (preErr || !pre) throw preErr ?? new Error("Falha ao registrar a consulta");
        preId = pre.id as number;
        const { data: org } = await db().from("organizations").select("name").eq("id", orgId).maybeSingle();
        provider = await banksQuery(s.webhook_url, await creditCredential(orgId), {
          evento: "ficha_financiamento", consulta_id: preId, callback_url: await creditCallbackUrl(orgId), bancos: s.banks,
          empresa: org?.name ?? "", lead_id: ctx.leadId ?? null, nome: ctx.leadName ?? null, telefone: ctx.phone ?? null,
          cpf: cpfDigits(input.cpf), renda_mensal: input.income, valor_veiculo: input.vehicle_value, entrada: input.down_payment, parcelas: input.months,
        });
      } else if (s.provider === "webhook") {
        if (!s.webhook_url) throw new HttpError(409, "Falta o endereço do sistema de crédito");
        const { data: org } = await db().from("organizations").select("name").eq("id", orgId).maybeSingle();
        provider = await webhook(s.webhook_url, await creditCredential(orgId), {
          evento: "analise_credito", empresa: org?.name ?? "", lead_id: ctx.leadId ?? null, nome: ctx.leadName ?? null, telefone: ctx.phone ?? null,
          cpf: cpfDigits(input.cpf), renda_mensal: input.income, valor_veiculo: input.vehicle_value, entrada: input.down_payment, parcelas: input.months,
        });
      } else {
        provider = { score: null, band: null, capacity: null, status: null, reasons: ["sem consulta automática — o vendedor finaliza no banco"] };
      }
    }
  } catch (e) {
    const err = { status: "erro", error: (e as Error).message.slice(0, 300), updated_at: new Date().toISOString() };
    if (preId) await db().from("credit_checks").update(err).eq("id", preId);
    else await db().from("credit_checks").insert({ ...base, ...err });
    throw e;
  }

  const d = decide(s, input, provider.pending ? { ...provider, status: provider.status === "aprovado" ? "aprovado" : "analise" } : provider);
  const row = {
    installment: d.installment, status: d.status, score: provider.score, score_band: provider.band, payment_capacity: provider.capacity, reasons: d.reasons,
    banks: provider.banks ?? [], external_id: provider.externalId ?? null, updated_at: new Date().toISOString(),
  };
  let id = preId;
  if (preId) await db().from("credit_checks").update(row).eq("id", preId);
  else id = ((await db().from("credit_checks").insert({ ...base, ...row }).select("id").single()).data?.id as number | undefined) ?? null;
  return { id, status: d.status, score: provider.score, band: provider.band, installment: d.installment, incomePct: d.incomePct, reasons: d.reasons, reused, provider: s.provider, banks: provider.banks ?? [], pending: Boolean(provider.pending) };
}
