import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireApiContext } from "@/lib/auth";
import { appUrl } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exchangeCode, readState, subscribe } from "@/lib/instagram";

export const runtime = "nodejs";

const back = (msg: string) => NextResponse.redirect(`${appUrl()}/settings?tab=integrations&ig=${encodeURIComponent(msg)}`);

/** Volta do login do Instagram: guarda a conta como canal e liga o recebimento das mensagens. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get("error")) return back("cancelado");
  try {
    const ctx = await requireApiContext({ manage: true });
    const st = readState(u.searchParams.get("state") ?? "");
    if (st.orgId !== ctx.org.id || st.userId !== ctx.userId) return back("outra-conta");
    const code = (u.searchParams.get("code") ?? "").replace(/#_$/, "");
    if (!code) return back("erro");
    const acc = await exchangeCode(code);
    const db = supabaseAdmin();
    const { data: existing } = await db.from("whatsapp_channels").select("id, organization_id").eq("ig_user_id", acc.userId).maybeSingle();
    if (existing && existing.organization_id !== ctx.org.id) return back("em-uso");
    let id = existing?.id as string | undefined;
    const fields = { name: `Instagram @${acc.username}`.slice(0, 80), status: "connected" as const, ig_username: acc.username, ig_token_expires_at: acc.expiresAt.toISOString(), last_error: null };
    if (id) {
      await db.from("whatsapp_channels").update(fields).eq("id", id);
      await db.from("whatsapp_channel_secrets").update({ meta_access_token: acc.token, updated_at: new Date().toISOString() }).eq("channel_id", id);
    } else {
      const { data: ch, error } = await db.from("whatsapp_channels").insert({ organization_id: ctx.org.id, provider: "instagram", ig_user_id: acc.userId, ...fields }).select("id").single();
      if (error) throw error;
      id = ch.id;
      await db.from("whatsapp_channel_secrets").insert({ channel_id: id, meta_access_token: acc.token, webhook_secret: randomBytes(24).toString("hex") });
    }
    try { await subscribe(acc.token); } catch (e) {
      await db.from("whatsapp_channels").update({ last_error: `Recebimento de mensagens: ${(e as Error).message}`.slice(0, 300) }).eq("id", id!);
      return back("sem-webhook");
    }
    return back("ok");
  } catch (e) {
    console.error("[instagram callback]", e);
    return NextResponse.redirect(`${appUrl()}/settings?tab=integrations&ig=erro&igmsg=${encodeURIComponent(((e as Error).message ?? "").slice(0, 200))}`);
  }
}
