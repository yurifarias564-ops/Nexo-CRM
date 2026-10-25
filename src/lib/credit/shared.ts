import { z } from "zod";

// Análise de crédito: regras puras (usadas no servidor, na tela e nos testes).

export const PROVIDERS = {
  directd: {
    label: "Direct Data — Score de crédito (Boa Vista / Quod)",
    text: "Consulta o score e a capacidade de pagamento do CPF. Cadastro na Direct Data, paga por consulta (cerca de R$ 2). Cole o token de acesso.",
    needsCredential: true, needsUrl: false,
  },
  bancos: {
    label: "Bancos — Santander, BV, PAN, Safra, Itaú, Bradesco… (plataforma multibanco)",
    text: "A ficha vai para todos os bancos em que a loja é credenciada, por uma plataforma multibanco (Zinix, Credere) ou um fluxo do n8n. Cada banco responde (na hora ou minutos depois) e o CRM mostra quem aprovou.",
    needsCredential: true, needsUrl: true,
  },
  webhook: {
    label: "Sistema próprio ou correspondente (API / n8n)",
    text: "O CRM envia os dados para o endereço que você indicar (seu sistema, o do banco/correspondente ou um fluxo do n8n) e recebe a resposta de aprovação.",
    needsCredential: false, needsUrl: true,
  },
  manual: {
    label: "Sem consulta automática (ficha para o vendedor)",
    text: "A IA coleta os dados e monta a ficha de financiamento; o vendedor faz a análise no banco.",
    needsCredential: false, needsUrl: false,
  },
} as const;
export type CreditProvider = keyof typeof PROVIDERS;

/** Bancos de financiamento de veículos (a loja marca onde é credenciada). */
export const BANKS = ["Santander", "BV", "PAN", "Safra", "Itaú", "Bradesco", "C6", "Creditas", "Daycoval", "Omni", "Banco Honda", "Banco Yamaha", "Banco Volkswagen", "Banco Toyota", "Porto Bank"] as const;

export type BankStatus = "aprovado" | "analise" | "reprovado";
export interface BankResult { banco: string; status: BankStatus; parcela: number | null; taxa: number | null; prazo: number | null; valor_liberado: number | null; mensagem: string | null }

const BANK_WORDS: [RegExp, BankStatus][] = [
  [/^(aprovad|approv|pre.?aprovad|liberad|sim$|true$)/i, "aprovado"],
  [/^(reprovad|negad|recusad|denied|reject|nao$|não$|false$)/i, "reprovado"],
];
export function bankStatus(v: unknown): BankStatus {
  const w = String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  return BANK_WORDS.find(([re]) => re.test(w))?.[1] ?? "analise";
}
function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let t = String(v ?? "").replace(/[^\d.,-]/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", "."); // 1.234,56 (formato brasileiro)
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Lê a lista de bancos de respostas em formatos diferentes (bancos/banks/resultados/simulacoes). */
export function parseBanks(j: Record<string, unknown>): BankResult[] {
  const list = (j.bancos ?? j.banks ?? j.resultados ?? j.simulacoes ?? j.results) as unknown;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 40).map((b) => {
    const o = (b ?? {}) as Record<string, unknown>;
    return {
      banco: String(o.banco ?? o.bank ?? o.instituicao ?? o.nome ?? "Banco").slice(0, 60),
      status: bankStatus(o.status ?? o.resultado ?? o.situacao ?? o.aprovado),
      parcela: numOrNull(o.parcela ?? o.valor_parcela ?? o.installment),
      taxa: numOrNull(o.taxa ?? o.taxa_mensal ?? o.rate),
      prazo: numOrNull(o.prazo ?? o.parcelas ?? o.months),
      valor_liberado: numOrNull(o.valor_liberado ?? o.valor_financiado ?? o.amount),
      mensagem: o.mensagem ?? o.motivo ?? o.message ? String(o.mensagem ?? o.motivo ?? o.message).slice(0, 200) : null,
    };
  });
}

/** Algum banco aprovou → pré-aprovado; todos recusaram → não aprovado; senão em análise. */
export function overallFromBanks(list: BankResult[]): BankStatus | null {
  if (!list.length) return null;
  if (list.some((b) => b.status === "aprovado")) return "aprovado";
  if (list.every((b) => b.status === "reprovado")) return "reprovado";
  return "analise";
}

export const CreditSettings = z.object({
  enabled: z.boolean(),
  provider: z.enum(["directd", "bancos", "webhook", "manual"]),
  banks: z.array(z.string().trim().min(1).max(60)).max(40),
  webhook_url: z.string().trim().max(500).nullable().transform((v) => v || null)
    .refine((v) => !v || v.startsWith("https://"), "Use um endereço https://"),
  min_score: z.number().int().min(0).max(1000),
  review_score: z.number().int().min(0).max(1000),
  max_income_pct: z.number().min(5).max(100),
  monthly_rate: z.number().min(0).max(15),
  handoff: z.boolean(),
  max_per_day: z.number().int().min(1).max(5000),
}).refine((s) => s.review_score <= s.min_score, { message: "O score de \"em análise\" precisa ser menor ou igual ao de aprovação", path: ["review_score"] })
  .refine((s) => !["webhook", "bancos"].includes(s.provider) || Boolean(s.webhook_url), { message: "Informe o endereço do sistema de crédito / plataforma de bancos", path: ["webhook_url"] })
  .refine((s) => s.provider !== "bancos" || s.banks.length > 0, { message: "Marque os bancos em que a loja é credenciada", path: ["banks"] });
