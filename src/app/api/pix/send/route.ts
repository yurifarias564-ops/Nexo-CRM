import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { brCode, displayPixKey, PIX_KEY_LABEL, type PixKeyType } from "@/lib/pix";
import { sendPix } from "@/lib/send";
import { formatBRL } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z
  .object({
    conversationId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    keyId: z.string().uuid(),
    amount: z.number().positive().max(1_000_000).nullable().optional(),
    description: z.string().trim().max(40).optional(),
  })
  .refine((b) => b.conversationId || b.leadId, "Informe a conversa ou o lead");

/** "Solicitar pagamento" via Pix, no formato do Pix do WhatsApp (cartão com botão de copiar). */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`pix:${ctx.userId}`, 30, 3600, "Muitas cobranças Pix nesta hora. Aguarde um pouco.");
    const b = Body.parse(await readJson(req, 4_000));
    const sb = await supabaseServer();
    const { data: k } = await sb.from("pix_keys").select("key_type, key, holder_name, city").eq("id", b.keyId).maybeSingle();
    if (!k) throw new HttpError(404, "Chave Pix não encontrada");
    const type = k.key_type as PixKeyType;
    const txid = `NX${Date.now().toString(36).toUpperCase()}`;
    const code = brCode({ key: k.key, name: k.holder_name, city: k.city, amount: b.amount ?? null, description: b.description || null, txid });

    const r = await sendPix(sb, ctx.org.id, ctx.userId, { conversationId: b.conversationId, leadId: b.leadId }, {
      keyType: type, key: k.key, keyDisplay: displayPixKey(type, k.key), holderName: k.holder_name, code,
      amount: b.amount ?? null, description: b.description || undefined, txid,
    });

    let leadId = b.leadId ?? null;
    if (!leadId && b.conversationId) {
      const { data: c } = await sb.from("conversations").select("lead_id").eq("id", b.conversationId).maybeSingle();
      leadId = c?.lead_id ?? null;
    }
    if (leadId) {
      await sb.from("activities").insert({ organization_id: ctx.org.id, lead_id: leadId, actor_id: ctx.userId, type: "note",
        payload: { text: `Pix enviado${b.amount ? ` de ${formatBRL(b.amount)}` : ""} (chave ${PIX_KEY_LABEL[type]} ${displayPixKey(type, k.key)})`, via: "pix", txid } });
    }
    return ok({ ...r, code }, 201);
  } catch (e) {
    return fail(e);
  }
}
