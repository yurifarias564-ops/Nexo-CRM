import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { igConfig, igRedirectUri, igVerifyToken } from "@/lib/instagram";
import { inboundToken, inboundUrl, olxConfig, olxRedirect, olxUnregister, rotateInbound } from "@/lib/portals";
import { appUrl } from "@/lib/env";

export const runtime = "nodejs";

/** Situação das integrações de portais e Instagram (para a aba Integrações). */
export async function GET() {
  try {
    const ctx = await requireApiContext({ manage: true });
    const db = supabaseAdmin();
    const token = await inboundToken(ctx.org.id);
    const [{ data: link }, { data: olx }, { data: igs }] = await Promise.all([
      db.from("inbound_links").select("last_used_at, received").eq("organization_id", ctx.org.id).maybeSingle(),
      db.from("olx_accounts").select("webhook_ok, last_error, connected_at").eq("organization_id", ctx.org.id).maybeSingle(),
      db.from("whatsapp_channels").select("id, name, ig_username, status, last_error, ig_token_expires_at").eq("organization_id", ctx.org.id).eq("provider", "instagram"),
    ]);
    return ok({
      inbound: { olx: inboundUrl(token!, "OLX"), webmotors: inboundUrl(token!, "Webmotors"), site: inboundUrl(token!, "Site"), lastUsedAt: link?.last_used_at ?? null, received: link?.received ?? 0 },
      olx: { available: Boolean(olxConfig()), connected: Boolean(olx), webhookOk: olx?.webhook_ok ?? false, error: olx?.last_error ?? null, connectedAt: olx?.connected_at ?? null },
      instagram: { available: Boolean(igConfig()), accounts: igs ?? [] },
      // Para o dono da plataforma configurar os apps (só endereços públicos, nenhum segredo)
      setup: ctx.isHouse ? {
        igWebhook: `${appUrl()}/api/webhooks/instagram`, igVerifyToken: igVerifyToken(), igRedirect: igRedirectUri(), olxRedirect: olxRedirect(),
      } : null,
    });
  } catch (e) {
    return fail(e);
  }
}

const Body = z.object({ action: z.enum(["rotate", "olx_disconnect", "ig_disconnect", "ig_check"]), channelId: z.string().uuid().optional() });

export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const b = Body.parse(await readJson(req, 500));
    const db = supabaseAdmin();
    if (b.action === "ig_check") {
      // Diagnóstico (só a conta da plataforma): testa o par app ID / chave secreta do Instagram sem expor a chave.
      if (!ctx.isHouse) return ok({ ok: false });
      const c = igConfig();
      if (!c) return ok({ configured: false });
      const r = await fetch("https://api.instagram.com/oauth/access_token", {
        method: "POST",
        body: new URLSearchParams({ client_id: c.appId, client_secret: c.secret, grant_type: "authorization_code", redirect_uri: igRedirectUri(), code: "teste-invalido" }),
        signal: AbortSignal.timeout(15_000),
      });
      const j = await r.json().catch(() => ({}));
      return ok({ configured: true, appId: c.appId, secretLen: c.secret.length, secretHex: /^[0-9a-f]+$/.test(c.secret), secretTrimmed: c.secret === c.secret.trim(), redirect: igRedirectUri(), status: r.status, api: j });
    }
    if (b.action === "rotate") await rotateInbound(ctx.org.id);
    if (b.action === "olx_disconnect") {
      const { data } = await db.from("olx_accounts").select("access_token").eq("organization_id", ctx.org.id).maybeSingle();
      if (data) await olxUnregister(data.access_token);
      await db.from("olx_accounts").delete().eq("organization_id", ctx.org.id);
    }
    if (b.action === "ig_disconnect" && b.channelId) {
      await db.from("whatsapp_channels").update({ status: "disconnected" }).eq("id", b.channelId).eq("organization_id", ctx.org.id).eq("provider", "instagram");
    }
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
