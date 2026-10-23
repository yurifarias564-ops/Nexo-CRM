import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { appUrl, envOptional } from "@/lib/env";
import { fail, HttpError, ok } from "@/lib/http";
import { META_APP_ID, webhookVerifyToken } from "@/lib/meta-config";
import { META_ES_CONFIG_ID } from "@/lib/meta-public";

export const runtime = "nodejs";

/** Configuração global do app da Meta — só para o dono da plataforma. */
export async function GET() {
  try {
    await requireApiContext({ manage: true });
    const { data: house } = await (await supabaseServer()).rpc("is_house");
    if (!house) throw new HttpError(404, "Não encontrado");
    let verifyToken: string | null = null;
    try { verifyToken = webhookVerifyToken(); } catch { /* sem chave do servidor */ }
    return ok({
      webhookUrl: `${appUrl()}/api/webhooks/meta`,
      verifyToken,
      appId: META_APP_ID,
      configId: META_ES_CONFIG_ID || null,
      appSecret: Boolean(envOptional("META_APP_SECRET")),
      fields: ["messages", "calls", "history", "smb_message_echoes", "smb_app_state_sync"],
    });
  } catch (e) {
    return fail(e);
  }
}
