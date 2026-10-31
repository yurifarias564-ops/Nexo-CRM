import { after } from "next/server";
import { fail, HttpError, ok } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { orgByInbound, parseInbound, saveInbound } from "@/lib/portals";
import { processAutomations } from "@/lib/automations/engine";

export const runtime = "nodejs";

const ORIGENS = ["OLX", "Webmotors", "Mercado Livre", "iCarros", "Site", "Facebook", "Outro portal"];

/** Teste de conexão (alguns portais chamam antes de salvar o endereço). */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  try { await orgByInbound((await params).token); return ok({ ok: true }); } catch (e) { return fail(e); }
}

/** Recebe um lead (OLX, Webmotors, site, Make/Zapier…) e coloca no funil da empresa. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    await rateLimit(`inbound:${token}`, 600, 3600, "Muitos leads nesta hora");
    const link = await orgByInbound(token);
    const u = new URL(req.url);
    const o = (u.searchParams.get("origem") ?? "").trim();
    const origem = ORIGENS.find((x) => x.toLowerCase() === o.toLowerCase()) ?? (o ? o.replace(/[^\p{L}\p{N} .-]/gu, "").slice(0, 40) || "Portal" : "Portal");
    const text = await req.text();
    if (text.length > 64_000) throw new HttpError(413, "Muito grande");
    let body: unknown = {};
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/x-www-form-urlencoded")) body = Object.fromEntries(new URLSearchParams(text));
    else { try { body = JSON.parse(text || "{}"); } catch { throw new HttpError(400, "Envie JSON"); } }
    const l = parseInbound(body);
    if (!l.phone && !l.email && !l.chatId) throw new HttpError(422, "O lead precisa de telefone, e-mail ou chat");
    const db = supabaseAdmin();
    // Mesma mensagem reenviada: não duplica
    if (l.messageId) {
      const { error } = await db.from("webhook_events").insert({ provider: `inbound:${origem}`, event_id: `${link.organization_id}:${l.messageId}` });
      if (error?.code === "23505") return ok({ ok: true, duplicate: true });
    }
    const r = await saveInbound(link.organization_id, origem, l);
    await db.from("inbound_links").update({ last_used_at: new Date().toISOString(), received: link.received + 1 }).eq("token", token);
    // Automações de "lead novo" rodam já, sem esperar o próximo minuto
    if (r.isNew) after(() => processAutomations().then(() => undefined, (e) => console.error("[inbound] automações", e)));
    return ok({ ok: true, lead_id: r.leadId, novo: r.isNew }, r.isNew ? 201 : 200);
  } catch (e) {
    return fail(e);
  }
}
