import { z } from "zod";

// Automações: formato do gatilho e dos passos (navegador e servidor).

const id = z.string().uuid();

export const Trigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("lead_created"), source: z.string().max(60).nullable().optional() }),
  z.object({ type: z.literal("stage_changed"), stage_id: id.nullable() }),
  z.object({ type: z.literal("won") }),
  z.object({ type: z.literal("lost") }),
  z.object({ type: z.literal("tag_added"), tag_id: id }),
  z.object({ type: z.literal("message_received"), keywords: z.array(z.string().trim().min(1).max(60)).max(20),
    /** Quando vale: sempre, só fora do horário comercial (time não está trabalhando) ou só dentro. */
    when: z.enum(["any", "off_hours", "business_hours"]).optional() }),
  z.object({ type: z.literal("idle"), days: z.number().int().min(1).max(180), stage_id: id.nullable() }),
]);
export type Trigger = z.infer<typeof Trigger>;

export const CondField = z.enum(["stage", "tag", "no_tag", "value_gte", "value_lte", "source", "assigned", "unassigned", "business_hours", "last_message_contains"]);
export type CondField = z.infer<typeof CondField>;

export const Media = z.object({
  path: z.string().regex(/^[0-9a-f-]{36}\/[\w.-]{1,160}$/, "Arquivo inválido"),
  mime: z.string().max(120),
  name: z.string().max(160),
  size: z.number().int().min(1).max(16 * 1024 * 1024),
});
export type Media = z.infer<typeof Media>;

export const ReplyOption = z.object({
  id: z.string().regex(/^o\d{1,2}$/),
  label: z.string().trim().min(1, "Dê um nome para a opção").max(60),
  keywords: z.array(z.string().trim().min(1).max(60)).max(20),
});
export type ReplyOption = z.infer<typeof ReplyOption>;

export const Step = z.discriminatedUnion("type", [
  z.object({ type: z.literal("send_message"), text: z.string().trim().max(4000),
    /** Foto, vídeo, áudio ou documento (o texto vira a legenda). */
    media: Media.nullable().optional() }),
  z.object({ type: z.literal("wait"), amount: z.number().int().min(1).max(365), unit: z.enum(["minutes", "hours", "days"]) }),
  z.object({ type: z.literal("move_stage"), stage_id: id }),
  z.object({ type: z.literal("add_tag"), tag_id: id }),
  z.object({ type: z.literal("remove_tag"), tag_id: id }),
  z.object({ type: z.literal("assign"), mode: z.enum(["fixed", "round_robin"]), user_ids: z.array(id).min(1).max(50) }),
  z.object({ type: z.literal("set_value"), value: z.number().min(0).max(1e10) }),
  z.object({ type: z.literal("add_note"), text: z.string().trim().min(1).max(2000) }),
  z.object({ type: z.literal("notify"), phone: z.string().regex(/^\d{10,15}$/, "Número inválido (DDI + DDD + número)"), text: z.string().trim().min(1).max(2000) }),
  z.object({ type: z.literal("condition"), field: CondField, value: z.string().max(200).nullable() }),
  z.object({ type: z.literal("webhook"), url: z.string().url().max(500).refine((u) => u.startsWith("https://"), "Use um endereço https://") }),
  z.object({ type: z.literal("ai"), mode: z.enum(["pause", "resume", "off"]) }),
  // Novos blocos (fluxo em canvas)
  z.object({ type: z.literal("wait_reply"), amount: z.number().int().min(1).max(365), unit: z.enum(["minutes", "hours", "days"]) }),
  z.object({ type: z.literal("split"), percent_a: z.number().int().min(1).max(99) }),
  z.object({ type: z.literal("wait_business") }),
  z.object({ type: z.literal("ai_message"), instruction: z.string().trim().min(3, "Diga o que a IA deve escrever").max(1000) }),
  /** Espera a resposta e segue um caminho para cada opção (entende erro de digitação e áudio). */
  z.object({ type: z.literal("reply_options"), amount: z.number().int().min(1).max(365), unit: z.enum(["minutes", "hours", "days"]),
    options: z.array(ReplyOption).min(1).max(6), use_ai: z.boolean() }),
]);
export type Step = z.infer<typeof Step>;

