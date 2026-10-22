"use client";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Cliente único no navegador (evita múltiplas conexões de realtime). */
export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    client = createBrowserClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
    );
  }
  return client;
}
