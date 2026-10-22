import "server-only";
import { z } from "zod";
import { HttpError } from "@/lib/http";
import { callTool } from "./claude";
import type { Blueprint } from "./blueprint";
import type { ReportData } from "./data";

export const WrittenReport = z.object({
  title: z.string().min(1).max(200),
  headline: z.string().min(1).max(600),
  sections: z.array(z.object({
    title: z.string().min(1).max(160),
    paragraphs: z.array(z.string().max(3000)).default([]),
    bullets: z.array(z.string().max(600)).default([]),
  })).min(1).max(20),
  goal_comments: z.array(z.object({ metric: z.string(), comment: z.string().max(800) })).default([]),
  next_steps: z.array(z.string().max(400)).max(10).default([]),
  whatsapp_caption: z.string().max(900),
});
export type WrittenReport = z.infer<typeof WrittenReport>;

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Texto com os números já formatados — a IA só pode usar o que está aqui. */
export function factSheet(d: ReportData): string {
  const c = d.current;
  const p = d.previous;
  const delta = (a: number, b: number) => (b === 0 ? (a === 0 ? "igual" : "novo") : `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%`);
  const lines = [
    `Cliente: ${d.orgName}`,
    `Período: ${d.periodLabel}`,
    "",
    "NÚMEROS DO MÊS (atual | mês anterior | variação):",
    `- Leads recebidos: ${c.new_leads} | ${p.new_leads} | ${delta(c.new_leads, p.new_leads)}`,
    `- Vendas: ${c.won_count} | ${p.won_count} | ${delta(c.won_count, p.won_count)}`,
    `- Faturamento das vendas: ${brl(c.won_value)} | ${brl(p.won_value)} | ${delta(c.won_value, p.won_value)}`,
    `- Negócios perdidos: ${c.lost_count} | ${p.lost_count}`,
    `- Taxa de conversão (ganhos/(ganhos+perdidos)): ${c.conversion ?? "sem fechamentos"}${c.conversion !== null ? "%" : ""} | ${p.conversion ?? "—"}${p.conversion !== null ? "%" : ""}`,
    `- Ligações feitas: ${c.calls} (atendidas: ${c.calls_answered}) | ${p.calls}`,
    `- Mensagens de follow-up automáticas enviadas: ${c.scheduled_sent} | ${p.scheduled_sent}`,
    `- Follow-ups totais (ligações + mensagens agendadas): ${c.followups} | ${p.followups} | ${delta(c.followups, p.followups)}`,
    `- Agendamentos marcados: ${c.appointments} (realizados: ${c.appointments_held}) | ${p.appointments}`,
    `- Mensagens no WhatsApp: ${c.messages_in} recebidas, ${c.messages_out} enviadas | ${p.messages_in} / ${p.messages_out}`,
    `- Em negociação agora: ${c.open_count} leads, ${brl(c.open_value)}`,
    "",
    `Origem dos leads: ${c.by_source.map((s) => `${s.name} ${s.count}`).join(", ") || "sem leads"}`,
    `Vendas por origem: ${c.won_by_source.map((s) => `${s.name} ${s.count} (${brl(s.value)})`).join(", ") || "sem vendas"}`,
    `Funil hoje: ${c.by_stage.map((s) => `${s.name} ${s.count}`).join(" → ") || "—"}`,
    `Vendas por vendedor: ${c.won_by_owner.map((s) => `${s.name} ${s.count} (${brl(s.value)})`).join(", ") || "sem vendas"}`,
    "",
    "METAS DO MÊS (resultado JÁ CALCULADO — não altere):",
    ...(d.goals.length
      ? d.goals.map((g) => `- [${g.metric}] ${g.label}: meta ${g.money ? brl(g.target) : g.target}, realizado ${g.money ? brl(g.actual) : g.actual} (${g.pct}%) → ${g.hit ? "BATEU" : "NÃO BATEU"}`)
      : ["- Nenhuma meta cadastrada para este mês."]),
    "",
    `COMENTÁRIOS DO CONSULTOR SOBRE O MÊS: ${d.notes.trim() || "(nenhum)"}`,
  ];
  return lines.join("\n");
}

export async function writeReport(blueprint: Blueprint, d: ReportData): Promise<WrittenReport> {
  const raw = await callTool<unknown>({
    system: [
      "Você é um consultor comercial sênior escrevendo o relatório mensal de resultados para o dono de uma empresa cliente, em português do Brasil.",
      "Siga EXATAMENTE a estrutura, ordem de seções, tom e convenções do modelo abaixo.",
      "REGRAS INEGOCIÁVEIS:",
      "1. Use SOMENTE os números da ficha de dados. Nunca invente, arredonde de forma diferente ou estime números.",
      "2. O resultado das metas (BATEU / NÃO BATEU) já está calculado: não contradiga.",
      "3. Para cada meta, explique o porquê com base nos números (ex.: volume de leads, conversão, follow-ups, comparação com o mês anterior) e nos comentários do consultor. Se não houver dado suficiente para explicar, diga isso com honestidade em vez de inventar causas.",
      "4. Se uma seção do modelo pede um dado que não existe na ficha, escreva que o dado não é acompanhado no sistema.",
      "5. Linguagem clara, profissional e direta; sem emojis no corpo do relatório (eles podem aparecer só na legenda do WhatsApp se o modelo usar).",
      "",
      `MODELO:\n${JSON.stringify(blueprint, null, 2)}`,
    ].join("\n"),
    content: [{ type: "text", text: `FICHA DE DADOS:\n${factSheet(d)}\n\nEscreva o relatório.` }],
    maxTokens: 8000,
    tool: {
      name: "write_report",
      description: "Entrega o relatório escrito",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Título do relatório para este cliente e mês" },
          headline: { type: "string", description: "Resumo executivo em 1 a 3 frases" },
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                paragraphs: { type: "array", items: { type: "string" } },
                bullets: { type: "array", items: { type: "string" } },
              },
              required: ["title"],
            },
          },
          goal_comments: {
            type: "array",
            description: "Uma explicação por meta da ficha (use a chave entre colchetes em metric)",
            items: { type: "object", properties: { metric: { type: "string" }, comment: { type: "string" } }, required: ["metric", "comment"] },
          },
          next_steps: { type: "array", items: { type: "string" }, description: "Plano de ação para o próximo mês" },
          whatsapp_caption: { type: "string", description: "Mensagem curta para acompanhar o PDF no grupo do cliente" },
        },
        required: ["title", "headline", "sections", "whatsapp_caption"],
      },
    },
  });
  const parsed = WrittenReport.safeParse(raw);
  if (!parsed.success) throw new HttpError(502, "A IA devolveu o relatório em formato inesperado. Tente novamente.");
  return parsed.data;
}
