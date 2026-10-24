import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { sendLocation } from "@/lib/send";

export const runtime = "nodejs";

const Body = z
  .object({
    conversationId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    name: z.string().trim().max(100).optional(),
    address: z.string().trim().max(300).optional(),
  })
  .refine((b) => b.conversationId || b.leadId, "Informe a conversa ou o lead");

/** Envia um pino de localização pelo WhatsApp (como o "Localização" do app). */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`send:${ctx.userId}`, 60, 60, "Muitas mensagens em sequência. Aguarde alguns segundos.");
    const { conversationId, leadId, ...loc } = Body.parse(await readJson(req, 4_000));
    const r = await sendLocation(await supabaseServer(), ctx.org.id, ctx.userId, { conversationId, leadId }, {
      ...loc, name: loc.name || undefined, address: loc.address || undefined,
    });
    return ok(r, 201);
  } catch (e) {
    return fail(e);
  }
}
