import "server-only";
import { z } from "zod";
import { HttpError } from "@/lib/http";
import { callTool } from "./claude";

/** Métricas que o sistema sabe calcular (a IA só pode pedir estas). */
export const METRIC_KEYS = [
  "new_leads", "won_count", "won_value", "lost_count", "conversion", "calls", "calls_answered", "scheduled_sent", "followups",
  "appointments", "appointments_held", "messages_in", "messages_out", "open_count", "open_value",
  "by_source", "won_by_source", "by_stage", "won_by_owner", "goals", "team",
] as const;

export const Blueprint = z.object({
  title: z.string().max(200),
  tone: z.string().max(600),
  audience: z.string().max(300).default(""),
  sections: z.array(z.object({
    title: z.string().min(1).max(160),
    purpose: z.string().max(800),
    style: z.enum(["paragraph", "bullets", "table", "mixed"]).default("mixed"),
    metrics: z.array(z.enum(METRIC_KEYS)).default([]),
  })).min(1).max(20),
  extra_instructions: z.string().max(2000).default(""),
});
export type Blueprint = z.infer<typeof Blueprint>;

export const ALLOWED_TEMPLATE_TYPES: Record<string, "pdf" | "docx" | "text"> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "text",
  "text/markdown": "text",
};
export const MAX_TEMPLATE_BYTES = 15 * 1024 * 1024;

export function templateKind(mime: string, name: string): "pdf" | "docx" | "text" | null {
  const byMime = ALLOWED_TEMPLATE_TYPES[mime];
  if (byMime) return byMime;
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "txt" || ext === "md") return "text";
  return null;
}

const METRIC_HELP = `Métricas disponíveis (use as chaves exatas):
new_leads=leads que chegaram; won_count/won_value=vendas (quantidade/valor); lost_count=perdidos; conversion=taxa de conversão;
calls/calls_answered=ligações feitas/atendidas; scheduled_sent=mensagens de follow-up automáticas enviadas; followups=total de follow-ups (ligações + mensagens agendadas);
appointments/appointments_held=agendamentos marcados/realizados; messages_in/messages_out=mensagens recebidas/enviadas;
open_count/open_value=negócios em aberto; by_source=origem dos leads; won_by_source=vendas por origem; by_stage=funil por etapa;
won_by_owner=vendas por vendedor; goals=metas do mês (batidas ou não); team=checklist do time comercial por vendedora (contatos, vídeos, ligações etc. x meta).`;

/** Lê o documento de exemplo e devolve a estrutura que os relatórios vão seguir. */
export async function extractBlueprint(file: Buffer, kind: "pdf" | "docx" | "text"): Promise<Blueprint> {
  let content: unknown[];
  if (kind === "pdf") {
    content = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.toString("base64") } },
      { type: "text", text: "Este é o relatório de exemplo. Extraia a estrutura." },
    ];
  } else {
    let text: string;
    if (kind === "docx") {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer: file })).value;
    } else {
      text = file.toString("utf8");
    }
    text = text.replace(/\u0000/g, "").trim();
    if (text.length < 40) throw new HttpError(422, "Não encontrei texto suficiente no documento. Envie um PDF ou Word com o relatório de exemplo.");
    content = [{ type: "text", text: `Relatório de exemplo:\n\n${text.slice(0, 120_000)}\n\nExtraia a estrutura.` }];
  }

  const raw = await callTool<unknown>({
    system: [
      "Você analisa um relatório comercial mensal de exemplo, enviado por um consultor, e extrai o MODELO dele para que novos relatórios sigam a mesma estrutura, ordem de seções, nível de detalhe e tom.",
      "Não copie números do exemplo: eles serão substituídos pelos dados reais de cada cliente.",
      METRIC_HELP,
      "Para cada seção, diga o objetivo (o que ela comunica ao cliente) e quais métricas ela usa. Se o exemplo tem análise de metas (bateu/não bateu e por quê), inclua 'goals'.",
      "Em extra_instructions, registre convenções do exemplo: saudação, assinatura, formato de valores, uso de emojis, tamanho dos textos.",
    ].join("\n"),
    content,
    maxTokens: 4000,
    tool: {
      name: "save_blueprint",
      description: "Salva a estrutura do relatório de exemplo",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Título padrão do relatório (sem nome do cliente e sem mês)" },
          tone: { type: "string", description: "Tom e estilo de escrita" },
          audience: { type: "string", description: "Para quem é escrito (ex.: dono da empresa)" },
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                purpose: { type: "string" },
                style: { type: "string", enum: ["paragraph", "bullets", "table", "mixed"] },
                metrics: { type: "array", items: { type: "string", enum: [...METRIC_KEYS] } },
              },
              required: ["title", "purpose", "style", "metrics"],
            },
          },
          extra_instructions: { type: "string" },
        },
        required: ["title", "tone", "sections"],
      },
    },
  });
  const parsed = Blueprint.safeParse(raw);
  if (!parsed.success) throw new HttpError(502, "Não consegui entender a estrutura do documento. Tente outro arquivo.");
  return parsed.data;
}
