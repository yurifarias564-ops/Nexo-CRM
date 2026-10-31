import { NextResponse } from "next/server";
import { requireApiContext } from "@/lib/auth";
import { appUrl } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { readState } from "@/lib/instagram";
import { inboundToken, inboundUrl, olxExchange, olxRegisterWebhook } from "@/lib/portals";

export const runtime = "nodejs";

const back = (msg: string) => NextResponse.redirect(`${appUrl()}/settings?tab=integrations&olx=${encodeURIComponent(msg)}`);

/** Volta do login da OLX: guarda o acesso e cadastra o endereço que recebe os chats. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get("error")) return back("cancelado");
  try {
    const ctx = await requireApiContext({ manage: true });
    const st = readState(u.searchParams.get("state") ?? "");
    if (st.orgId !== ctx.org.id || st.userId !== ctx.userId) return back("outra-conta");
    const token = await olxExchange(u.searchParams.get("code") ?? "");
    const db = supabaseAdmin();
    let webhookOk = true, err: string | null = null;
    try { await olxRegisterWebhook(token, inboundUrl((await inboundToken(ctx.org.id))!, "OLX")); }
    catch (e) { webhookOk = false; err = (e as Error).message; }
    await db.from("olx_accounts").upsert({ organization_id: ctx.org.id, access_token: token, webhook_ok: webhookOk, last_error: err, connected_at: new Date().toISOString() });
    return back(webhookOk ? "ok" : "sem-webhook");
  } catch (e) {
    console.error("[olx callback]", e);
    return back("erro");
  }
}
