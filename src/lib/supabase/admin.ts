import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let admin: SupabaseClient | null = null;

/**
 * Cliente com service role — IGNORA RLS. Usar apenas em webhooks e em rotas
 * que já validaram explicitamente o acesso do usuário à empresa.
 */
export function supabaseAdmin(): SupabaseClient {
  if (!admin) {
    admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}
