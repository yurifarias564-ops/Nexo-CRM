import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { assertCanSee } from "@/lib/access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import * as a4 from "@/lib/voip/api4com";
import { expireStaleVoip, loadVoip, myExtension } from "@/lib/voip";

export const runtime = "nodejs";

const Body = z.object({
  leadId: z.string().uuid().nullable().optional(),
  conversationId: z.string().uuid().nullable().optional(),
  phone: z.string().trim().min(8).max(25).optional(),
}).refine((b) => b.leadId || b.conversationId || b.phone, "Informe o lead ou o telefone");

/** Liga para o celular do lead pela central (ligação comum, gravada). */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`voip-call:${ctx.userId}`, 60, 3600, "Muitas ligações nesta hora. Aguarde um pouco.");
    const b = Body.parse(await readJson(req, 4_000));
    const v = await loadVoip(ctx.org.id);
    const ext = await myExtension(ctx.org.id, ctx.userId);
    if (!ext) throw new HttpError(409, "Você ainda não tem ramal. Peça a um administrador em Configurações → Integrações → Telefonia.");
    const db = supabaseAdmin();

    let leadId: string | null = b.leadId ?? null;
    const conversationId: string | null = b.conversationId ?? null;
    let phone = b.phone ?? null;
    let name: string | null = null;
    if (conversationId) {
      await assertCanSee("conversation", conversationId);
      const { data: c } = await db.from("conversations").select("id, organization_id, wa_id, lead_id, contact_name").eq("id", conversationId).maybeSingle();
      if (!c || c.organization_id !== ctx.org.id) throw new HttpError(404, "Conversa não encontrada");
      leadId = leadId ?? c.lead_id; phone = phone ?? c.wa_id; name = c.contact_name;
    }
    if (leadId) {
      await assertCanSee("lead", leadId);
      const { data: l } = await db.from("leads").select("id, organization_id, name, phone").eq("id", leadId).maybeSingle();
      if (!l || l.organization_id !== ctx.org.id) throw new HttpError(404, "Lead não encontrado");
      phone = phone ?? l.phone; name = l.name ?? name;
    }
    if (!phone) throw new HttpError(422, "Este lead não tem telefone");
    const called = a4.e164(phone);

    await expireStaleVoip(ctx.org.id);
    const { data: busy } = await db.from("wa_calls").select("id").eq("organization_id", ctx.org.id).eq("kind", "voip").eq("started_by", ctx.userId)
      .in("status", ["starting", "ringing", "connected"]).gt("created_at", new Date(Date.now() - 2 * 60_000).toISOString()).limit(1);
    if (busy?.length) throw new HttpError(409, "Você já está numa ligação. Encerre antes de ligar de novo.");

    const id = randomUUID();
    const { error } = await db.from("wa_calls").insert({
      id, organization_id: ctx.org.id, kind: "voip", channel_id: null, conversation_id: conversationId, lead_id: leadId,
      wa_id: called.slice(1), contact_name: name, direction: "out", status: "starting", started_by: ctx.userId, recording_mode: "meta",
    });
    if (error) throw error;
    try {
      const r = await a4.startCall(v.api_token, { extension: ext.ramal, called, metadata: { gateway: v.gateway, orgId: ctx.org.id, callRowId: id, userId: ctx.userId } });
      await db.from("wa_calls").update({ voip_call_id: r.id, status: "ringing", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "starting");
    } catch (e) {
      await db.from("wa_calls").update({ status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "erro", updated_at: new Date().toISOString() }).eq("id", id);
      throw e;
    }
    return ok({ id, called }, 201);
  } catch (e) {
    return fail(e);
  }
}