// ---------------------------------------------------------------------------------------------
// Fluxo em canvas (estilo n8n): blocos ligados por conexões, com saídas (Sim/Não, A/B, Respondeu…)
// ---------------------------------------------------------------------------------------------

export const TRIGGER_NODE = "trigger";

export const GraphNode = z.object({
  id: z.string().regex(/^[\w-]{1,40}$/),
  x: z.number().min(-1e5).max(1e5),
  y: z.number().min(-1e5).max(1e5),
  /** null = bloco do gatilho */
  step: Step.nullable(),
});
export const GraphEdge = z.object({ from: z.string().max(40), port: z.string().max(20), to: z.string().max(40) });
export const Graph = z.object({ nodes: z.array(GraphNode).max(60), edges: z.array(GraphEdge).max(150) });
export type GraphNode = z.infer<typeof GraphNode>;
export type GraphEdge = z.infer<typeof GraphEdge>;
export type Graph = z.infer<typeof Graph>;

/** Saídas de cada bloco. Blocos comuns têm uma saída só ("out"). */
export const PORTS: Partial<Record<Step["type"], { id: string; label: string }[]>> = {
  condition: [{ id: "yes", label: "Sim" }, { id: "no", label: "Não" }],
  split: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
  wait_reply: [{ id: "replied", label: "Respondeu" }, { id: "timeout", label: "Não respondeu" }],
};
export const portsOf = (step: Step | null) => {
  if (!step) return [{ id: "out", label: "" }];
  if (step.type === "reply_options") return [...step.options.map((o) => ({ id: o.id, label: o.label })), { id: "other", label: "Outra resposta" }, { id: "timeout", label: "Não respondeu" }];
  return PORTS[step.type] ?? [{ id: "out", label: "" }];
};

/** Problemas do fluxo (lista vazia = ok). */
export function graphIssues(g: Graph): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const n of g.nodes) { if (ids.has(n.id)) out.push("Bloco repetido"); ids.add(n.id); }
  const triggers = g.nodes.filter((n) => n.step === null);
  if (triggers.length !== 1 || triggers[0]!.id !== TRIGGER_NODE) out.push("O fluxo precisa de um gatilho");
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  for (const e of g.edges) {
    const from = byId.get(e.from), to = byId.get(e.to);
    if (!from || !to) { out.push("Conexão com bloco que não existe"); continue; }
    if (to.step === null) out.push("Nada pode ligar de volta no gatilho");
    if (!portsOf(from.step).some((p) => p.id === e.port)) out.push("Conexão numa saída inválida");
    const k = `${e.from}:${e.port}`;
    if (seen.has(k)) out.push("Cada saída liga em um bloco só");
    seen.add(k);
  }
  // Caminho que volta (loop) só com um bloco de espera no meio — senão mandaria mensagens sem parar
  const waits = new Set(g.nodes.filter((n) => n.step && ["wait", "wait_reply", "reply_options"].includes(n.step.type)).map((n) => n.id));
  for (const n of g.nodes) {
    if (n.step?.type === "send_message" && !n.step.text && !n.step.media) out.push("Mensagem sem texto e sem arquivo");
    if (n.step?.type === "reply_options" && new Set(n.step.options.map((o) => o.id)).size !== n.step.options.length) out.push("Opção de resposta repetida");
  }
  const adj = new Map<string, string[]>();
  for (const e of g.edges) if (!waits.has(e.from) && !waits.has(e.to)) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  const state = new Map<string, 1 | 2>();
  const loop = (id: string): boolean => {
    state.set(id, 1);
    for (const t of adj.get(id) ?? []) { if (state.get(t) === 1 || (!state.has(t) && loop(t))) return true; }
    state.set(id, 2);
    return false;
  };
  if (g.nodes.some((n) => !state.has(n.id) && loop(n.id))) out.push("Um caminho que volta para trás precisa ter um bloco de espera");
  if (!g.nodes.some((n) => n.step)) out.push("Adicione pelo menos uma ação");
  else if (!g.edges.some((e) => e.from === TRIGGER_NODE)) out.push("Ligue o gatilho na primeira ação");
  return [...new Set(out)];
}

