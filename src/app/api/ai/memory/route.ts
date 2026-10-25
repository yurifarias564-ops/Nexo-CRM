import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Confere (com as permissões de quem pede) que o lead é visível para ele. */
async function visibleLead(leadId: string) {
  const sb = await supabaseServer();
  const { data } = await sb.from("leads").select("id, organization_id").eq("id", leadId).maybeSingle();
  if (!data) throw new HttpError(404, "Lead não encontrado");
  return data;
}

const Add = z.object({ leadId: z.string().uuid(), fact: z.string().trim().min(1, "Escreva a informação").max(500) });

/** Adiciona uma informação à memória do lead (escrita por uma pessoa). */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    const b = Add.parse(await readJson(req, 4000));
    const lead = await visibleLead(b.leadId);
    if (lead.organization_id !== ctx.org.id) throw new HttpError(404, "Lead não encontrado");
    const { error } = await supabaseAdmin().from("ai_lead_memory").insert({ organization_id: ctx.org.id, lead_id: lead.id, fact: b.fact, source: "user", created_by: ctx.userId });
    if (error?.code === "23505") throw new HttpError(409, "Essa informação já está na memória");
    if (error) throw error;
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

const Summary = z.object({ leadId: z.string().uuid(), summary: z.string().trim().max(4000) });

/** Edita o resumo da negociação. */
export async function PATCH(req: Request) {
  try {
    const ctx = await requireApiContext();
    const b = Summary.parse(await readJson(req, 10_000));
    const lead = await visibleLead(b.leadId);
    if (lead.organization_id !== ctx.org.id) throw new HttpError(404, "Lead não encontrado");
    await supabaseAdmin().from("leads").update({ ai_summary: b.summary || null, ai_summary_at: new Date().toISOString() }).eq("id", lead.id);
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
