import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import * as a4 from "@/lib/voip/api4com";
import { handleHangup } from "@/lib/voip";

export const runtime = "nodejs";
export const maxDuration = 120;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Fim de ligação da Api4Com (com a gravação). Autenticado pela chave secreta da empresa na URL. */
export async function POST(req: Request) {
  const u = new URL(req.url);
  const gateway = u.searchParams.get("g") ?? "";
  const hookKey = u.searchParams.get("k") ?? "";
  if (!/^[a-z0-9-]{6,64}$/.test(gateway) || hookKey.length < 32) return new Response("forbidden", { status: 403 });

  const db = supabaseAdmin();
  const { data: s } = await db.from("voip_settings").select("organization_id, domain, gateway").eq("gateway", gateway).maybeSingle();
  if (!s) return new Response("forbidden", { status: 403 });
  const { data: sec } = await db.from("voip_secrets").select("api_token, webhook_key").eq("organization_id", s.organization_id).maybeSingle();
  if (!sec || !same(hookKey, sec.webhook_key)) return new Response("forbidden", { status: 403 });

  const raw = await req.text();
  if (raw.length > 200_000) return new Response("too large", { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response("bad request", { status: 400 }); }

  const ev = a4.parseHangup(body);
  if (!ev) return new Response("ok"); // outros eventos: ignorados
  if (ev.metadata.gateway && ev.metadata.gateway !== gateway) return new Response("ok");
  if (ev.metadata.orgId && ev.metadata.orgId !== s.organization_id) return new Response("ok");
  try {
    await handleHangup({ ...s, ...sec }, ev);
  } catch (e) {
    console.error("[api4com webhook]", e);
    return new Response("error", { status: 500 }); // a central tenta de novo
  }
  return new Response("ok");
}
