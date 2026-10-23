import "server-only";
import { createHmac } from "node:crypto";
import { envOptional } from "@/lib/env";
import { META_APP_ID } from "@/lib/meta-public";

export { META_APP_ID };

/** Token de verificação do webhook: variável própria ou derivado da chave do servidor. */
export function webhookVerifyToken(): string {
  const v = envOptional("META_WEBHOOK_VERIFY_TOKEN");
  if (v) return v;
  const base = envOptional("SUPABASE_SERVICE_ROLE_KEY");
  if (!base) throw new Error("Variável de ambiente ausente: META_WEBHOOK_VERIFY_TOKEN");
  return createHmac("sha256", base).update("nexo-meta-webhook").digest("hex").slice(0, 32);
}
