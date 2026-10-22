import "server-only";
import { env, envOptional } from "@/lib/env";
import { HttpError } from "@/lib/http";

/** Chamada à API da Anthropic forçando uma ferramenta (saída JSON estruturada). */
export async function callTool<T>(opts: {
  system: string;
  content: unknown[];
  tool: { name: string; description: string; input_schema: unknown };
  maxTokens?: number;
  model?: string;
}): Promise<T> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? envOptional("ANTHROPIC_REPORT_MODEL", "claude-sonnet-5-5"),
      max_tokens: opts.maxTokens ?? 8000,
      system: opts.system,
      tools: [opts.tool],
      tool_choice: { type: "tool", name: opts.tool.name },
      messages: [{ role: "user", content: opts.content }],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = (await res.json().catch(() => ({}))) as { content?: { type: string; name?: string; input?: T }[]; error?: { message?: string }; stop_reason?: string };
  if (!res.ok) throw new HttpError(502, `IA: ${body.error?.message ?? res.status}`);
  const block = body.content?.find((b) => b.type === "tool_use" && b.name === opts.tool.name);
  if (!block?.input) throw new HttpError(502, "A IA não devolveu o conteúdo esperado. Tente novamente.");
  return block.input;
}