export type CreditSettings = z.infer<typeof CreditSettings>;

export const CREDIT_DEFAULTS: CreditSettings = {
  enabled: false, provider: "manual", banks: [], webhook_url: null, min_score: 600, review_score: 400,
  max_income_pct: 30, monthly_rate: 2, handoff: true, max_per_day: 50,
};

/** Dados que a IA (ou o teste) coletou do cliente. */
export const CreditInput = z.object({
  cpf: z.string().trim().max(20),
  income: z.number().min(0).max(1e7),
  vehicle_value: z.number().min(0).max(1e8),
  down_payment: z.number().min(0).max(1e8),
  months: z.number().int().min(1).max(120),
});
export type CreditInput = z.infer<typeof CreditInput>;

export type CreditStatus = "aprovado" | "analise" | "reprovado" | "erro";
export const STATUS_LABEL: Record<CreditStatus, string> = { aprovado: "Pré-aprovado", analise: "Em análise", reprovado: "Não aprovado", erro: "Erro na consulta" };
export const STATUS_TAG: Record<Exclude<CreditStatus, "erro">, string> = { aprovado: "Crédito pré-aprovado", analise: "Crédito em análise", reprovado: "Crédito não aprovado" };

export const cpfDigits = (raw: string) => raw.replace(/\D/g, "");

export function isCpf(raw: string): boolean {
  const d = cpfDigits(raw);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (len: number) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

/** 123.456.789-09 → ***.456.789-** */
export function maskCpf(raw: string): string {
  const d = cpfDigits(raw);
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : "***";
}

/** Parcela pela tabela Price: valor financiado, taxa ao mês (%), número de parcelas. */
export function installment(financed: number, ratePct: number, months: number): number {
  if (financed <= 0) return 0;
  const i = ratePct / 100;
  const p = i === 0 ? financed / months : (financed * i) / (1 - (1 + i) ** -months);
  return Math.round(p * 100) / 100;
}

export interface ProviderResult {
  score: number | null;
  band: string | null;
  capacity: string | null;
  /** Resposta direta do sistema da loja/banco, quando ele já decide. */
  status: Exclude<CreditStatus, "erro"> | null;
  reasons: string[];
  banks?: BankResult[];
  externalId?: string | null;
  /** Os bancos ainda vão responder (resultado chega depois no endereço de retorno). */
  pending?: boolean;
}

/** Aplica a regra da loja: score + parcela x renda (+ decisão do sistema externo, se houver). */
export function decide(s: Pick<CreditSettings, "min_score" | "review_score" | "max_income_pct" | "monthly_rate">, input: CreditInput, r: ProviderResult) {
  const financed = Math.max(0, input.vehicle_value - input.down_payment);
  const parcel = installment(financed, s.monthly_rate, input.months);
  const pct = input.income > 0 ? (parcel / input.income) * 100 : Infinity;
  const reasons = [...r.reasons];
  let status: Exclude<CreditStatus, "erro">;
  if (r.status) status = r.status;
  else if (r.score === null) status = "analise";
  else if (r.score >= s.min_score) status = "aprovado";
  else if (r.score >= s.review_score) status = "analise";
  else status = "reprovado";
  if (r.score !== null && !r.status) reasons.push(`score ${r.score} (aprova a partir de ${s.min_score})`);
  // Parcela acima do limite da renda: no máximo "em análise" (o vendedor ajusta entrada/prazo)
  if (financed > 0 && pct > s.max_income_pct) {
    reasons.push(input.income > 0 ? `parcela estimada compromete ${Math.round(pct)}% da renda (limite ${s.max_income_pct}%)` : "renda não informada");
    if (status === "aprovado") status = "analise";
  }
  return { status, installment: parcel, financed, incomePct: Number.isFinite(pct) ? Math.round(pct) : null, reasons };
}

/** O que a IA pode dizer ao cliente (nunca score, nunca "reprovado"). */
export function customerGuidance(status: Exclude<CreditStatus, "erro">, handoff: boolean): string {
  const next = handoff ? " Em seguida avise que o especialista dará continuidade em instantes (a conversa já foi passada para ele)." : "";
  if (status === "aprovado") return `Resultado: PRÉ-ANÁLISE POSITIVA. Diga ao cliente, com entusiasmo e elegância, que a pré-análise foi positiva e que o especialista vai confirmar as condições finais com o banco. Não prometa aprovação definitiva, taxa nem parcela.${next}`;
  if (status === "analise") return `Resultado: EM ANÁLISE. Diga ao cliente que a pré-análise foi registrada e que o especialista vai finalizar a análise e apresentar a melhor condição. Não cite score nem motivo.${next}`;
  return `Resultado: NÃO APROVADO NESTE MOMENTO (informação interna). NÃO diga "reprovado" nem cite score, restrição ou motivo. Diga com empatia que o especialista vai buscar a melhor alternativa para o caso (por exemplo, outra condição de entrada, prazo ou outro banco).${next}`;
}
