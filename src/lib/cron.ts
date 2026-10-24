import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { envOptional } from "@/lib/env";

/** Segredo das rotas automáticas (cron): variável própria ou derivado da chave do servidor. */
export function cronSecret(): string {
  const v = envOptional("CRON_SECRET");
  if (v) return v;
  const base = envOptional("SUPABASE_SERVICE_ROLE_KEY");
  if (!base) throw new Error("Variável de ambiente ausente: CRON_SECRET");
  return createHmac("sha256", base).update("nexo-cron").digest("hex");
}

export function isCronRequest(req: Request): boolean {
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${cronSecret()}`;
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
