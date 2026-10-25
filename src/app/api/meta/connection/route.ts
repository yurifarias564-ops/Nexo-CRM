import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadConn, syncAds, verify } from "@/lib/meta-ads";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Conexão com o Meta Ads (sem nunca devolver a chave de acesso). */
export async function GET() {
  try {
    const ctx = await requireApiContext({ manage: true });
    const { conn, cred } = await loadConn(ctx.org.id);
    const { data: ch } = await supabaseAdmin().from("whatsapp_channels").select("meta_waba_id").eq("organization_id", ctx.org.id).not("meta_waba_id", "is", null).limit(1).maybeSingle();
    return ok({ conn, hasCred: Boolean(cred), credHint: cred ? `…${cred.slice(-4)}` : null, waba: Boolean(ch?.meta_waba_id) });
  } catch (e) {
    return fail(e);
  }
}

const id = (re: RegExp, msg: string) => z.string().trim().transform((v) => v.replace(/\s/g, "")).refine((v) => !v || re.test(v), msg).nullable().optional();
const Body = z.object({
  ad_account_id: id(/^(act_)?\d{5,25}$/, "ID da conta de anúncios inválido (só números, ex.: 123456789012345)"),
  pixel_id: id(/^\d{5,25}$/, "ID do pixel/conjunto de dados inválido (só números)"),
  page_id: id(/^\d{5,25}$/, "ID da página inválido (só números)"),
  send_purchase: z.boolean(),
  send_lead: z.boolean(),
  // Chave nova colada pelo usuário (vazio = manter a que já existe)
  credential: z.string().trim().max(1000).regex(/^[A-Za-z0-9_\-.|]*$/, "A chave de acesso tem caracteres inválidos").optional(),
});

export async function PUT(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const b = Body.parse(await readJson(req, 10_000));
    const db = supabaseAdmin();
    const current = await loadConn(ctx.org.id);
    const cred = b.credential || current.cred;
    const account = b.ad_account_id ? (b.ad_account_id.startsWith("act_") ? b.ad_account_id : `act_${b.ad_account_id}`) : null;
    let info: Awaited<ReturnType<typeof verify>> = {};
    if (cred && (account || b.pixel_id)) info = await verify(cred, account, b.pixel_id || null);
    if (b.credential) {
      const { error } = await db.from("meta_secrets").upsert({ organization_id: ctx.org.id, ["access_token"]: b.credential, updated_at: new Date().toISOString() });
      if (error) throw error;
    }
    const { data, error } = await db.from("meta_connections").upsert({
      organization_id: ctx.org.id, ad_account_id: account, ad_account_name: info.account?.name ?? current.conn?.ad_account_name ?? null,
      currency: info.account?.currency ?? current.conn?.currency ?? "BRL", pixel_id: b.pixel_id || null, page_id: b.page_id || null,
      send_purchase: b.send_purchase, send_lead: b.send_lead, updated_at: new Date().toISOString(),
    }).select("*").single();
    if (error) throw error;
    // Primeira carga: últimos 30 dias
    let synced: unknown = null;
    if (account && cred) synced = await syncAds(ctx.org.id, new Date(Date.now() - 30 * 86_400_000), new Date()).catch((e) => ({ error: (e as Error).message }));
    return ok({ conn: data, info, synced });
  } catch (e) {
    return fail(e);
  }
}

/** Desconecta: apaga a chave e para de enviar eventos (os números já puxados continuam). */
export async function DELETE() {
  try {
    const ctx = await requireApiContext({ manage: true });
    const db = supabaseAdmin();
    await db.from("meta_secrets").delete().eq("organization_id", ctx.org.id);
    await db.from("meta_connections").update({ send_purchase: false, send_lead: false }).eq("organization_id", ctx.org.id);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