/** Ações do fluxo (na ordem dos blocos). */
export const graphSteps = (g: Graph): Step[] => g.nodes.flatMap((n) => (n.step ? [n.step] : []));

/** Automação antiga (lista de passos) → fluxo em canvas, da esquerda para a direita. */
export function linearToGraph(steps: Step[]): Graph {
  const nodes: GraphNode[] = [{ id: TRIGGER_NODE, x: 0, y: 0, step: null }];
  const edges: GraphEdge[] = [];
  let prev = TRIGGER_NODE;
  steps.forEach((st, i) => {
    const id = `n${i + 1}`;
    nodes.push({ id, x: (i + 1) * 300, y: 0, step: st });
    edges.push({ from: prev, port: prev === TRIGGER_NODE ? "out" : nodes[i]!.step?.type === "condition" ? "yes" : portsOf(nodes[i]!.step ?? null)[0]!.id, to: id });
    prev = id;
  });
  return { nodes, edges };
}

export const AutomationBody = z.object({
  name: z.string().trim().min(1, "Dê um nome").max(80),
  enabled: z.boolean(),
  trigger: Trigger,
  steps: z.array(Step).max(30),
  graph: Graph.nullable().optional(),
  once_per_lead: z.boolean(),
  stop_on_reply: z.boolean(),
}).superRefine((b, ctx) => {
  if (b.graph) {
    const issues = graphIssues(b.graph);
    if (issues.length) ctx.addIssue({ code: "custom", message: issues[0]!, path: ["graph"] });
  } else if (!b.steps.length) ctx.addIssue({ code: "custom", message: "Adicione pelo menos uma ação", path: ["steps"] });
  else if (b.steps.some((s) => s.type === "send_message" && !s.text && !s.media)) ctx.addIssue({ code: "custom", message: "Mensagem sem texto e sem arquivo", path: ["steps"] });
});
export type AutomationBody = z.infer<typeof AutomationBody>;

export const TRIGGER_LABEL: Record<Trigger["type"], { label: string; hint: string }> = {
  lead_created: { label: "Lead novo", hint: "Quando um lead entra no CRM (WhatsApp, planilha, site…)" },
  stage_changed: { label: "Mudou de etapa", hint: "Quando o lead é movido para uma etapa" },
  won: { label: "Venda ganha", hint: "Quando o lead vai para uma etapa de ganho" },
  lost: { label: "Venda perdida", hint: "Quando o lead vai para uma etapa de perdido" },
  tag_added: { label: "Tag adicionada", hint: "Quando uma tag é colocada no lead" },
  message_received: { label: "Mensagem recebida", hint: "Quando o cliente manda mensagem (com ou sem palavra-chave)" },
  idle: { label: "Lead parado", hint: "Quando o lead fica X dias sem mensagem e sem mudar de etapa" },
};

export const STEP_LABEL: Record<Step["type"], { label: string; group: "Mensagens" | "Lead" | "Fluxo" | "Integrações" }> = {
  send_message: { label: "Enviar mensagem no WhatsApp", group: "Mensagens" },
  notify: { label: "Avisar a equipe no WhatsApp", group: "Mensagens" },
  wait: { label: "Esperar", group: "Fluxo" },
  condition: { label: "Se… (Sim / Não)", group: "Fluxo" },
  move_stage: { label: "Mover para etapa", group: "Lead" },
  add_tag: { label: "Adicionar tag", group: "Lead" },
  remove_tag: { label: "Remover tag", group: "Lead" },
  assign: { label: "Distribuir / transferir para vendedor", group: "Lead" },
  set_value: { label: "Definir valor", group: "Lead" },
  add_note: { label: "Anotação no lead", group: "Lead" },
  ai: { label: "Agente de IA na conversa", group: "Integrações" },
  webhook: { label: "Enviar para n8n / webhook", group: "Integrações" },
  wait_reply: { label: "Esperar o cliente responder", group: "Fluxo" },
  split: { label: "Teste A/B (divide os leads)", group: "Fluxo" },
  wait_business: { label: "Esperar horário comercial", group: "Fluxo" },
  ai_message: { label: "IA escreve e envia a mensagem", group: "Mensagens" },
  reply_options: { label: "Se o cliente responder… (caminhos)", group: "Fluxo" },
};

