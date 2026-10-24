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
  form.append("prompt", "Comandos de CRM: lead, coluna, etapa, funil, negociação, agendamento, agendar, reunião, amanhã, horas, tag, anúncio, proposta, qualificação, WhatsApp, mensagem, telefone.");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("OPENAI_API_KEY")}` },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  const body = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
  if (!res.ok) {
    console.error("[voz] transcrição OpenAI", res.status, body.error?.message);
    throw new HttpError(502, "Não consegui entender o áudio. Recarregue a página (Ctrl+Shift+R) e fale de novo pelo Chrome, ou use “Digitar comando”.");
  }
  return (body.text ?? "").trim();
}

export type ToolCall = { name: string; input: Record<string, unknown> };

const TOOLS = [
  {
    name: "frase_entendida",
    description: "SEMPRE chame primeiro: a frase do usuário reescrita em português correto, corrigindo erros do reconhecimento de voz (ex.: 'feed' → 'lead', 'AirTag' → 'a tag', 'coluna' mantém). Não invente nada que não foi dito.",
    input_schema: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] },
  },
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
    name: "schedule_meeting",
    description: "Agenda um compromisso (reunião, visita, consulta, test drive, ligação) com o lead no Google Agenda. Use sempre que o usuário falar em agendar/agendamento com dia ou horário.",
    input_schema: {
      type: "object",
      properties: {
        lead: { type: "string", description: "Nome do lead como foi dito" },
        start: { type: "string", description: "Início no horário LOCAL do usuário, formato YYYY-MM-DDTHH:mm (ex.: 2026-10-23T10:00)" },
        duration_minutes: { type: "integer", description: "Duração em minutos. Padrão 60 se não for dita." },
        title: { type: "string", description: "Título curto se o usuário disser o tipo (ex.: 'Test drive com Yuri'). Senão omita." },
      },
      required: ["lead", "start"],
    },
  },
  {
    name: "schedule_message",
    description: "Agenda o ENVIO AUTOMÁTICO de uma mensagem de WhatsApp para o lead numa data/hora futura (follow-up, retomar contato, lembrete para o cliente).",
    input_schema: {
      type: "object",
      properties: {
        lead: { type: "string", description: "Nome do lead como foi dito" },
        send_at: { type: "string", description: "Quando enviar, horário LOCAL do usuário, formato YYYY-MM-DDTHH:mm" },
        text: { type: "string", description: "Texto exato que o cliente vai receber, com pontuação corrigida. Mantenha o tom e as gírias do usuário." },
      },
      required: ["lead", "send_at", "text"],
    },
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
    name: "log_call",
    description: "Registra uma ligação feita para o lead (ex.: 'liguei pro Yuri e ele não atendeu', 'registra ligação com a Ana, atendeu, 5 minutos, pediu proposta').",
    input_schema: {
      type: "object",
      properties: {
        lead: { type: "string" },
        outcome: { type: "string", enum: ["atendeu", "nao_atendeu", "caixa_postal", "ocupado", "numero_errado"], description: "Resultado da ligação" },
        duration_min: { type: "number", description: "Duração em minutos, se dita" },
        notes: { type: "string", description: "Resumo do que foi conversado, se dito" },
      },
      required: ["lead", "outcome"],
    },
  },
  {
    name: "add_note",
    description: "Adiciona uma anotação ao lead.",
    input_schema: { type: "object", properties: { lead: { type: "string" }, note: { type: "string" } }, required: ["lead", "note"] },
  },
];

export async function interpret(
  transcript: string,
  context: { stages: string[]; tags: string[]; members: string[]; now: string; timeZone: string },
): Promise<{ calls: ToolCall[]; reply: string | null; heard: string | null }> {
  const system = [
    "Você converte comandos falados em português (Brasil) em ações de um CRM, usando as ferramentas.",
    "Um único comando pode gerar várias ações (ex.: mover e adicionar tag). Chame uma ferramenta por ação.",
    "Use o nome do lead exatamente como foi dito. Para etapa e tags, prefira os nomes existentes abaixo (o usuário pode dizer 'coluna' querendo dizer etapa).",
    `Etapas existentes: ${context.stages.join(" | ") || "(nenhuma)"}`,
    `Tags existentes: ${context.tags.join(" | ") || "(nenhuma)"}`,
    `Equipe: ${context.members.join(" | ") || "(nenhum)"}`,
    `Agora é ${context.now}, fuso ${context.timeZone}. Converta datas faladas para esse fuso: "amanhã às 10 horas" = dia seguinte 10:00; "sexta às 15h30" = próxima sexta 15:30; "meio-dia" = 12:00; "10 da noite" = 22:00; só a hora sem dia = hoje se ainda não passou, senão amanhã.`,
    "Agendamento: quando o usuário falar em agendar/agendamento/marcar com um horário, chame schedule_meeting. O sistema já move o lead para a etapa de agendamento sozinho, então NÃO chame move_lead para essa etapa junto.",
    "Mensagem agendada: quando o usuário quiser que uma mensagem seja ENVIADA ao cliente no futuro (\"entrar em contato dia 31\", \"mande para ele na segunda\", \"retomar contato no fim do mês\"), chame schedule_message com o texto que o cliente vai receber. Data sem horário = 09:00; \"final do mês\" sem dia = último dia do mês às 09:00. Não confunda com schedule_meeting, que é compromisso na agenda do vendedor.",
    "O texto vem de reconhecimento de voz e pode ter palavras trocadas por som parecido (\"feed\"/\"lide\" = lead, \"AirTag\"/\"a tag\" = tag, \"etapa\"/\"coluna\" = etapa). Interprete pela intenção. Sempre chame frase_entendida primeiro com a frase corrigida e, na MESMA resposta, chame também as ferramentas de cada ação pedida.",
    "Se o comando não for uma ação de CRM, chame só frase_entendida e responda em uma frase curta.",
  ].join("\n");

  const first = await askClaude(system, TOOLS, transcript);
  let { calls, reply } = first;
  const heard = first.heard;
  // Às vezes o modelo só devolve a frase corrigida e para. Repete com a frase já corrigida,
  // sem a ferramenta de correção, para obter as ações.
  if (calls.length === 0 && heard) {
    const second = await askClaude(system, TOOLS.filter((t) => t.name !== "frase_entendida"), heard);
    calls = second.calls;
    reply = second.reply ?? reply;
  }
  return { calls, reply, heard };
}

async function askClaude(system: string, tools: typeof TOOLS, text: string) {
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
      tools,
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: text }],
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
  let heard: string | null = null;
  for (const b of body.content ?? []) {
    if (b.type === "tool_use" && b.name === "frase_entendida") {
      const t = typeof b.input.texto === "string" ? b.input.texto.trim().slice(0, 1000) : "";
      if (t) heard = t;
    } else if (b.type === "tool_use") calls.push({ name: b.name, input: b.input });
    else if (b.type === "text" && b.text.trim()) reply = b.text.trim();
  }
  return { calls, reply, heard };
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
