import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/http";
import { sendTemplateMessage, sendText, WindowClosedError, type SendTarget } from "@/lib/send";

export const MAX_ATTEMPTS = 3;
const MAX_AHEAD_MS = 366 * 24 * 3600 * 1000;

export interface ScheduleInput {
  target: SendTarget;
  sendAt: Date;
  timeZone: string;
  body?: string | null;
  template?: { name: string; language: string; params: string[] } | null;
}

/** Cria a mensagem agendada (RLS: usuário só agenda na própria empresa). */
export async function createScheduled(sb: SupabaseClient, ctx: { orgId: string; userId: string }, input: ScheduleInput) {
  if (!input.target.leadId && !input.target.conversationId) throw new HttpError(422, "Informe o lead ou a conversa");
  if (input.sendAt.getTime() < Date.now() - 60_000) throw new HttpError(422, "Esse horário já passou. Escolha um momento no futuro.");
  if (input.sendAt.getTime() > Date.now() + MAX_AHEAD_MS) throw new HttpError(422, "Agende com no máximo 1 ano de antecedência.");
  const body = input.body?.trim() || null;
  if (!body && !input.template) throw new HttpError(422, "Escreva a mensagem ou escolha um modelo");

  if (input.target.leadId) {
    const { data: lead } = await sb.from("leads").select("id, phone").eq("id", input.target.leadId).maybeSingle();
    if (!lead) throw new HttpError(404, "Lead não encontrado");
    if (!lead.phone && !input.target.conversationId) {
      const { data: conv } = await sb.from("conversations").select("id").eq("lead_id", lead.id).limit(1).maybeSingle();
      if (!conv) throw new HttpError(422, "Este lead não tem telefone nem conversa no WhatsApp");
    }
  }

  const { data, error } = await sb.from("scheduled_messages").insert({
    organization_id: ctx.orgId,
    lead_id: input.target.leadId ?? null,
    conversation_id: input.target.conversationId ?? null,
    created_by: ctx.userId,
    body,
    template_name: input.template?.name ?? null,
    template_language: input.template?.language ?? null,
    template_params: input.template?.params ?? [],
    send_at: input.sendAt.toISOString(),
    time_zone: input.timeZone,
  }).select("id, send_at").single();
  if (error) throw error;

  if (input.target.leadId) {
    await sb.from("activities").insert({
      organization_id: ctx.orgId, lead_id: input.target.leadId, actor_id: ctx.userId, type: "message_scheduled",
      payload: { scheduled_id: data.id, send_at: data.send_at, preview: (body ?? `Modelo: ${input.template?.name}`).slice(0, 140) },
    });
  }
  return { id: data.id as string, sendAt: data.send_at as string };
}

type Row = {
  id: string; organization_id: string; lead_id: string | null; conversation_id: string | null; created_by: string | null;
  body: string | null; template_name: string | null; template_language: string | null; template_params: unknown;
  attempts: number;
};

/** Erros que não adianta tentar de novo (precisam de ação do usuário). */
export function isPermanent(e: unknown): boolean {
  if (e instanceof WindowClosedError) return true;
  if (e instanceof HttpError) return e.status >= 400 && e.status < 500 && e.status !== 429 && e.status !== 408;
  return false;
}

export function friendly(e: unknown): string {
  if (e instanceof WindowClosedError) {
    return "API oficial: o cliente não responde há mais de 24h, então a Meta só aceita modelo aprovado. Reagende usando um modelo.";
  }
  if (e instanceof HttpError) return e.message;
  return "Falha temporária ao enviar";
}

/**
 * Envia as mensagens vencidas. Seguro para rodar em paralelo: a reserva no
 * banco é atômica. Falhas temporárias são reagendadas (até 3 tentativas).
 */
export async function dispatchDue(limit = 50) {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("claim_scheduled_messages", { p_limit: limit });
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  const result = { claimed: rows.length, sent: 0, retried: 0, failed: 0 };
  const activeCache = new Map<string, boolean>();

  for (const m of rows) {
    const now = new Date().toISOString();
    try {
      // Empresa com assinatura vencida não envia
      if (!activeCache.has(m.organization_id)) {
        const { data: sub } = await db.from("subscriptions").select("status, current_period_end").eq("organization_id", m.organization_id).maybeSingle();
        activeCache.set(m.organization_id, sub?.status === "active" && (!sub.current_period_end || new Date(sub.current_period_end) > new Date()));
      }
      if (!activeCache.get(m.organization_id)) throw new HttpError(402, "Assinatura inativa: a mensagem não foi enviada.");

      const target: SendTarget = m.conversation_id ? { conversationId: m.conversation_id } : { leadId: m.lead_id! };
      const params = Array.isArray(m.template_params) ? (m.template_params as unknown[]).map(String) : [];
      const sent = m.template_name && m.template_language
        ? await sendTemplateMessage(db, m.organization_id, m.created_by, target, m.template_name, m.template_language, params)
        : await sendText(db, m.organization_id, m.created_by, target, m.body ?? "");

      await db.from("scheduled_messages").update({ status: "sent", sent_at: now, sent_message_id: sent.id, last_error: null }).eq("id", m.id);
      if (m.lead_id) {
        await db.from("activities").insert({ organization_id: m.organization_id, lead_id: m.lead_id, actor_id: m.created_by, type: "scheduled_sent", payload: { scheduled_id: m.id } });
      }
      result.sent++;
    } catch (e) {
      const message = friendly(e);
      if (!isPermanent(e) && m.attempts < MAX_ATTEMPTS) {
        const retryAt = new Date(Date.now() + 5 * 60_000 * m.attempts).toISOString();
        await db.from("scheduled_messages").update({ status: "pending", send_at: retryAt, last_error: `${message} — nova tentativa às ${retryAt.slice(11, 16)} UTC` }).eq("id", m.id);
        result.retried++;
      } else {
        await db.from("scheduled_messages").update({ status: "failed", last_error: message }).eq("id", m.id);
        if (m.lead_id) {
          await db.from("activities").insert({ organization_id: m.organization_id, lead_id: m.lead_id, actor_id: m.created_by, type: "scheduled_failed", payload: { scheduled_id: m.id, error: message } });
        }
        result.failed++;
      }
      if (!(e instanceof HttpError)) console.error("[scheduled dispatch]", m.id, e);
    }
  }
  return result;
}