export const COND_LABEL: Record<CondField, string> = {
  stage: "está na etapa", tag: "tem a tag", no_tag: "não tem a tag", value_gte: "valor maior ou igual a", value_lte: "valor menor ou igual a",
  source: "origem contém", assigned: "o responsável é", unassigned: "está sem responsável", business_hours: "está em horário comercial (Automações → Horário comercial)",
  last_message_contains: "a última mensagem do cliente contém",
};

export const VARIABLES = ["{{nome}}", "{{primeiro_nome}}", "{{telefone}}", "{{etapa}}", "{{valor}}", "{{vendedor}}", "{{empresa}}"];

export interface VarCtx { name: string; phone: string | null; stage: string | null; value: number; seller: string | null; org: string }

/** Troca {{nome}}, {{etapa}}… pelos dados do lead. */
export function renderVars(text: string, v: VarCtx): string {
  const first = v.name.trim().split(/\s+/)[0] ?? "";
  const map: Record<string, string> = {
    nome: v.name, primeiro_nome: /^\+?\d+$/.test(first) ? "" : first, telefone: v.phone ?? "", etapa: v.stage ?? "",
    valor: v.value ? v.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "", vendedor: v.seller ?? "", empresa: v.org,
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in map ? map[k]! : m)).replace(/ {2,}/g, " ").replace(/ ([,.!?])/g, "$1").replace(/,([!?.])/g, "$1").trim();
}

export function waitMs(s: { amount: number; unit: "minutes" | "hours" | "days" }) {
  return s.amount * (s.unit === "minutes" ? 60_000 : s.unit === "hours" ? 3_600_000 : 86_400_000);
}

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/(.)\1+/g, "$1");
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

/** Distância de edição limitada (para tolerar erro de digitação). */
function close(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]!);
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length]! <= max;
}

/**
 * Palavra-chave na mensagem, sem diferenciar acento e maiúscula e tolerando erro de digitação
 * ("presso" acha "preço", "kero" acha "quero", "simmm" acha "sim"). Sem palavras = qualquer mensagem.
 */
export function matchesKeywords(text: string, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const t = fold(text);
  const tw = words(text);
  return keywords.some((k) => {
    const kf = fold(k).trim();
    if (!kf) return false;
    if (t.includes(kf)) return true;
    const kw = words(k);
    if (!kw.length) return false;
    // Cada palavra da expressão precisa aparecer (parecida) na mensagem, na ordem
    let from = 0;
    for (const w of kw) {
      const tol = w.length <= 3 ? 0 : w.length <= 6 ? 1 : 2;
      const idx = tw.findIndex((x, i) => i >= from && (x === w || (tol > 0 && close(x, w, tol)) || soundsLike(x, w)));
      if (idx < 0) return false;
      from = idx + 1;
    }
    return true;
  });
}

/** Trocas comuns de quem escreve rápido / pelo som: k→qu, ç→ss, x→ch, z→s, w→u… */
function soundsLike(a: string, b: string): boolean {
  if (a.length < 3 || b.length < 3) return false;
  const p = (s: string) => s.replace(/qu/g, "k").replace(/c(?=[ei])/g, "s").replace(/ç|ss|z/g, "s").replace(/c/g, "k").replace(/ch/g, "x").replace(/w/g, "u").replace(/y/g, "i").replace(/h/g, "").replace(/(.)\1+/g, "$1");
  const pa = p(a), pb = p(b);
  return pa === pb || (pb.length > 4 && close(pa, pb, 1));
}

/** Qual opção a resposta do cliente escolheu (null = nenhuma). */
export function matchOption(text: string, options: ReplyOption[]): ReplyOption | null {
  return options.find((o) => matchesKeywords(text, o.keywords.length ? o.keywords : [o.label])) ?? null;
}

