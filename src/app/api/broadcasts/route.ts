import { after } from "next/server";
import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, HttpError, ok } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { DEFAULT_TZ, isValidTimeZone, zonedToUtc } from "@/lib/time";
import { createBroadcast, dispatchBroadcasts } from "@/lib/broadcasts-server";
import { AudienceSchema, TemplateChoiceSchema } from "@/lib/broadcasts-schema";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Lista de disparos da empresa (mais recentes primeiro). */
export async function GET() {
  try {
    const ctx = await requireApiContext({ manage: true });
    const sb = await supabaseServer();
    const { data, error } = await sb.from("broadcasts").select("*").eq("organization_id", ctx.org.id).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return ok({ broadcasts: data ?? [] });
  } catch (e) {
    return fail(e);
  }
}

const Payload = z.object({
  name: z.string().trim().min(1, "Dê um nome ao disparo").max(120),
  channelId: z.string().uuid(),
  audience: AudienceSchema,
  audienceLabel: z.string().max(300).default(""),
  body: z.string().trim().max(4096, "Mensagem muito longa").nullable().default(null),
  template: TemplateChoiceSchema.nullable().default(null),
  sendNow: z.boolean(),
  sendAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Data/hora inválida").nullable().default(null),
  timeZone: z.string().optional(),
  intervalSeconds: z.number().int().min(3, "Intervalo mínimo de 3 segundos").max(600).default(30),
  confirmedCost: z.number().nullable().default(null),
});

/** Cria o disparo (multipart: "payload" em JSON + arquivos "media" e "header"). */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`bcast:${ctx.userId}`, 20, 3600, "Muitos disparos seguidos. Aguarde um pouco.");
    const form = await req.formData().catch(() => { throw new HttpError(400, "Envio inválido"); });
    const raw = form.get("payload");
    if (typeof raw !== "string") throw new HttpError(400, "Envio inválido");
    const p = Payload.parse(JSON.parse(raw));
    const tz = isValidTimeZone(p.timeZone) ? p.timeZone! : DEFAULT_TZ;
    const sendAt = p.sendNow ? new Date() : p.sendAt ? zonedToUtc(p.sendAt, tz) : null;
    if (!sendAt) throw new HttpError(422, "Escolha quando enviar");
    const files = form.getAll("media").filter((f): f is File => f instanceof File);
    const header = form.get("header");
    const r = await createBroadcast({ orgId: ctx.org.id, userId: ctx.userId }, {
      name: p.name, channelId: p.channelId, audience: p.audience, audienceLabel: p.audienceLabel,
      body: p.body || null, template: p.template, sendAt, timeZone: tz, intervalSeconds: p.intervalSeconds, confirmedCost: p.confirmedCost,
    }, files, header instanceof File ? header : null);
    // Disparo para agora: começa já, sem esperar o próximo minuto do agendador
    if (p.sendNow) after(() => dispatchBroadcasts(45_000).catch((e) => console.error("[broadcast kick]", e)));
    return ok(r, 201);
  } catch (e) {
    return fail(e);
  }
}
