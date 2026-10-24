import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { HttpError } from "@/lib/http";

/**
 * Confere, com as regras do banco (RLS), se a pessoa logada enxerga o lead/conversa.
 * Usar antes de qualquer ação feita com a chave de serviço (que ignora o RLS):
 * vendedor só age nos próprios leads e nas conversas do número dele.
 */
export async function assertCanSee(kind: "lead" | "conversation", id: string) {
  const sb = await supabaseServer();
  const { data } = await sb.from(kind === "lead" ? "leads" : "conversations").select("id").eq("id", id).maybeSingle();
  if (!data) throw new HttpError(404, kind === "lead" ? "Lead não encontrado" : "Conversa não encontrada");
}
