import "server-only";
import { env, envOptional } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { norm } from "@/lib/utils";

export { norm };

export async function transcribe(file: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", envOptional("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe"));
  form.append("language", "pt");
  form.append("prompt", "Comandos de CRM: lead, coluna, etapa, funil, negociação, tag, anúncio, proposta, qualificação, WhatsApp, mensagem, telefone.");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("OPENAI_API_KEY")}` },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  const body = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
  if (!res.ok) throw new HttpError(502, `Transcrição falhou: ${body.error?.message ?? res.status}`);
  return (body.text ?? "").trim();
}

export type ToolCall = { name: string; input: Record<string, unknown> };

const TOOLS = [
  {
    name: "move_lead",
    description: "Move um lead para outra etapa/coluna do funil.",
    input_schema: { type: "object", properties: { lead: { type: "string", description: "Nome ou telefone do lead como foi dito" }, stage: { type: "string", description: "Nome da etapa de destino" } }, required: ["lead", "stage"] },
  },
  {
    name: "add_tags",
    description: "Adiciona uma ou mais tags/etiquetas a um lead.",
    input_schema: { type: "object", properties: { lead: { type: "string" }, tags: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["lead", "tags"] },
  },
  {
    name: "remove_tags",
    description: "Remove tags/etiquetas de um lead.",
    input_schema: { type: "object", properties: { lead: { type: "string" }, tags: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["lead", "tags"] },
  },
  {
    name: "create_lead",
    description: "Cria um novo lead.",
    input_schema: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, stage: { type: "string" }, value: { type: "number" }, tags: { type: "array", items: { type: "string" } } }, required: ["name"] },
  },
  {
    name: "set_value",
    description: "Define o valor (R$) da oportunidade de um lead.",
    input_schema: { type: "object", properties: { lead: { type: "string" }, value: { type: "number" } }, required: ["lead", "value"] },
  },
  {
    name: "assign_lead",
    description: "Define o responsável (vendedor) por um lead.",
    input_schema: { type: "object", properties: { lead: { type: "string" }, member: { type: "string", description: "Nome do membro da equipe" } }, required: ["lead", "member"] },
  },
  {
    name: "update_lead",
    description: "Altera dados cadastrais de um lead: nome, telefone e/ou e-mail. Informe só o que mudou.",
    input_schema: { type: "object", properties: { lead: { type: "string" }, name: { type: "string", description: "Novo nome" }, phone: { type: "string", description: "Novo telefone" }, email: { type: "string", description: "Novo e-mail" } }, required: ["lead"] },
  },
  {
    name: "send_message",
    description: "Envia uma mensagem de texto no WhatsApp para o lead. Use o texto exatamente como o usuário quer enviar, corrigindo só pontuação.",
    input_schema: { type: "object", properties: { lead: { type: "string" }, text: { type: "string", description: "Texto da mensagem para o cliente" } }, required: ["lead", "text"] },
  },
  {
    name: "add_note",
    description: "Adiciona uma anotação ao lead.",
    input_schema: { type: "object", properties: { lead: { type: "string" }, note: { type: "string" } }, required: ["lead", "note"] },
  },
];

export async function interpret(
  transcript: string,
  context: { stages: string[]; tags: string[]; members: string[] },
): Promise<{ calls: ToolCall[]; reply: string | null }> {
  const system = [
    "Você converte comandos falados em português (Brasil) em ações de um CRM, usando as ferramentas.",
    "Um único comando pode gerar várias ações (ex.: mover e adicionar tag). Chame uma ferramenta por ação.",
    "Use o nome do lead exatamente como foi dito. Para etapa e tags, prefira os nomes existentes abaixo (o usuário pode dizer 'coluna' querendo dizer etapa).",
    `Etapas existentes: ${context.stages.join(" | ") || "(nenhuma)"}`,
    `Tags existentes: ${context.tags.join(" | ") || "(nenhuma)"}`,
    `Equipe: ${context.members.join(" | ") || "(nenhum)"}`,
    "Se o comando não for uma ação de CRM, responda em uma frase curta sem chamar ferramentas.",
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env("ANTHROPIC_API_KEY"),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: envOptional("ANTHROPIC_MODEL", "claude-haiku-5-5"),
      max_tokens: 1024,
      system,
      tools: TOOLS,
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: transcript }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    content?: ({ type: "text"; text: string } | { type: "tool_use"; name: string; input: Record<string, unknown> })[];
    error?: { message?: string };
  };
  if (!res.ok) throw new HttpError(502, `Interpretação falhou: ${body.error?.message ?? res.status}`);
  const calls: ToolCall[] = [];
  let reply: string | null = null;
  for (const b of body.content ?? []) {
    if (b.type === "tool_use") calls.push({ name: b.name, input: b.input });
    else if (b.type === "text" && b.text.trim()) reply = b.text.trim();
  }
  return { calls, reply };
}


/** Escolhe o item de nome mais próximo (exato > contém > palavras em comum). */
export function bestMatch<T extends { name: string }>(items: T[], query: string): T | null {
  const q = norm(query);
  if (!q) return null;
  const exact = items.find((i) => norm(i.name) === q);
  if (exact) return exact;
  const contains = items.filter((i) => norm(i.name).includes(q) || q.includes(norm(i.name)));
  if (contains.length === 1) return contains[0]!;
  const qWords = new Set(q.split(" ").filter((w) => w.length > 2));
  let best: T | null = null;
  let bestScore = 0;
  for (const i of contains.length ? contains : items) {
    const words = norm(i.name).split(" ");
    const score = words.filter((w) => qWords.has(w)).length / Math.max(words.length, 1);
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return bestScore >= 0.5 ? best : null;
}
