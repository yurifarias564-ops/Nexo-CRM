import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/http";

/**
 * Limite de chamadas por chave numa janela de tempo (contador no Postgres,
 * funciona com várias instâncias do servidor). Falha aberta se o banco
 * estiver indisponível, para não derrubar o atendimento.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number, message = "Muitas solicitações. Aguarde um instante e tente de novo.") {
  const { data, error } = await supabaseAdmin().rpc("hit_rate_limit", { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) {
    console.error("[rate-limit]", error.message);
    return;
  }
  if (data === false) throw new HttpError(429, message);
}
