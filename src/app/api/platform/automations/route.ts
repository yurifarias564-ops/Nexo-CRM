import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/env";
import { cronSecret } from "@/lib/cron";
import { fail, HttpError, ok } from "@/lib/http";

export const runtime = "nodejs";

/**
 * Liga as automações do banco (mensagens agendadas, relatórios, vigia do WhatsApp):
 * grava no cofre do Supabase o endereço do app e o segredo das rotas automáticas.
 * Só o dono da plataforma. O segredo nunca aparece na tela.
 */
export async function POST() {
  try {
    await requireApiContext({ manage: true });
    const { data: house } = await (await supabaseServer()).rpc("is_house");
    if (!house) throw new HttpError(404, "Não encontrado");
    const { error } = await supabaseAdmin().rpc("configure_automations", { p_url: appUrl(), p_secret: cronSecret() });
    if (error) throw error;
    return ok({ configured: true, url: appUrl() });
  } catch (e) {
    return fail(e);
  }
}
