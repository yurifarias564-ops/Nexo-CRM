import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { createPixCharge } from "@/lib/payments/asaas-store";
import { sendText } from "@/lib/send";
import { formatBRL } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  conversationId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  value: z.number().min(1, "Valor mínimo R$ 1,00").max(1_000_000),
  description: z.string().trim().max(120).optional(),
  payerName: z.string().trim().min(2, "Nome do cliente").max(100),
  payerDoc: z.string().trim().min(11, "CPF ou CNPJ do cliente").max(20),
}).refine((b) => b.conversationId || b.leadId, "Informe a conversa ou o lead");

/** Cobrança Pix pelo Asaas da loja: o CRM fica sabendo quando o cliente paga (e a taxa da plataforma sai por split). */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`pix-charge:${ctx.userId}`, 40, 3600, "Muitas cobranças nesta hora. Aguarde um pouco.");
    const b = Body.parse(await readJson(req, 4_000));
    const sb = await supabaseServer();
    let leadId = b.leadId ?? null;
    let conversationId = b.conversationId ?? null;
    if (conversationId) {
      const { data: c } = await sb.from("conversations").select("lead_id").eq("id", conversationId).maybeSingle();
      if (!c) throw new HttpError(404, "Conversa não encontrada");
      leadId = leadId ?? c.lead_id;
    } else if (leadId) {
      const { data: c } = await sb.from("conversations").select("id").eq("lead_id", leadId).order("last_message_at", { ascending: false }).limit(1).maybeSingle();
      conversationId = c?.id ?? null;
    }
    const r = await createPixCharge(ctx.org.id, { value: b.value, description: b.description, payerName: b.payerName, payerDoc: b.payerDoc, leadId, conversationId, userId: ctx.userId });
    // Duas mensagens: o resumo e o código sozinho (fácil de copiar no celular)
    const target = conversationId ? { conversationId } : { leadId: leadId! };
    await sendText(sb, ctx.org.id, ctx.userId, target, [`💠 *Pix* — ${formatBRL(b.value)}`, b.description ? `Referente a: ${b.description}` : null, "Copie o código da próxima mensagem e cole no app do seu banco (Pix Copia e Cola). Assim que o pagamento cair, confirmo aqui. ✅"].filter(Boolean).join("\n"));
    await sendText(sb, ctx.org.id, ctx.userId, target, r.payload);
    if (leadId) await sb.from("activities").insert({ organization_id: ctx.org.id, lead_id: leadId, actor_id: ctx.userId, type: "note", payload: { text: `Cobrança Pix de ${formatBRL(b.value)} enviada (aguardando pagamento)`, via: "pix" } });
    return ok({ id: r.id }, 201);
  } catch (e) {
    return fail(e);
  }
}

/** A loja tem o Pix Nexo ligado e aprovado? (qualquer pessoa da equipe pode cobrar) */
export async function GET() {
  try {
    const ctx = await requireApiContext();
    const { storeAccount } = await import("@/lib/payments/asaas-store");
    const acc = await storeAccount(ctx.org.id);
    return ok({ enabled: Boolean(acc?.enabled && acc.status === "approved") });
  } catch (e) {
    return fail(e);
  }
}
