import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { envOptional } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { newCode, withProtocol } from "@/lib/tracking/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clip = (v: string | null, n = 200) => (v && v.trim() ? v.trim().slice(0, n) : null);

function page(status: number, text: string) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link</title><body style="font-family:system-ui;padding:40px;text-align:center;color:#333">${text}</body>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/**
 * Link rastreado: registra o clique (UTMs, fbclid, gclid…), gera um protocolo e abre o WhatsApp
 * com a mensagem + protocolo. Quando o cliente envia, o CRM liga o lead à campanha.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) return page(404, "Link não encontrado.");
  const url = new URL(req.url);
  const q = url.searchParams;
  const db = supabaseAdmin();

  const { data: link } = await db.from("tracking_links").select("*").eq("slug", slug).eq("archived", false).maybeSingle();
  if (!link) return page(404, "Link não encontrado ou desativado.");

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim();
  const ipHash = ip ? createHash("sha256").update(`${ip}:${envOptional("SUPABASE_SERVICE_ROLE_KEY", "nexo")}`).digest("hex").slice(0, 32) : null;
  try { await rateLimit(`r:${ipHash ?? "anon"}`, 30, 60); } catch { return page(429, "Muitos acessos seguidos. Tente de novo em instantes."); }

  // Número de destino: o do link, o do canal ou (no script do site) um número da própria empresa
  const { data: chans } = await db.from("whatsapp_channels").select("id, phone_number").eq("organization_id", link.organization_id);
  const orgPhones = (chans ?? []).map((c) => (c.phone_number ?? "").replace(/\D/g, "")).filter(Boolean);
  let phone: string = link.phone ?? (chans ?? []).find((c) => c.id === link.channel_id)?.phone_number?.replace(/\D/g, "") ?? orgPhones[0] ?? "";
  let message: string | null = link.message;
  if (link.kind === "site") {
    const to = (q.get("to") ?? "").replace(/\D/g, "");
    if (to && (orgPhones.includes(to) || to === link.phone)) phone = to;
    message = clip(q.get("text"), 800) ?? message;
  }
  if (!/^\d{10,15}$/.test(phone)) return page(503, "Este link ainda não tem um número de WhatsApp configurado.");

  // UTMs: as da URL valem mais que as padrão do link
  const pick = (k: "utm_source" | "utm_medium" | "utm_campaign" | "utm_content" | "utm_term") => {
    const v = clip(q.get(k));
    return v && !/^\{\{?.*\}\}?$/.test(v) ? v : (link[k] as string | null);
  };
  let code = newCode();
  for (let i = 0; i < 4; i++) {
    const { error } = await db.from("tracking_clicks").insert({
      organization_id: link.organization_id, link_id: link.id, code,
      utm_source: pick("utm_source"), utm_medium: pick("utm_medium"), utm_campaign: pick("utm_campaign"), utm_content: pick("utm_content"), utm_term: pick("utm_term"),
      fbclid: clip(q.get("fbclid"), 500), gclid: clip(q.get("gclid"), 500), ttclid: clip(q.get("ttclid"), 500),
      referrer: clip(q.get("ref") ?? req.headers.get("referer"), 500), landing_url: clip(q.get("page"), 500),
      user_agent: clip(req.headers.get("user-agent"), 300), ip_hash: ipHash,
    });
    if (!error) break;
    if (error.code !== "23505") { console.error("[rastreio] clique", error.message); break; }
    code = newCode();
  }

  const target = `https://wa.me/${phone}?text=${encodeURIComponent(withProtocol(message, code))}`;
  return new Response(null, { status: 302, headers: { location: target, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
