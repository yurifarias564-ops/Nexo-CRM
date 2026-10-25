import "server-only";

// Uma interface só para as IAs suportadas (Claude, Gemini, Groq), com ferramentas.
// Cada provedor tem o próprio formato; o laço de ferramentas fica aqui dentro.

export type AiProvider = "claude" | "gemini" | "groq";

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema simples (object, string, number, boolean, array de string). */
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export interface ChatTurn { role: "user" | "assistant"; text: string }
export interface ToolCall { name: string; args: Record<string, unknown>; result: string }

export interface RunInput {
  provider: AiProvider;
  model: string;
  apiKey: string;
  system: string;
  history: ChatTurn[];
  tools: ToolDef[];
  exec: (name: string, args: Record<string, unknown>) => Promise<string>;
  maxRounds?: number;
  maxTokens?: number;
  /** Claude: pensar antes de responder (padrão: sim). */
  think?: boolean;
}

export const MODELS: Record<AiProvider, { id: string; label: string }[]> = {
  claude: [
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — mais inteligente" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 — mais rápido e barato" },
  ],
  gemini: [
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (gratuito com limite)" },
    { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite (gratuito, mais simples)" },
  ],
  groq: [
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B na Groq (gratuito com limite)" },
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B na Groq (gratuito com limite)" },
  ],
};

export const PROVIDER_LABEL: Record<AiProvider, string> = { claude: "Claude (Anthropic)", gemini: "Gemini (Google)", groq: "Groq (modelos abertos)" };
export const KEY_ENV: Record<AiProvider, string> = { claude: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY" };

export const defaultModel = (p: AiProvider) => MODELS[p][0]!.id;

export class AiError extends Error {}

async function post(url: string, headers: Record<string, string>, body: unknown, label: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = data.error as { message?: string } | string | undefined;
    const msg = typeof err === "string" ? err : err?.message ?? `HTTP ${res.status}`;
    if (res.status === 429) throw new AiError(`${label}: limite de uso atingido (${msg.slice(0, 160)})`);
    if (res.status === 401 || res.status === 403) throw new AiError(`${label}: chave inválida ou sem permissão`);
    throw new AiError(`${label}: ${msg.slice(0, 240)}`);
  }
  return data;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") { try { const v = JSON.parse(raw); return v && typeof v === "object" ? v : {}; } catch { return {}; } }
  return {};
}

/** Une turnos seguidos do mesmo lado (o Claude e o Gemini exigem alternância). */
function alternate(h: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of h) {
    const text = t.text.trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.text += `\n${text}`;
    else out.push({ role: t.role, text });
  }
  while (out[0]?.role === "assistant") out.shift();
  return out;
}

async function runClaude(i: RunInput, calls: ToolCall[]): Promise<string> {
  const messages: { role: string; content: unknown }[] = alternate(i.history).map((t) => ({ role: t.role, content: t.text }));
  const tools = i.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  let thinking = i.think !== false;
  for (let round = 0; round < (i.maxRounds ?? 5); round++) {
    // Raciocínio antes de responder (qualidade de atendimento); se o modelo não aceitar, segue sem
    const base = { model: i.model, system: i.system, messages, tools };
    let data: Record<string, unknown>;
    try {
      data = thinking
        ? await post("https://api.anthropic.com/v1/messages", { "x-api-key": i.apiKey, "anthropic-version": "2023-06-01" },
          { ...base, max_tokens: (i.maxTokens ?? 1200) + 2048, thinking: { type: "enabled", budget_tokens: 2048 } }, "Claude")
        : await post("https://api.anthropic.com/v1/messages", { "x-api-key": i.apiKey, "anthropic-version": "2023-06-01" },
          { ...base, max_tokens: i.maxTokens ?? 1200 }, "Claude");
    } catch (e) {
      if (!thinking || !/thinking/i.test((e as Error).message)) throw e;
      thinking = false;
      round--;
      continue;
    }
    const content = (data.content ?? []) as { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
    const uses = content.filter((c) => c.type === "tool_use");
    const text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
    if (!uses.length || data.stop_reason !== "tool_use") return text;
    messages.push({ role: "assistant", content });
    const results = [];
    for (const u of uses) {
      const args = parseArgs(u.input);
      const result = await i.exec(u.name!, args);
      calls.push({ name: u.name!, args, result });
      results.push({ type: "tool_result", tool_use_id: u.id, content: result });
    }
    messages.push({ role: "user", content: results });
  }
  return "";
}

/** O Gemini não aceita algumas chaves de JSON Schema. */
function geminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(geminiSchema);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "additionalProperties" || k === "$schema") continue;
    out[k] = geminiSchema(v);
  }
  return out;
}

async function runGemini(i: RunInput, calls: ToolCall[]): Promise<string> {
  const contents: { role: string; parts: unknown[] }[] = alternate(i.history).map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.text }] }));
  const tools = [{ functionDeclarations: i.tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.parameters) })) }];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(i.model)}:generateContent`;
  for (let round = 0; round < (i.maxRounds ?? 5); round++) {
    const data = await post(url, { "x-goog-api-key": i.apiKey }, {
      systemInstruction: { parts: [{ text: i.system }] }, contents, tools,
      generationConfig: { maxOutputTokens: i.maxTokens ?? 1200 },
    }, "Gemini");
    const cand = ((data.candidates ?? []) as { content?: { role?: string; parts?: { text?: string; thought?: boolean; functionCall?: { name: string; args?: unknown } }[] } }[])[0];
    const parts = cand?.content?.parts ?? [];
    const fcs = parts.filter((p) => p.functionCall);
    const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("\n").trim();
    if (!fcs.length) return text;
    contents.push({ role: "model", parts });
    const responses = [];
    for (const p of fcs) {
      const args = parseArgs(p.functionCall!.args);
      const result = await i.exec(p.functionCall!.name, args);
      calls.push({ name: p.functionCall!.name, args, result });
      responses.push({ functionResponse: { name: p.functionCall!.name, response: { result } } });
    }
    contents.push({ role: "user", parts: responses });
  }
  return "";
}

async function runGroq(i: RunInput, calls: ToolCall[]): Promise<string> {
  const messages: Record<string, unknown>[] = [{ role: "system", content: i.system }, ...alternate(i.history).map((t) => ({ role: t.role, content: t.text }))];
  const tools = i.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  for (let round = 0; round < (i.maxRounds ?? 5); round++) {
    const data = await post("https://api.groq.com/openai/v1/chat/completions", { Authorization: `Bearer ${i.apiKey}` },
      { model: i.model, messages, tools, tool_choice: "auto", max_tokens: i.maxTokens ?? 1200 }, "Groq");
    const msg = ((data.choices ?? []) as { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[])[0]?.message;
    const tcs = msg?.tool_calls ?? [];
    if (!tcs.length) return (msg?.content ?? "").trim();
    messages.push({ role: "assistant", content: msg?.content ?? "", tool_calls: tcs });
    for (const tc of tcs) {
      const args = parseArgs(tc.function.arguments);
      const result = await i.exec(tc.function.name, args);
      calls.push({ name: tc.function.name, args, result });
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }
  return "";
}

export async function runWithTools(i: RunInput): Promise<{ text: string; calls: ToolCall[] }> {
  const calls: ToolCall[] = [];
  const run = i.provider === "claude" ? runClaude : i.provider === "gemini" ? runGemini : runGroq;
  const text = await run(i, calls);
  return { text, calls };
}
