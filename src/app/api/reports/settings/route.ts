import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { DEFAULT_TZ, isValidTimeZone } from "@/lib/time";

export const runtime = "nodejs";

const Body = z.object({
  enabled: z.boolean(),
  templateId: z.string().uuid().nullable(),
  channelId: z.string().uuid().nullable(),
  targetType: z.enum(["group", "phone"]).nullable(),
  targetId: z.string().trim().max(120).nullable(),
  targetName: z.string().trim().max(200).nullable(),
  sendHour: z.number().int().min(0).max(23),
  timeZone: z.string().optional(),
  caption: z.string().trim().max(1000).nullable(),
});

/** Salva para onde e quando o relatório desta empresa é enviado. */
export async function PUT(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const b = Body.parse(await readJson(req, 16_000));
    const sb = await supabaseServer();
    let templateName: string | null = null;

    if (b.templateId) {
      // RLS: só encontra se o modelo for do próprio usuário
      const { data: t } = await sb.from("report_templates").select("name").eq("id", b.templateId).maybeSingle();
      if (!t) {
        const { data: cur } = await sb.from("report_settings").select("template_id, template_name").eq("organization_id", ctx.org.id).maybeSingle();
        if (cur?.template_id !== b.templateId) throw new HttpError(404, "Modelo não encontrado na sua biblioteca");
        templateName = cur.template_name; // mantém modelo escolhido por outro administrador
      } else templateName = t.name;
    }
    if (b.channelId) {
      const { data: ch } = await sb.from("whatsapp_channels").select("id, provider").eq("id", b.channelId).maybeSingle();
      if (!ch) throw new HttpError(404, "WhatsApp não encontrado");
      if (b.targetType === "group" && ch.provider !== "evolution") throw new HttpError(422, "Envio para grupo exige número conectado por QR Code");
    }
    let targetId = b.targetId;
    if (b.targetType === "group" && targetId && !/^[\d-]+@g\.us$/.test(targetId)) throw new HttpError(422, "Grupo inválido");
    if (b.targetType === "phone" && targetId) {
      targetId = targetId.replace(/\D/g, "");
      if (!/^\d{10,15}$/.test(targetId)) throw new HttpError(422, "Número inválido (use DDI + DDD + número)");
    }
    if (b.enabled && (!b.templateId || !b.channelId || !b.targetType || !targetId)) {
      throw new HttpError(422, "Para ativar o envio automático, escolha o modelo, o WhatsApp e o destino.");
    }
    const { error } = await supabaseAdmin().from("report_settings").upsert({
      organization_id: ctx.org.id, enabled: b.enabled, template_id: b.templateId, template_name: templateName, channel_id: b.channelId,
      target_type: b.targetType, target_id: targetId, target_name: b.targetName, send_hour: b.sendHour,
      time_zone: isValidTimeZone(b.timeZone) ? b.timeZone : DEFAULT_TZ, caption: b.caption || null,
      updated_by: ctx.userId, updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id" });
    if (error) throw error;
    return ok({ saved: true });
  } catch (e) {
    return fail(e);
  }
}
