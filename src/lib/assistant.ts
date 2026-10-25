import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env, envOptional } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { supabaseServer } from "@/lib/supabase/server";
import { norm } from "@/lib/utils";
import { nowInZone } from "@/lib/time";
import { resolveCommand } from "@/lib/voice-resolve";
import { describe, type ResolvedAction } from "@/lib/voice-actions";
import type { Organization, Role } from "@/lib/types";

// Assistente do CRM: o Claude consulta os dados (sempre com as permissões de quem pergunta)
// e prepara ações para o usuário confirmar. Nada é alterado sem confirmação.

type Ctx = { org: Organization; role: Role; userId: string; userName: string };
export type ChatMsg = { role: "user" | "assistant"; content: string };

const DAY = 86_400_000;
const brl = (v: number) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ago = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} dias`;
};

const TOOLS = [
  {
    name: "buscar_leads",
    description: "Lista leads com filtros. Use para perguntas como 'quem está parado', 'leads da etapa X', 'leads com tag Y', 'leads do vendedor Z', 'maiores oportunidades'. 'Parado' = sem mensagem e sem mudar de etapa.",
    input_schema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Parte do nome ou telefone" },
        etapa: { type: "string", description: "Nome da etapa/coluna" },
        tag: { type: "string" },
        responsavel: { type: "string", description: "Nome do vendedor, 'eu' ou 'ninguem'" },
        parado_min_dias: { type: "number" },
        na_base_min_dias: { type: "number", description: "Criado há pelo menos N dias" },
        esperando_resposta: { type: "boolean", description: "Última mensagem foi do cliente (ele está esperando)" },
        ordenar: { type: "string", enum: ["parado", "valor", "recente", "antigo"] },
        limite: { type: "number" },
      },
    },
  },
  {
    name: "resumo_funil",
    description: "Números do período: leads novos, vendas ganhas (qtd e R$), perdidos, conversão, em andamento, por etapa, por origem e por vendedor. Datas em AAAA-MM-DD; padrão = este mês até hoje.",
    input_schema: { type: "object", properties: { de: { type: "string" }, ate: { type: "string" }, vendedor: { type: "string" } } },
  },
  {
    name: "detalhes_lead",
    description: "Tudo sobre um lead: etapa, valor, tags, responsável, últimas mensagens da conversa, histórico e agendamentos. Use para resumir um atendimento ou sugerir a próxima resposta.",
    input_schema: { type: "object", properties: { lead: { type: "string", description: "Nome ou telefone" } }, required: ["lead"] },
  },
  {
    name: "agenda",
    description: "Compromissos agendados (reuniões, visitas) num período. Datas AAAA-MM-DD; padrão = hoje e os próximos 7 dias.",
    input_schema: { type: "object", properties: { de: { type: "string" }, ate: { type: "string" } } },
  },
  {
    name: "preparar_acoes",
    description: "Prepara ações no CRM (mover lead, criar etapa, valor, tags, responsável, anotar, agendar, mandar ou agendar WhatsApp, registrar ligação, criar lead). Escreva o pedido como um comando completo em português, com os nomes certos. As ações aparecem para o usuário CONFIRMAR na tela; diga que estão aguardando a confirmação.",
    input_schema: { type: "object", properties: { comando: { type: "string" } }, required: ["comando"] },
  },
];

async function membersOf(sb: SupabaseClient, orgId: string) {
  const { data } = await sb.from("organization_members").select("user_id, profiles(full_name, email)").eq("organization_id", orgId);
  type R = { user_id: string; profiles: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null };
  return ((data ?? []) as R[]).map((r) => {
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    return { id: r.user_id, name: p?.full_name || p?.email || "Usuário" };
  });
}

function pickByName<T extends { name: string }>(list: T[], q: string): T | null {
  const n = norm(q);
  return list.find((x) => norm(x.name) === n) ?? list.find((x) => norm(x.name).includes(n) || n.includes(norm(x.name))) ?? null;
}

function dayRange(de: unknown, ate: unknown, tz: string, fallbackDays: [number, number]): [Date, Date] {
  const parse = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00-03:00`) : null);
  void tz;
  const now = new Date();
  const from = parse(de) ?? new Date(now.getTime() + fallbackDays[0] * DAY);
  const toDay = parse(ate);
  const to = toDay ? new Date(toDay.getTime() + DAY) : new Date(now.getTime() + fallbackDays[1] * DAY);
  return [from, to];
}

