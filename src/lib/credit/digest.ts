import type { BankResult } from "./shared";

// Resumo das análises de crédito para o WhatsApp do vendedor (função pura, testável).

const brl = (v: unknown) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export interface DigestRow {
  lead: string; phone: string | null; status: string; provider: string; reasons: string[]; banks: BankResult[];
  vehicle_value: number | null; down_payment: number | null; months: number | null; installment: number | null; conversation_id: string | null;
}

export function buildDigest(rows: DigestRow[], base: string) {
  const line = (r: (typeof rows)[number]) => {
    const bank = r.banks.find((b) => b.status === "aprovado")?.banco;
    const deal = r.vehicle_value ? ` · ${brl(r.vehicle_value)}, entrada ${brl(r.down_payment)}${r.months && r.installment ? `, ${r.months}x ${brl(r.installment)}` : ""}` : "";
    const why = r.status !== "aprovado" && r.reasons.length ? ` — ${r.reasons[0]}` : "";
    return `• ${r.lead}${r.phone ? ` (${r.phone})` : ""}${bank ? ` · ${bank}` : ""}${deal}${why}${r.conversation_id ? `\n  ${base}/inbox?c=${r.conversation_id}` : ""}`;
  };
  const ok = rows.filter((r) => r.status === "aprovado"), wait = rows.filter((r) => r.status === "analise"), no = rows.filter((r) => r.status === "reprovado");
  return [
    `☀️ *Bom dia! Análises de crédito feitas pela IA*`,
    `${rows.length} cliente(s): ✅ ${ok.length} pré-aprovado(s) · ⏳ ${wait.length} em negociação · ❌ ${no.length} não aprovado(s)`,
    ok.length ? `\n*✅ Pré-aprovados — foque nestes primeiro:*\n${ok.map(line).join("\n")}` : "",
    wait.length ? `\n*⏳ Em negociação (entrada/parcela):*\n${wait.map(line).join("\n")}` : "",
    no.length ? `\n*❌ Não aprovados:*\n${no.map(line).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