/** Modelos prontos (como no Kommo/n8n), para começar com 1 clique. */
export const TEMPLATES: { id: string; name: string; text: string; body: Omit<AutomationBody, "enabled"> }[] = [
  {
    id: "fora-do-expediente", name: "Atendimento fora do expediente (noite e madrugada)", text: "Cliente chama quando o time não está: responde na hora, pergunta se quer retorno e segue pela resposta (entende áudio e erro de digitação).",
    body: { name: "Fora do expediente", trigger: { type: "message_received", keywords: [], when: "off_hours" }, once_per_lead: false, stop_on_reply: false, steps: [],
      graph: {
        nodes: [
          { id: "trigger", x: 0, y: 0, step: null },
          { id: "n1", x: 320, y: 0, step: { type: "send_message", text: "Oi, {{primeiro_nome}}! Nosso time está fora agora, mas já anotei sua mensagem. Quer que um consultor te chame assim que abrirmos?" } },
          { id: "n2", x: 640, y: 0, step: { type: "reply_options", amount: 12, unit: "hours", use_ai: true, options: [
            { id: "o1", label: "Quer retorno", keywords: ["sim", "quero", "pode", "pode ser", "por favor", "ok"] },
            { id: "o2", label: "Não precisa", keywords: ["não", "nao", "não precisa", "depois eu chamo"] },
          ] } },
          { id: "n3", x: 980, y: -120, step: { type: "add_note", text: "Pediu retorno fora do expediente — chamar logo cedo." } },
          { id: "n4", x: 980, y: 60, step: { type: "send_message", text: "Combinado, {{primeiro_nome}}! Quando quiser é só chamar aqui. 😊" } },
          { id: "n5", x: 980, y: 220, step: { type: "send_message", text: "Recebi! Assim que o time abrir, alguém te responde por aqui. 😉" } },
        ],
        edges: [
          { from: "trigger", port: "out", to: "n1" }, { from: "n1", port: "out", to: "n2" },
          { from: "n2", port: "o1", to: "n3" }, { from: "n2", port: "o2", to: "n4" }, { from: "n2", port: "other", to: "n5" },
        ],
      } },
  },
  {
    id: "follow-up-inteligente", name: "Follow-up inteligente (respondeu / não respondeu)", text: "Manda mensagem, espera a resposta e segue um caminho para cada caso.",
    body: { name: "Follow-up inteligente", trigger: { type: "idle", days: 1, stage_id: null }, once_per_lead: true, stop_on_reply: false, steps: [],
      graph: {
        nodes: [
          { id: "trigger", x: 0, y: 0, step: null },
          { id: "n1", x: 320, y: 0, step: { type: "wait_business" } },
          { id: "n2", x: 640, y: 0, step: { type: "send_message", text: "Oi, {{primeiro_nome}}! Ficou alguma dúvida? Estou à disposição para te ajudar." } },
          { id: "n3", x: 960, y: 0, step: { type: "wait_reply", amount: 2, unit: "days" } },
          { id: "n4", x: 1280, y: -110, step: { type: "move_stage", stage_id: "00000000-0000-0000-0000-000000000000" } },
          { id: "n5", x: 1280, y: 110, step: { type: "ai_message", instruction: "Faça uma última tentativa gentil de retomar o atendimento, lembrando o que o cliente procurava." } },
          { id: "n6", x: 1600, y: 110, step: { type: "add_tag", tag_id: "00000000-0000-0000-0000-000000000000" } },
        ],
        edges: [
          { from: "trigger", port: "out", to: "n1" }, { from: "n1", port: "out", to: "n2" }, { from: "n2", port: "out", to: "n3" },
          { from: "n3", port: "replied", to: "n4" }, { from: "n3", port: "timeout", to: "n5" }, { from: "n5", port: "out", to: "n6" },
        ],
      } },
  },
  {
    id: "ab-boas-vindas", name: "Teste A/B de boas-vindas", text: "Metade recebe uma mensagem, metade outra — veja qual converte mais.",
    body: { name: "Teste A/B de boas-vindas", trigger: { type: "lead_created", source: null }, once_per_lead: true, stop_on_reply: false, steps: [],
      graph: {
        nodes: [
          { id: "trigger", x: 0, y: 0, step: null },
          { id: "n1", x: 320, y: 0, step: { type: "split", percent_a: 50 } },
          { id: "n2", x: 640, y: -100, step: { type: "send_message", text: "Olá, {{primeiro_nome}}! Que bom ter você aqui. Como posso te ajudar hoje?" } },
          { id: "n3", x: 640, y: 100, step: { type: "send_message", text: "Oi, {{primeiro_nome}}! Separei uma condição especial para você. Quer conhecer?" } },
        ],
        edges: [{ from: "trigger", port: "out", to: "n1" }, { from: "n1", port: "a", to: "n2" }, { from: "n1", port: "b", to: "n3" }],
      } },
  },
  {
    id: "boas-vindas", name: "Boas-vindas ao lead novo", text: "Responde na hora quem chega e coloca no funil.",
    body: { name: "Boas-vindas ao lead novo", trigger: { type: "lead_created", source: null }, once_per_lead: true, stop_on_reply: false,
      steps: [{ type: "condition", field: "business_hours", value: null }, { type: "send_message", text: "Olá, {{primeiro_nome}}! Aqui é da {{empresa}}. Recebemos sua mensagem e já vamos te atender. 😊" }] },
  },
  {
    id: "follow-up", name: "Follow-up de quem não respondeu", text: "1 dia e 3 dias depois, se o cliente não responder.",
    body: { name: "Follow-up de quem não respondeu", trigger: { type: "idle", days: 1, stage_id: null }, once_per_lead: true, stop_on_reply: true,
      steps: [
        { type: "send_message", text: "Oi, {{primeiro_nome}}! Ficou alguma dúvida? Estou à disposição para te ajudar." },
        { type: "wait", amount: 2, unit: "days" },
        { type: "send_message", text: "{{primeiro_nome}}, vou deixar seu atendimento separado aqui. Quando quiser continuar, é só me chamar!" },
        { type: "add_tag", tag_id: "00000000-0000-0000-0000-000000000000" },
      ] },
  },
  {
    id: "pos-venda", name: "Pós-venda 24h depois da venda", text: "Agradece e pergunta como está o produto.",
    body: { name: "Pós-venda 24h depois da venda", trigger: { type: "won" }, once_per_lead: true, stop_on_reply: false,
      steps: [{ type: "wait", amount: 1, unit: "days" }, { type: "send_message", text: "Oi, {{primeiro_nome}}! Passando para saber como está tudo com a sua compra. Qualquer coisa, conte com a gente! 🙌" }] },
  },
  {
    id: "rodizio", name: "Rodízio de leads entre vendedores", text: "Distribui cada lead novo para um vendedor por vez.",
    body: { name: "Rodízio de leads entre vendedores", trigger: { type: "lead_created", source: null }, once_per_lead: true, stop_on_reply: false,
      steps: [{ type: "condition", field: "unassigned", value: null }, { type: "assign", mode: "round_robin", user_ids: [] as unknown as [string] }] },
  },
  {
    id: "palavra-chave", name: "Palavra-chave → tag e etapa", text: "Cliente falou \"preço\" ou \"valor\": marca e move.",
    body: { name: "Palavra-chave → tag e etapa", trigger: { type: "message_received", keywords: ["preço", "valor", "quanto custa"] }, once_per_lead: true, stop_on_reply: false,
      steps: [{ type: "add_tag", tag_id: "00000000-0000-0000-0000-000000000000" }] },
  },
  {
    id: "n8n", name: "Venda ganha → n8n", text: "Manda os dados da venda para o n8n, Make ou outro sistema.",
    body: { name: "Venda ganha → n8n", trigger: { type: "won" }, once_per_lead: true, stop_on_reply: false,
      steps: [{ type: "webhook", url: "https://seu-n8n.com/webhook/venda" }] },
  },
];