async function runTool(name: string, i: Record<string, unknown>, ctx: Ctx, sb: SupabaseClient, tz: string, pending: ResolvedAction[], issues: string[]): Promise<string> {
  switch (name) {
    case "buscar_leads": {
      const [{ data: stages }, members] = await Promise.all([sb.from("stages").select("id, name"), membersOf(sb, ctx.org.id)]);
      const stageName = new Map((stages ?? []).map((s) => [s.id as string, s.name as string]));
      const memberName = new Map(members.map((m) => [m.id, m.name]));
      let q = sb.from("leads").select("id, name, phone, value, stage_id, assigned_to, source, created_at, stage_changed_at, last_message_at, last_message_preview, last_message_dir").eq("organization_id", ctx.org.id);
      if (typeof i.texto === "string" && i.texto.trim()) {
        const t = i.texto.trim();
        const digits = t.replace(/\D/g, "");
        q = digits.length >= 4 ? q.like("phone", `%${digits}%`) : q.ilike("name", `%${t}%`);
      }
      if (typeof i.etapa === "string" && i.etapa.trim()) {
        const st = pickByName((stages ?? []) as { id: string; name: string }[], i.etapa);
        if (!st) return `Etapa "${i.etapa}" não existe. Etapas: ${(stages ?? []).map((s) => s.name).join(", ")}`;
        q = q.eq("stage_id", st.id);
      }
      if (typeof i.tag === "string" && i.tag.trim()) {
        const { data: tags } = await sb.from("tags").select("id, name");
        const tg = pickByName((tags ?? []) as { id: string; name: string }[], i.tag);
        if (!tg) return `Tag "${i.tag}" não existe.`;
        const { data: lt } = await sb.from("lead_tags").select("lead_id").eq("tag_id", tg.id).limit(2000);
        const ids = (lt ?? []).map((r) => r.lead_id as string);
        if (!ids.length) return "Nenhum lead com essa tag.";
        q = q.in("id", ids.slice(0, 1000));
      }
      if (typeof i.responsavel === "string" && i.responsavel.trim()) {
        const r = norm(i.responsavel);
        if (r === "eu" || r === "meus" || r === "minhas") q = q.eq("assigned_to", ctx.userId);
        else if (r.startsWith("ningu") || r.includes("sem respons")) q = q.is("assigned_to", null);
        else {
          const m = pickByName(members, i.responsavel);
          if (!m) return `Vendedor "${i.responsavel}" não encontrado. Equipe: ${members.map((x) => x.name).join(", ")}`;
          q = q.eq("assigned_to", m.id);
        }
      }
      const idle = Number(i.parado_min_dias);
      if (Number.isFinite(idle) && idle > 0) {
        const cut = new Date(Date.now() - idle * DAY).toISOString();
        q = q.lt("stage_changed_at", cut).or(`last_message_at.is.null,last_message_at.lt.${cut}`);
      }
      const base = Number(i.na_base_min_dias);
      if (Number.isFinite(base) && base > 0) q = q.lt("created_at", new Date(Date.now() - base * DAY).toISOString());
      if (i.esperando_resposta === true) q = q.eq("last_message_dir", "in");
      const order = i.ordenar === "valor" ? { col: "value", asc: false } : i.ordenar === "recente" ? { col: "last_message_at", asc: false }
        : i.ordenar === "antigo" ? { col: "created_at", asc: true } : { col: "stage_changed_at", asc: true };
      const limit = Math.min(Math.max(Number(i.limite) || 15, 1), 40);
      const { data, error } = await q.order(order.col, { ascending: order.asc, nullsFirst: false }).limit(limit);
      if (error) return `Erro na busca: ${error.message}`;
      const rows = data ?? [];
      if (!rows.length) return "Nenhum lead encontrado com esses filtros.";
      return `${rows.length} lead(s)${rows.length === limit ? " (limitado)" : ""}:\n` + rows.map((l) => {
        const idleSince = Math.max(new Date(l.stage_changed_at ?? l.created_at).getTime(), l.last_message_at ? new Date(l.last_message_at).getTime() : 0);
        return `- ${l.name} | etapa: ${stageName.get(l.stage_id) ?? "?"} | ${brl(Number(l.value))} | resp.: ${l.assigned_to ? memberName.get(l.assigned_to) ?? "?" : "ninguém"} | parado há ${ago(new Date(idleSince).toISOString())} | na base há ${ago(l.created_at)}`
          + (l.last_message_at ? ` | última msg (${l.last_message_dir === "in" ? "cliente" : "nós"}, há ${ago(l.last_message_at)}): "${(l.last_message_preview ?? "").slice(0, 80)}"` : " | sem conversa")
          + (l.source ? ` | origem: ${l.source}` : "");
      }).join("\n");
    }
    case "resumo_funil": {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const [from, to] = typeof i.de === "string" || typeof i.ate === "string" ? dayRange(i.de, i.ate, tz, [0, 1]) : [monthStart, new Date(now.getTime() + DAY)];
      let seller: string | null = null;
      const members = await membersOf(sb, ctx.org.id);
      if (typeof i.vendedor === "string" && i.vendedor.trim()) {
        const m = norm(i.vendedor) === "eu" ? members.find((x) => x.id === ctx.userId) : pickByName(members, i.vendedor);
        if (!m) return `Vendedor "${i.vendedor}" não encontrado.`;
        seller = m.id;
      }
      const { data, error } = await sb.rpc("dashboard_stats", { org: ctx.org.id, p_from: from.toISOString(), p_to: to.toISOString(), p_tz: tz, p_seller: seller });
      if (error) return `Erro: ${error.message}`;
      const st = data as {
        new_leads: number; open_count: number; open_value: number; won_count: number; won_value: number; lost_count: number;
        by_stage: { name: string; count: number; value: number }[]; by_source: { name: string; count: number }[];
        by_owner: { user_id: string | null; won_count: number; won_value: number; new_leads?: number }[];
        messages: { in: number; out: number }[];
      };
      const name = new Map(members.map((m) => [m.id, m.name]));
      const conv = st.won_count + st.lost_count ? Math.round((st.won_count / (st.won_count + st.lost_count)) * 100) : null;
      const msgs = st.messages.reduce((a, d) => ({ in: a.in + d.in, out: a.out + d.out }), { in: 0, out: 0 });
      return [
        `Período: ${from.toLocaleDateString("pt-BR")} a ${new Date(to.getTime() - 1).toLocaleDateString("pt-BR")}${seller ? ` · vendedor: ${name.get(seller)}` : " · todos"}`,
        `Leads novos: ${st.new_leads} | Vendas ganhas: ${st.won_count} (${brl(st.won_value)}) | Perdidos: ${st.lost_count} | Conversão: ${conv === null ? "—" : `${conv}%`}`,
        `Em andamento agora: ${st.open_count} leads (${brl(st.open_value)}) | Mensagens: ${msgs.in} recebidas, ${msgs.out} enviadas`,
        `Por etapa (agora): ${st.by_stage.map((s) => `${s.name}: ${s.count} (${brl(s.value)})`).join("; ")}`,
        `Origem dos novos: ${st.by_source.map((s) => `${s.name}: ${s.count}`).join("; ") || "—"}`,
        `Por vendedor: ${st.by_owner.map((o) => `${o.user_id ? name.get(o.user_id) ?? "?" : "sem responsável"}: ${o.won_count} vendas ${brl(o.won_value)}, ${o.new_leads ?? 0} leads novos`).join("; ") || "—"}`,
      ].join("\n");
    }
    case "detalhes_lead": {
      const { data: found } = await sb.rpc("search_leads", { org: ctx.org.id, q: String(i.lead ?? ""), max_results: 3 });
      const cands = (found ?? []) as { id: string; name: string; score: number }[];
      if (!cands.length) return `Não encontrei o lead "${i.lead}".`;
      const id = cands[0]!.id;
      const [{ data: l }, { data: tags }, { data: convs }, { data: acts }, { data: appts }, members, { data: stages }] = await Promise.all([
        sb.from("leads").select("*").eq("id", id).maybeSingle(),
        sb.from("lead_tags").select("tags(name)").eq("lead_id", id),
        sb.from("conversations").select("id").eq("lead_id", id),
        sb.from("activities").select("type, payload, created_at").eq("lead_id", id).order("created_at", { ascending: false }).limit(8),
        sb.from("appointments").select("title, starts_at, status").eq("lead_id", id).order("starts_at", { ascending: false }).limit(5),
        membersOf(sb, ctx.org.id),
        sb.from("stages").select("id, name"),
      ]);
      if (!l) return "Lead não encontrado.";
      const convIds = (convs ?? []).map((c) => c.id as string);
      const { data: msgs } = convIds.length
        ? await sb.from("messages").select("direction, type, body, sent_at, deleted_at").in("conversation_id", convIds).order("sent_at", { ascending: false }).limit(20)
        : { data: [] as { direction: string; type: string; body: string | null; sent_at: string; deleted_at: string | null }[] };
      const stName = (stages ?? []).find((s) => s.id === l.stage_id)?.name ?? "?";
      const owner = members.find((m) => m.id === l.assigned_to)?.name ?? "ninguém";
      const tagNames = (tags ?? []).map((t) => (Array.isArray(t.tags) ? t.tags[0]?.name : (t.tags as { name?: string } | null)?.name)).filter(Boolean);
      const lines = [
        `${l.name}${cands.length > 1 && cands[1]!.score > 0.5 ? ` (há outros parecidos: ${cands.slice(1).map((c) => c.name).join(", ")})` : ""}`,
        `Telefone: ${l.phone ?? "—"} | E-mail: ${l.email ?? "—"} | Etapa: ${stName} | Valor: ${brl(Number(l.value))} | Responsável: ${owner} | Origem: ${l.source ?? "—"}`,
        `Tags: ${tagNames.join(", ") || "nenhuma"} | Na base há ${ago(l.created_at)} | Nesta etapa há ${ago(l.stage_changed_at)}`,
        l.notes ? `Anotações: ${String(l.notes).slice(0, 500)}` : "",
        `Agendamentos: ${(appts ?? []).map((a) => `${a.title} em ${new Date(a.starts_at).toLocaleString("pt-BR", { timeZone: tz })} (${a.status})`).join("; ") || "nenhum"}`,
        `Histórico recente: ${(acts ?? []).map((a) => `${a.type}${(a.payload as { text?: string })?.text ? `: ${(a.payload as { text?: string }).text}` : ""} (${ago(a.created_at)})`).join("; ") || "—"}`,
        "Conversa (mais antiga → mais recente):",
        ...((msgs ?? []).slice().reverse().map((m) => `  [${new Date(m.sent_at).toLocaleString("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}] ${m.direction === "in" ? "Cliente" : "Nós"}: ${m.deleted_at ? "(apagada)" : m.body ? m.body.slice(0, 300) : `[${m.type}]`}`)),
      ].filter(Boolean);
      if (!msgs?.length) lines.push("  (sem mensagens)");
      return lines.join("\n");
    }
    case "agenda": {
      const [from, to] = dayRange(i.de, i.ate, tz, [-0.5, 7]);
      const { data } = await sb.from("appointments").select("title, starts_at, status, leads(name), user_id")
        .gte("starts_at", from.toISOString()).lt("starts_at", to.toISOString()).order("starts_at").limit(50);
      if (!data?.length) return "Nenhum compromisso no período.";
      return data.map((a) => {
        const ld = (Array.isArray(a.leads) ? a.leads[0] : a.leads) as { name?: string } | null;
        return `- ${new Date(a.starts_at).toLocaleString("pt-BR", { timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}: ${a.title} (${ld?.name ?? "—"}) · ${a.status}`;
      }).join("\n");
    }
    case "preparar_acoes": {
      const cmd = String(i.comando ?? "").trim().slice(0, 1000);
      if (!cmd) return "Comando vazio.";
      const r = await resolveCommand(ctx, cmd, tz);
      pending.push(...r.actions);
      issues.push(...r.issues);
      if (!r.actions.length) return `Nenhuma ação identificada. ${r.issues.join(" ")}`;
      return `Ações preparadas e AGUARDANDO CONFIRMAÇÃO do usuário na tela:\n${r.actions.map((a) => `- ${describe(a)}`).join("\n")}${r.issues.length ? `\nAvisos: ${r.issues.join(" ")}` : ""}`;
    }
  }
  return "Ferramenta desconhecida.";
}

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export async function askAssistant(ctx: Ctx, history: ChatMsg[], tz: string): Promise<{ reply: string; actions: ResolvedAction[]; issues: string[] }> {
  const sb = await supabaseServer();
  const [{ data: stages }, { data: tags }] = await Promise.all([
    sb.from("stages").select("name, position").order("position"),
    sb.from("tags").select("name"),
  ]);
  const system = [
    `Você é o assistente do Nexo CRM da empresa "${ctx.org.name}". Fala com ${ctx.userName} (${ctx.role === "agent" ? "vendedor — só enxerga os próprios leads" : "dono/administrador — vê toda a empresa"}).`,
    `Agora: ${nowInZone(tz)} (fuso ${tz}).`,
    `Etapas do funil: ${(stages ?? []).map((s) => s.name).join(" → ") || "(nenhuma)"}. Tags: ${(tags ?? []).map((t) => t.name).join(", ") || "(nenhuma)"}.`,
    "Responda em português do Brasil, direto e prático, como um gerente comercial experiente. Use as ferramentas para buscar os dados — NUNCA invente números, nomes ou mensagens.",
    "Formato: frases curtas; listas com '- ' quando houver vários itens; destaque números e nomes com **negrito**. Sem tabelas.",
    "Quando pedirem para fazer algo no CRM (mover, criar etapa, valor, tag, agendar, mandar mensagem...), use preparar_acoes e diga que as ações estão aguardando a confirmação na tela. Pode combinar: buscar leads e depois preparar ações para eles (use os nomes exatos que a busca retornou).",
    "Para sugerir resposta ao cliente, leia a conversa com detalhes_lead e escreva a mensagem pronta para copiar, no tom da conversa.",
    "Se a pergunta for ambígua, escolha a leitura mais útil e diga qual escolheu. 'Ela/ele' se refere ao último lead citado na conversa.",
  ].join("\n");

  const messages: unknown[] = history.slice(-14).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  const pending: ResolvedAction[] = [];
  const issues: string[] = [];
  let reply = "";

  for (let round = 0; round < 8; round++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: envOptional("ANTHROPIC_ASSISTANT_MODEL", "claude-sonnet-5-5"), max_tokens: 2000, system, tools: TOOLS, messages }),
      signal: AbortSignal.timeout(50_000),
    });
    const body = (await res.json().catch(() => ({}))) as { content?: Block[]; stop_reason?: string; error?: { message?: string } };
    if (!res.ok) throw new HttpError(502, `Assistente indisponível: ${body.error?.message ?? res.status}`);
    const content = body.content ?? [];
    const text = content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();
    if (text) reply = text;
    const uses = content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    if (!uses.length || body.stop_reason !== "tool_use") break;
    messages.push({ role: "assistant", content });
    const results = [];
    for (const u of uses) {
      let out: string;
      try { out = await runTool(u.name, u.input ?? {}, ctx, sb, tz, pending, issues); }
      catch (e) { out = `Erro: ${(e as Error).message}`; }
      results.push({ type: "tool_result", tool_use_id: u.id, content: out.slice(0, 12_000) });
    }
    messages.push({ role: "user", content: results });
  }
  return { reply: reply || "Não consegui responder agora. Tente reformular a pergunta.", actions: pending, issues };
}
