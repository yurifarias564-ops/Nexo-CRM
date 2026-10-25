import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { exchangeCode } from "@/lib/whatsapp/embedded";
import { listAssets, loadConn, syncAds } from "@/lib/meta-ads";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({ code: z.string().min(10).max(2000) });

/**
 * "Conectar com o Facebook": troca o código pelo acesso da empresa, descobre sozinho a conta de anúncios,
 * o pixel e a página, já liga o envio de vendas ao pixel e puxa os últimos 30 dias.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`meta-oauth:${ctx.org.id}`, 10, 600, "Muitas tentativas. Aguarde alguns minutos.");
    const { code } = Body.parse(await readJson(req, 5000));
    const cred = await exchangeCode(code);
    const assets = await listAssets(cred);
    if (!assets.accounts.length) throw new HttpError(422, "Essa conta do Facebook não tem nenhuma conta de anúncios liberada. Na janela da Meta, marque a conta de anúncios e o pixel da empresa.");

    const db = supabaseAdmin();
    const { error: secErr } = await db.from("meta_secrets").upsert({ organization_id: ctx.org.id, ["access_token"]: cred, updated_at: new Date().toISOString() });
    if (secErr) throw secErr;

    // Mantém a escolha anterior se ela ainda existir; senão, a conta ativa com pixel
    const { conn: prev } = await loadConn(ctx.org.id);
    const account = assets.accounts.find((a) => a.id === prev?.ad_account_id) ?? assets.accounts[0]!;
    const pixel = account.pixels.find((p) => p.id === prev?.pixel_id) ?? account.pixels[0] ?? null;
    const page = assets.pages.find((p) => p.id === prev?.page_id) ?? (assets.pages.length === 1 ? assets.pages[0] : null);

    const { error } = await db.from("meta_connections").upsert({
      organization_id: ctx.org.id, ad_account_id: account.id, ad_account_name: account.name, currency: account.currency || "BRL",
      pixel_id: pixel?.id ?? null, page_id: page?.id ?? null,
      send_purchase: prev?.send_purchase ?? true, send_lead: prev?.send_lead ?? true, last_error: null, updated_at: new Date().toISOString(),
    });
    if (error) throw error;

    const synced = await syncAds(ctx.org.id, new Date(Date.now() - 30 * 86_400_000), new Date()).catch((e) => ({ error: (e as Error).message }));
    return ok({ account: { id: account.id, name: account.name }, pixel, page, choices: assets.accounts.length > 1 || account.pixels.length > 1 || assets.pages.length > 1, synced });
  } catch (e) {
    return fail(e);
  }
}
