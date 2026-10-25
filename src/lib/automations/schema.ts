import { z } from "zod";

// Automações: formato do gatilho e dos passos (navegador e servidor).

const id = z.string().uuid();

export const Trigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("lead_created"), source: z.string().max(60).nullable().optional() }),
  z.object({ type: z.literal("stage_changed"), stage_id: id.nullable() }),
  z.object({ type: z.literal("won") }),
  z.object({ type: z.literal("lost") }),
  z.object({ type: z.literal("tag_added"), tag_id: id }),
  z.object({ type: z.literal("message_received"), keywords: z.array(z.string().trim().min(1).max(60)).max(20) }),
  z.object({ type: z.literal("idle"), days: z.number().int().min(1).max(180), stage_id: id.nullable() }),
]);
export type Trigger = z.infer<typeof Trigger>;

export const CondField = z.enum(["stage", "tag", "no_tag", "value_gte", "value_lte", "source", "assigned", "unassigned", "business_hours", "last_message_contains"]);
export type CondField = z.infer<typeof CondField>;

export const Step = z.discriminatedUnion("type", [
  z.object({ type: z.literal("send_message"), text: z.string().trim().min(1, "Escreva a mensagem").max(4000) }),
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
]);
export type Step = z.infer<typeof Step>;

export const AutomationBody = z.object({
  name: z.string().trim().min(1, "Dê um nome").max(80),
  enabled: z.boolean(),
  trigger: Trigger,
  steps: z.array(Step).min(1, "Adicione pelo menos uma ação").max(30),
  once_per_lead: z.boolean(),
  stop_on_reply: z.boolean(),
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
  condition: { label: "Continuar só se…", group: "Fluxo" },
  move_stage: { label: "Mover para etapa", group: "Lead" },
  add_tag: { label: "Adicionar tag", group: "Lead" },
  remove_tag: { label: "Remover tag", group: "Lead" },
  assign: { label: "Definir responsável", group: "Lead" },
  set_value: { label: "Definir valor", group: "Lead" },
  add_note: { label: "Anotação no lead", group: "Lead" },
  ai: { label: "Agente de IA na conversa", group: "Integrações" },
  webhook: { label: "Enviar para n8n / webhook", group: "Integrações" },
};

export const COND_LABEL: Record<CondField, string> = {
  stage: "está na etapa", tag: "tem a tag", no_tag: "não tem a tag", value_gte: "valor maior ou igual a", value_lte: "valor menor ou igual a",
  source: "origem contém", assigned: "o responsável é", unassigned: "está sem responsável", business_hours: "está em horário comercial (seg–sáb, 8h–18h)",
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

/** Palavra-chave na mensagem (sem diferenciar acento e maiúscula). Sem palavras = qualquer mensagem. */
export function matchesKeywords(text: string, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const t = n(text);
  return keywords.some((k) => t.includes(n(k)));
}

/** Modelos prontos (como no Kommo/n8n), para começar com 1 clique. */
export const TEMPLATES: { id: string; name: string; text: string; body: Omit<AutomationBody, "enabled"> }[] = [
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
