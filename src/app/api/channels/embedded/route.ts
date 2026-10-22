import { randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import * as es from "@/lib/whatsapp/embedded";
import { setCallingEnabled } from "@/lib/whatsapp/meta-calls";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  code: z.string().min(10).max(2000),
  wabaId: z.string().regex(/^\d{5,30}$/, "Conta do WhatsApp inválida"),
  phoneNumberId: z.string().regex(/^\d{5,30}$/).nullable(),
  coexistence: z.boolean(),
});

/** Finaliza a conexão em 1 clique: token, webhooks, registro do número e ligações. */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`channel:${ctx.org.id}`, 10, 3600, "Limite de conexões por hora atingido.");
    const b = Body.parse(await readJson(req, 8_000));

    const token = await es.exchangeCode(b.code);
    const phones = await es.listPhones(b.wabaId, token);
    const phone = phones.find((p) => p.id === b.phoneNumberId) ?? (phones.length === 1 ? phones[0] : undefined);
    if (!phone) throw new HttpError(422, "Não encontrei o número nessa conta do WhatsApp. Refaça a conexão e escolha o número no final.");
    const coexistence = b.coexistence || !!phone.is_on_biz_app;

    const db = supabaseAdmin();
    const { data: dup } = await db.from("whatsapp_channels").select("id, organization_id").eq("meta_phone_number_id", phone.id).maybeSingle();
    if (dup && dup.organization_id !== ctx.org.id) throw new HttpError(409, "Este número já está conectado em outra empresa do sistema.");

    await es.subscribe(b.wabaId, token);
    let pin: string | null = null;
    let warn: string | null = null;
    if (!coexistence) {
      pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
      try { await es.register(phone.id, token, pin); } catch (e) { warn = (e as Error).message; pin = null; }
    }

    const fields = {
      provider: "meta" as const, status: "connected" as const, name: phone.verified_name?.slice(0, 60) || "WhatsApp oficial",
      phone_number: phone.display_phone_number?.replace(/\D/g, "") ?? null, meta_phone_number_id: phone.id, meta_waba_id: b.wabaId,
      meta_coexistence: coexistence, last_error: warn,
    };
    let channelId: string;
    if (dup) {
      const { error } = await db.from("whatsapp_channels").update(fields).eq("id", dup.id);
      if (error) throw error;
      channelId = dup.id;
      const s = await db.from("whatsapp_channel_secrets").update({ meta_access_token: token, ...(pin ? { meta_pin: pin } : {}) }).eq("channel_id", dup.id);
      if (s.error) throw s.error;
    } else {
      const { data: ch, error } = await db.from("whatsapp_channels").insert({ organization_id: ctx.org.id, ...fields }).select("id").single();
      if (error) throw error;
      channelId = ch.id;
      const s = await db.from("whatsapp_channel_secrets").insert({ channel_id: ch.id, meta_access_token: token, meta_pin: pin, webhook_secret: randomBytes(32).toString("hex") });
      if (s.error) { await db.from("whatsapp_channels").delete().eq("id", ch.id); throw s.error; }
    }

    let calling = false;
    if (coexistence) {
      // Traz contatos e conversas do app do celular (a Meta só permite nas primeiras 24h)
      void es.syncBusinessApp(phone.id, token);
    } else {
      try {
        await setCallingEnabled(phone.id, token, true);
        await db.from("whatsapp_channels").update({ calling_enabled: true }).eq("id", channelId);
        calling = true;
      } catch { /* ligações podem ser ativadas depois em Configurações */ }
    }
    return ok({ id: channelId, name: fields.name, phone: fields.phone_number, coexistence, calling, warning: warn }, 201);
  } catch (e) {
    return fail(e);
  }
}
