import { randomBytes } from "node:crypto";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/env";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import * as meta from "@/lib/whatsapp/meta";
import * as evo from "@/lib/whatsapp/evolution";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("meta"),
    name: z.string().trim().min(1).max(60),
    phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, "Phone Number ID inválido"),
    wabaId: z.string().trim().regex(/^\d{5,30}$/, "WABA ID inválido"),
    accessToken: z.string().trim().min(20, "Token de acesso inválido"),
  }),
  z.object({
    provider: z.literal("evolution"),
    name: z.string().trim().min(1).max(60),
  }),
]);

export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`channel:${ctx.org.id}`, 10, 3600, "Limite de conexões por hora atingido.");
    const body = Body.parse(await readJson(req));
    const db = supabaseAdmin();
    const secret = randomBytes(32).toString("hex");

    if (body.provider === "meta") {
      const info = await meta.getPhoneInfo(body.phoneNumberId, body.accessToken); // valida credenciais
      await meta.subscribeApp(body.wabaId, body.accessToken); // garante entrega de webhooks
      const { data: ch, error } = await db
        .from("whatsapp_channels")
        .insert({
          organization_id: ctx.org.id,
          provider: "meta",
          name: body.name,
          status: "connected",
          phone_number: info.display_phone_number?.replace(/\D/g, "") ?? null,
          meta_phone_number_id: body.phoneNumberId,
          meta_waba_id: body.wabaId,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") throw new HttpError(409, "Este número já está conectado a uma conta");
        throw error;
      }
      const s = await db.from("whatsapp_channel_secrets").insert({ channel_id: ch.id, meta_access_token: body.accessToken, webhook_secret: secret });
      if (s.error) {
        await db.from("whatsapp_channels").delete().eq("id", ch.id);
        throw s.error;
      }
      // Coexistência: tenta puxar o histórico do app (falha silenciosa se o número não for de coexistência)
      meta.requestHistorySync(body.phoneNumberId, body.accessToken).catch(() => undefined);
      return ok({ id: ch.id }, 201);
    }

    // Evolution (QR Code)
    const { data: ch, error } = await db
      .from("whatsapp_channels")
      .insert({ organization_id: ctx.org.id, provider: "evolution", name: body.name, status: "connecting" })
      .select("id")
      .single();
    if (error) throw error;
    const instance = `crm_${ch.id.replace(/-/g, "").slice(0, 20)}`;
    try {
      const s = await db.from("whatsapp_channel_secrets").insert({ channel_id: ch.id, webhook_secret: secret });
      if (s.error) throw s.error;
      await evo.createInstance(instance, `${appUrl()}/api/webhooks/evolution/${ch.id}?token=${secret}`);
      const u = await db.from("whatsapp_channels").update({ evolution_instance: instance }).eq("id", ch.id);
      if (u.error) throw u.error;
    } catch (e) {
      await db.from("whatsapp_channels").delete().eq("id", ch.id);
      throw e;
    }
    return ok({ id: ch.id }, 201);
  } catch (e) {
    return fail(e);
  }
}
