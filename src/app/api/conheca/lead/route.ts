import { after } from "next/server";
import { z } from "zod";
import { classify } from "@/lib/tracking/shared";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normPhone, saveInbound } from "@/lib/portals";
import { loadChannel, sendTextVia } from "@/lib/whatsapp";
import { processAutomations } from "@/lib/automations/engine";

export const runtime = "nodejs";

const Body = z.object({
  nome: z.string().trim().min(2).max(80),
  whatsapp: z.string().trim().min(8).max(30),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  empresa: z.string().trim().max(80).optional().or(z.literal("")),
  nicho: z.string().trim().min(2).max(60),
  objetivo: z.string().trim().min(2).max(300),
  intent: z.enum(["teste", "especialista"]),
  utm: z.record(z.string(), z.string().max(120)).optional(),
  site: z.string().max(0).optional(), // armadilha anti-robô: tem que vir vazio
});

/**
 * Formulário da página de vendas (/conheca): o interessado vira lead no CRM da plataforma
 * e o dono recebe na hora um WhatsApp com nome, nicho e objetivo.
 */
export async function POST(req: Request) {
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "anon";
    await rateLimit(`conheca:${ip}`, 8, 3600, "Muitas tentativas. Tente de novo mais tarde.");
    const b = Body.parse(await readJson(req, 8000));
    const phone = normPhone(b.whatsapp);
    if (!phone) throw new HttpError(422, "Confira o número de WhatsApp (com DDD).");

    const db = supabaseAdmin();
    const { data: s } = await db.from("platform_settings").select("billing_channel_id, sales_notify_phone").eq("id", true).maybeSingle();
    if (!s?.billing_channel_id) throw new HttpError(503, "Cadastro indisponível no momento. Tente de novo em instantes.");
    const channel = await loadChannel(s.billing_channel_id);

    const quer = b.intent === "teste" ? "Começar o teste grátis de 7 dias" : "Falar com um especialista";
    const campanha = b.utm?.utm_campaign ? `${b.utm.utm_source ?? ""} / ${b.utm.utm_campaign}`.trim() : null;
    const r = await saveInbound(channel.organization_id, "Anúncio Meta", {
      name: b.nome, phone, email: b.email || null,
      message: [`Quer: ${quer}`, `Nicho: ${b.nicho}`, b.empresa ? `Empresa: ${b.empresa}` : null, `Objetivo com o CRM: ${b.objetivo}`].filter(Boolean).join("\n"),
      ad: campanha ? `Página de vendas (${campanha})` : "Página de vendas /conheca", adUrl: null, vehicle: null, price: null,
      chatId: null, messageId: null, listId: null, fromSeller: false,
    });
    // Origem do lead (aba Campanhas): só grava se ainda não tem, para não sobrescrever a origem de um contato antigo
    if (r.isNew) {
      const u = b.utm ?? {};
      const num = (v?: string) => (v && /^\d{6,}$/.test(v) ? v : null);
      await db.from("lead_origins").upsert({
        lead_id: r.leadId, organization_id: channel.organization_id,
        channel: classify({ ...u, fbclid: u.fbclid ?? null, kind: "site" }), source_type: "site",
        utm_source: u.utm_source ?? null, utm_medium: u.utm_medium ?? null, utm_campaign: u.utm_campaign ?? null,
        utm_content: u.utm_content ?? null, utm_term: u.utm_term ?? null,
        ad_id: num(u.utm_content) ?? num(u.utm_term) ?? num(u.utm_id), fbclid: u.fbclid ?? null,
        ad_url: "/conheca",
      }, { onConflict: "lead_id", ignoreDuplicates: true }).then(() => undefined, (e) => console.error("[conheca] origem", e));
    }
    await db.from("leads").update({ notes: [`Nicho: ${b.nicho}`, `Objetivo: ${b.objetivo}`, `Quer: ${quer}`].join(" · ").slice(0, 500) }).eq("id", r.leadId).then(() => undefined, () => undefined);

    // Aviso no WhatsApp do dono (não trava o cadastro se o WhatsApp falhar)
    const aviso = [
      b.intent === "teste" ? "🚀 *Novo teste grátis — Nexo CRM*" : "📅 *Pediu especialista — Nexo CRM*",
      "",
      `👤 *Nome:* ${b.nome}`,
      b.empresa ? `🏢 *Empresa:* ${b.empresa}` : null,
      `🏷️ *Nicho:* ${b.nicho}`,
      `🎯 *Objetivo:* ${b.objetivo}`,
      `📱 *WhatsApp:* https://wa.me/${phone}`,
      b.email ? `✉️ *E-mail:* ${b.email}` : null,
      campanha ? `📣 *Origem:* ${campanha}` : null,
      r.isNew ? "\nJá está no seu funil como lead novo." : "\nEsse contato já estava no seu funil.",
    ].filter((x) => x !== null).join("\n");
    if (s.sales_notify_phone) {
      after(() => sendTextVia(channel, s.sales_notify_phone!, aviso).then(() => undefined, (e) => console.error("[conheca] aviso whatsapp", e)));
    }
    if (r.isNew) after(() => processAutomations().then(() => undefined, (e) => console.error("[conheca] automações", e)));

    const especialista = s.sales_notify_phone
      ? `https://wa.me/${s.sales_notify_phone}?text=${encodeURIComponent(`Olá! Sou ${b.nome}${b.empresa ? `, da ${b.empresa}` : ""}. Quero falar com um especialista do Nexo CRM. Meu objetivo: ${b.objetivo}`)}`
      : null;
    return ok({ ok: true, especialista });
  } catch (e) {
    return fail(e);
  }
}
