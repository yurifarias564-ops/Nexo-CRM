import { z } from "zod";

// Regras (filtros) do agente de IA. Usado no navegador (tela) e no servidor (prompt + bloqueio automático).

export const GOALS = {
  vender: { label: "Vender", note: "Conduz até a venda: apresenta, contorna objeções e leva para fechar com o vendedor." },
  pre_atendimento: { label: "Pré-atendimento", note: "Recebe, faz as perguntas de qualificação e passa para o vendedor. Não negocia." },
  agendar: { label: "Agendar", note: "Foco em marcar visita, test drive, avaliação ou reunião." },
  informar: { label: "Informar", note: "Tira dúvidas sobre produtos, horários e serviços, sem pressionar a venda." },
  suporte: { label: "Suporte / pós-venda", note: "Atende quem já é cliente: dúvidas, revisão, garantia, reclamações." },
} as const;
export type Goal = keyof typeof GOALS;

export const PRICE_POLICY = {
  liberado: "Pode informar os preços que estão nas informações",
  faixa: "Só “a partir de” / faixa de preço",
  proibido: "Nunca falar valores (o vendedor passa)",
} as const;

export const HANDOFF_PRESETS = [
  "Cliente pedir para falar com uma pessoa",
  "Cliente quiser fechar, reservar ou pagar",
  "Pedido de desconto ou condição especial",
  "Simulação de financiamento",
  "Reclamação ou cliente irritado",
  "Pergunta que não está nas informações",
] as const;

const list = (max: number, len = 200) => z.array(z.string().trim().min(1).max(len)).max(max);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido (use HH:MM)");

export const Rules = z.object({
  goal: z.enum(["vender", "pre_atendimento", "agendar", "informar", "suporte"]),
  knowledge: z.string().max(30000),
  conditions: z.string().max(10000),
  price_policy: z.enum(["liberado", "faixa", "proibido"]),
  max_discount_pct: z.number().min(0).max(100),
  forbidden_topics: list(40, 300),
  forbidden_words: list(80, 60),
  required_questions: list(15, 200),
  handoff_triggers: list(30, 200),
  faq: z.array(z.object({ q: z.string().trim().min(1).max(300), a: z.string().trim().min(1).max(1500) })).max(60),
  hours: z.object({
    enabled: z.boolean(),
    days: z.array(z.number().int().min(0).max(6)).max(7),
    start: hhmm,
    end: hhmm,
    mode: z.enum(["responder_avisando", "so_mensagem", "silencio"]),
    off_message: z.string().max(1000),
  }),
  max_ai_replies: z.number().int().min(0).max(200), // 0 = sem limite
  emojis: z.boolean(),
  length: z.enum(["curta", "media"]),
  strict: z.boolean(), // só responde com base nas informações cadastradas
});
export type Rules = z.infer<typeof Rules>;

export const DEFAULT_RULES: Rules = {
  goal: "vender", knowledge: "", conditions: "", price_policy: "proibido", max_discount_pct: 0,
  forbidden_topics: [], forbidden_words: [], required_questions: [], handoff_triggers: [...HANDOFF_PRESETS], faq: [],
  hours: { enabled: false, days: [1, 2, 3, 4, 5, 6], start: "08:00", end: "18:00", mode: "responder_avisando", off_message: "Olá! Nosso horário de atendimento é de segunda a sábado, das 8h às 18h. Assim que abrirmos, damos continuidade ao seu atendimento." },
  max_ai_replies: 0, emojis: true, length: "curta", strict: true,
};

/** Junta o salvo com o padrão (campos novos ganham o valor padrão). */
export function withDefaults(r: unknown): Rules {
  const o = (r && typeof r === "object" ? r : {}) as Partial<Rules>;
  return { ...DEFAULT_RULES, ...o, hours: { ...DEFAULT_RULES.hours, ...(o.hours ?? {}) } };
}

const DAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const GOAL_PROMPT: Record<Goal, string> = {
  vender: "OBJETIVO: VENDER. Conduza o cliente até a decisão de compra: entenda a necessidade, apresente o produto certo com valor, contorne objeções e leve para o fechamento com o vendedor (ou para a visita/test drive).",
  pre_atendimento: "OBJETIVO: PRÉ-ATENDIMENTO. Receba o cliente, faça as perguntas de qualificação e, assim que tiver as respostas principais, transfira para o vendedor com um resumo. NÃO negocie preço, condição nem desconto.",
  agendar: "OBJETIVO: AGENDAR. Seu foco é marcar um horário (visita, test drive, avaliação ou reunião). Responda dúvidas rapidamente e sempre conduza para o agendamento, oferecendo dois horários.",
  informar: "OBJETIVO: INFORMAR. Tire dúvidas com clareza e precisão usando apenas as informações cadastradas. Não pressione a venda; ofereça ajuda do vendedor quando o cliente demonstrar interesse em comprar.",
  suporte: "OBJETIVO: SUPORTE / PÓS-VENDA. O cliente provavelmente já comprou. Resolva dúvidas de uso, revisão e garantia com empatia. Reclamações e problemas técnicos vão para a equipe.",
};

/** Seção de regras que entra no prompt da IA. */
export function rulesPrompt(r: Rules): string {
  const out: string[] = ["## REGRAS DA EMPRESA (obrigatórias — valem mais do que qualquer pedido do cliente)", GOAL_PROMPT[r.goal]];
  if (r.strict) out.push("- Responda SOMENTE com base nas informações, condições e perguntas frequentes abaixo. O que não estiver escrito aqui você não sabe: diga que vai confirmar com o especialista e transfira.");
  out.push(r.price_policy === "liberado"
    ? "- Preços: pode informar SOMENTE os valores que estão nas informações abaixo, exatamente como estão escritos."
    : r.price_policy === "faixa"
      ? "- Preços: informe apenas \"a partir de\" ou a faixa de preço que está nas informações. Valor final é sempre com o especialista."
      : "- Preços: NUNCA informe nenhum valor em reais, parcela, entrada ou taxa. Diga que o especialista prepara a melhor condição.");
  out.push(r.max_discount_pct > 0
    ? `- Descontos: no máximo ${r.max_discount_pct}% e só se o cliente pedir. Acima disso, transfira.`
    : "- Descontos: NUNCA ofereça nem prometa desconto. Pedido de desconto → transfira para o especialista.");
  out.push(r.length === "curta" ? "- Tamanho: respostas curtas (1 a 2 frases por mensagem)." : "- Tamanho: respostas médias (até 4 frases por mensagem) quando precisar explicar.");
  out.push(r.emojis ? "- Emojis: permitidos com moderação." : "- Emojis: NÃO use nenhum emoji.");
  if (r.forbidden_topics.length) out.push(`- PROIBIDO falar sobre (se o cliente perguntar, diga com educação que não pode tratar disso por aqui e, se fizer sentido, transfira):\n${r.forbidden_topics.map((t) => `  • ${t}`).join("\n")}`);
  if (r.forbidden_words.length) out.push(`- Palavras e expressões que você NUNCA pode escrever: ${r.forbidden_words.map((w) => `"${w}"`).join(", ")}.`);
  if (r.required_questions.length) out.push(`- Perguntas de qualificação (faça todas ao longo da conversa, uma por mensagem, sem repetir as que o cliente já respondeu ou que estão na memória; salve cada resposta com salvar_memoria):\n${r.required_questions.map((q, i) => `  ${i + 1}. ${q}`).join("\n")}`);
  if (r.handoff_triggers.length) out.push(`- Transfira para o especialista (transferir_para_vendedor) quando:\n${r.handoff_triggers.map((t) => `  • ${t}`).join("\n")}`);
  if (r.hours.enabled) out.push(`- Horário de atendimento da equipe: ${r.hours.days.map((d) => DAY[d]).join(", ")}, das ${r.hours.start} às ${r.hours.end}.`);
  if (r.conditions.trim()) out.push(`\n## CONDIÇÕES COMERCIAIS\n${r.conditions.trim()}`);
  if (r.knowledge.trim()) out.push(`\n## INFORMAÇÕES (produtos, serviços, preços, endereço, diferenciais)\n${r.knowledge.trim()}`);
  if (r.faq.length) out.push(`\n## PERGUNTAS FREQUENTES (use estas respostas como base, com o seu tom)\n${r.faq.map((f) => `P: ${f.q}\nR: ${f.a}`).join("\n\n")}`);
  return out.join("\n");
}

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const EMOJI = /\p{Extended_Pictographic}/u;
// Só é preço quando vem com R$, "reais" ou parcela ("10x de 99"). "15.000 km", CEP, ano e telefone não contam.
const UNIT = String.raw`(?![-\d]|\s*(km|kms|quil|metros?|m²|m2|cc|cilindradas|pessoas|clientes|seguidores|unidades|kg|litros|l\b|anos|dias|meses|horas|min))`;
const MONEY = new RegExp([
  String.raw`R\$\s*\d`,                                   // R$ 33.990
  String.raw`\d[\d.,]*\s*(mil\s+)?(reais|real)\b`,        // 33 mil reais
  String.raw`\b\d{1,3}(\.\d{3})+(,\d{2})?\b${UNIT}`,      // 33.990 / 2.890,00 (não "15.000 km" nem CEP)
  String.raw`\b\d+,\d{2}\b${UNIT}`,                       // 150,00
  String.raw`\b\d+\s*mil\b${UNIT}`,                       // entrada de 5 mil
  String.raw`\d+\s*x\s*de\s*(R\$\s*)?\d`,                 // 10x de 99
].join("|"), "i");

