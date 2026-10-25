import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { envOptional } from "@/lib/env";
import { isValidTimeZone } from "@/lib/time";
import { AGENT_DEFAULTS, loadAgent } from "@/lib/ai/agent";
import { KEY_ENV, MODELS, type AiProvider } from "@/lib/ai/llm";
import { Rules } from "@/lib/ai/rules";

export const runtime = "nodejs";

const PROVIDERS: AiProvider[] = ["claude", "gemini", "groq"];

async function keyStatus(orgId: string) {
  const { data } = await supabaseAdmin().from("ai_agent_secrets").select("provider, api_key").eq("organization_id", orgId);
  const own = new Map((data ?? []).map((r) => [r.provider as AiProvider, r.api_key as string]));
  return Object.fromEntries(PROVIDERS.map((p) => {
    const k = own.get(p);
    return [p, { own: Boolean(k), ownHint: k ? `…${k.slice(-4)}` : null, platform: Boolean(envOptional(KEY_ENV[p])) }];
  }));
}

/** Configuração do agente de IA da empresa. */
export async function GET() {
  try {
    const ctx = await requireApiContext({ manage: true });
    const [agent, keys, { data: channels }] = await Promise.all([
      loadAgent(ctx.org.id),
      keyStatus(ctx.org.id),
      supabaseAdmin().from("whatsapp_channels").select("id, name, phone_number, provider, status").eq("organization_id", ctx.org.id).order("created_at"),
    ]);
    return ok({ agent: agent ?? { ...AGENT_DEFAULTS }, keys, channels: channels ?? [], models: MODELS });
  } catch (e) {
    return fail(e);
  }
}

const Body = z.object({
  enabled: z.boolean(),
  name: z.string().trim().min(1, "Dê um nome ao agente").max(40),
  provider: z.enum(["claude", "gemini", "groq"]),
  model: z.string().trim().max(80).nullable(),
  prompt: z.string().max(30000, "Prompt muito longo (máx. 30 mil letras)"),
  channel_ids: z.array(z.string().uuid()).max(50).nullable(),
  start_mode: z.enum(["new_leads", "all"]),
  reply_delay_seconds: z.number().int().min(2).max(60),
  pause_on_human: z.boolean(),
  pause_hours: z.number().int().min(1).max(720),
  auto_tags: z.boolean(),
  tone: z.enum(["executivo", "consultivo", "proximo"]),
  rules: Rules,
  transcribe_audio: z.boolean(),
  time_zone: z.string().max(64).refine(isValidTimeZone, "Fuso horário inválido"),
});

export async function PUT(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const b = Body.parse(await readJson(req, 200_000));
    const db = supabaseAdmin();
    const prev = await loadAgent(ctx.org.id);
    const enabled_at = b.enabled ? (prev?.enabled && prev.enabled_at ? prev.enabled_at : new Date().toISOString()) : prev?.enabled_at ?? null;
    const row = { ...b, model: b.model || null, channel_ids: b.channel_ids?.length ? b.channel_ids : null, enabled_at, organization_id: ctx.org.id, updated_by: ctx.userId, updated_at: new Date().toISOString() };
    const { data, error } = await db.from("ai_agents").upsert(row, { onConflict: "organization_id" }).select("*").single();
    if (error) throw error;
    return ok({ agent: data });
  } catch (e) {
    return fail(e);
  }
}
