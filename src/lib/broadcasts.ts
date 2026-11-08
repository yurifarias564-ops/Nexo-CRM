/**
 * Regras dos disparos usadas no navegador e no servidor: preço da Meta, variáveis,
 * ordem das mensagens e ritmo de envio.
 */

export type BroadcastStatus = "scheduled" | "sending" | "paused" | "done" | "canceled";
export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export interface Audience {
  tagIds: string[];
  stageIds: string[];
  /** Sem movimento há pelo menos N meses (mensagem, mudança de etapa ou criação). */
  idleMonths: number | null;
  leadIds: string[];
  excludeLeadIds: string[];
}

export interface MediaItem { path: string; mime: string; kind: "image" | "video" | "audio" | "document"; name: string; size: number }

export interface BroadcastRow {
  id: string;
  name: string;
  channel_id: string;
  provider: "meta" | "zapi" | "evolution";
  status: BroadcastStatus;
  audience: Audience & { label?: string };
  body: string | null;
  media: MediaItem[];
  template_name: string | null;
  template_language: string | null;
  template_category: TemplateCategory | null;
  template_params: TemplateParam[];
  template_header: MediaItem | null;
  send_at: string;
  interval_seconds: number;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  cost_currency: string | null;
  cost_unit: number | null;
  cost_estimated: number | null;
  cost_other_country: number;
  started_at: string | null;
  finished_at: string | null;
  canceled_at: string | null;
  created_at: string;
}

/** Valor de cada {{n}} do modelo: o nome do lead, o primeiro nome ou um texto fixo. */
export type TemplateParam = { kind: "name" | "first_name" } | { kind: "text"; value: string };

/**
 * Preço oficial da Meta por mensagem entregue para números do Brasil (+55),
 * por categoria do modelo. Vigente desde 1/10/2026 (listas "BRL" e "USD" da Meta).
 * Mensagem que falha não é cobrada. Utilidade e autenticação podem ter desconto
 * por volume mensal; marketing não tem desconto.
 */
export const META_BR_RATES = {
  since: "2026-10-01",
  BRL: { MARKETING: 0.3217, UTILITY: 0.035, AUTHENTICATION: 0.035 },
  USD: { MARKETING: 0.0625, UTILITY: 0.0068, AUTHENTICATION: 0.0068 },
} as const;

export interface CostEstimate {
  currency: "BRL" | "USD" | null;
  unit: number | null;
  brazil: number;
  otherCountry: number;
  total: number | null;
}

/** Custo máximo do disparo pela API oficial: destinatários do Brasil × preço da categoria na moeda da conta. */
export function estimateCost(phones: string[], category: TemplateCategory, accountCurrency: string | null): CostEstimate {
  const brazil = phones.filter((p) => p.replace(/\D/g, "").startsWith("55")).length;
  const otherCountry = phones.length - brazil;
  const currency = accountCurrency === "BRL" || accountCurrency === "USD" ? accountCurrency : null;
  if (!currency) return { currency: null, unit: null, brazil, otherCountry, total: null };
  const unit = META_BR_RATES[currency][category];
  return { currency, unit, brazil, otherCountry, total: Math.round(brazil * unit * 100) / 100 };
}

export function formatMoney(v: number, currency: "BRL" | "USD") {
  return v.toLocaleString("pt-BR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: v < 1 && v > 0 ? 4 : 2 });
}

/** Troca {{nome}} e {{primeiro_nome}} pelo nome do lead. */
export function renderVars(text: string, name: string | null) {
  const full = (name ?? "").trim();
  const first = full.split(/\s+/)[0] ?? "";
  return text.replace(/\{\{\s*primeiro_nome\s*\}\}/gi, first).replace(/\{\{\s*nome\s*\}\}/gi, full).replace(/[ \t]+([,.!?])/g, "$1").trim();
}

export function templateParamValues(params: TemplateParam[], name: string | null): string[] {
  const full = (name ?? "").trim() || "cliente";
  return params.map((p) => (p.kind === "text" ? p.value : p.kind === "name" ? full : full.split(/\s+/)[0]!));
}

/**
 * Ordem das mensagens no WhatsApp por QR Code: as mídias na ordem escolhida; o texto
 * vai como legenda da primeira foto ou vídeo. Sem foto/vídeo, o texto vai separado,
 * depois das mídias (áudio e documento não têm legenda).
 */
export type Step = { kind: "media"; index: number; withText: boolean } | { kind: "text" };
export function planSteps(hasText: boolean, media: { kind: MediaItem["kind"] }[]): Step[] {
  const capIdx = hasText ? media.findIndex((m) => m.kind === "image" || m.kind === "video") : -1;
  const steps: Step[] = media.map((_, i) => ({ kind: "media", index: i, withText: i === capIdx }));
  if (hasText && capIdx === -1) steps.push({ kind: "text" });
  return steps;
}

/** Ritmo do disparo. No QR Code, ir devagar reduz o risco de o WhatsApp bloquear o número. */
export const PACES = [
  { id: "safe", label: "Seguro", hint: "1 mensagem a cada ~30 s (≈120 por hora)", seconds: 30 },
  { id: "normal", label: "Normal", hint: "1 mensagem a cada ~15 s (≈240 por hora)", seconds: 15 },
  { id: "fast", label: "Rápido", hint: "1 mensagem a cada ~6 s (≈600 por hora). Mais risco de bloqueio.", seconds: 6 },
] as const;

/** Espera entre mensagens com variação de ±40% (parece menos com robô). `r` entre 0 e 1. */
export function jitter(seconds: number, r: number) {
  if (seconds <= 0) return 0;
  return Math.max(1, Math.round(seconds * (0.6 + 0.8 * r)));
}

/** Previsão de quanto tempo o disparo leva. */
export function durationLabel(total: number, intervalSeconds: number) {
  const secs = intervalSeconds > 0 ? total * intervalSeconds : Math.ceil(total / 60) * 60;
  if (secs < 90) return "cerca de 1 minuto";
  const min = Math.round(secs / 60);
  if (min < 60) return `cerca de ${min} minutos`;
  const h = Math.floor(min / 60), m = min % 60;
  return `cerca de ${h}h${m ? ` ${m}min` : ""}`;
}

export function idleBefore(months: number | null, now = new Date()) {
  if (!months || months <= 0) return null;
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

export const STATUS_LABEL: Record<BroadcastStatus, string> = {
  scheduled: "Agendado", sending: "Enviando", paused: "Pausado", done: "Concluído", canceled: "Cancelado",
};

export const MAX_RECIPIENTS = 5000;