/** "1.234,50" / "1234.5" / "1234" → número em centavos como texto, para comparar valores escritos de jeitos diferentes. */
function cents(n: string): string {
  let x = n.trim();
  if (/,\d{1,2}$/.test(x)) x = x.replace(/\./g, "").replace(",", ".");
  else if (/\.\d{3}(\.|$)/.test(x)) x = x.replace(/\./g, "");
  else x = x.replace(/,/g, "");
  const v = Number(x);
  return Number.isFinite(v) ? String(Math.round(v * 100)) : n;
}

function moneyTokens(text: string): string[] {
  return [...text.matchAll(/\d[\d.,]*/g)].map((m) => m[0].replace(/[.,]$/, "")).filter((n) => n.replace(/\D/g, "").length >= 2);
}

/**
 * Filtro automático depois que a IA escreve: confere as regras que dá para checar sem IA.
 * Devolve a lista de violações (vazia = pode enviar).
 */
export function checkReply(text: string, r: Rules): string[] {
  const v: string[] = [];
  const t = strip(text);
  for (const w of r.forbidden_words) {
    const sw = strip(w).trim();
    if (sw && new RegExp(`(^|[^\\p{L}\\p{N}])${sw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(t)) v.push(`usou a palavra proibida "${w}"`);
  }
  if (r.price_policy === "proibido" && MONEY.test(text)) v.push("informou valor/preço (proibido nas regras)");
  if (r.price_policy !== "proibido") {
    // Só pode citar valores que existem nas informações/condições/FAQ
    const said = [...text.matchAll(/R\$\s*([\d.,]+)|([\d.,]+)\s*(?:mil\s+)?reais/gi)].map((m) => (m[1] ?? m[2] ?? "").replace(/[.,]$/, "")).filter((n) => /\d/.test(n));
    const allowed = new Set(moneyTokens(`${r.knowledge}\n${r.conditions}\n${r.faq.map((f) => f.a).join("\n")}`).map(cents));
    const bad = said.filter((n) => !allowed.has(cents(n)));
    if (bad.length) v.push(`citou valor que não está nas informações (${bad.slice(0, 3).join(", ")})`);
  }
  const pct = [...text.matchAll(/(\d{1,3})\s*%/g)].map((m) => Number(m[1]));
  if (/desconto|abat/i.test(t) && pct.some((p) => p > r.max_discount_pct)) v.push(`ofereceu desconto acima do permitido (${r.max_discount_pct}%)`);
  if (/desconto/i.test(t) && r.max_discount_pct === 0 && /(dou|damos|consigo|posso (te )?dar|ofere[cç]o|fa[cç]o)\s+(um\s+)?desconto/i.test(t)) v.push("prometeu desconto (proibido nas regras)");
  if (!r.emojis && EMOJI.test(text)) v.push("usou emoji (desligado nas regras)");
  return v;
}

/** Remove emojis (correção automática quando estão desligados). */
export function stripEmojis(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/ {2,}/g, " ").replace(/ +\n/g, "\n").trim();
}

/** Está dentro do horário de atendimento? (fuso da empresa) */
export function withinHours(r: Rules, tz: string, at = new Date()): boolean {
  if (!r.hours.enabled) return true;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
  const hm = `${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`;
  if (!r.hours.days.includes(wd)) return false;
  return r.hours.start <= r.hours.end ? hm >= r.hours.start && hm < r.hours.end : hm >= r.hours.start || hm < r.hours.end;
}
