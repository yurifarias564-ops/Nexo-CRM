import { isCronRequest } from "@/lib/cron";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentPeriod, hourIn, isLastDayOfMonth } from "@/lib/reports/data";
import { runReport, type ReportSettings } from "@/lib/reports/run";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 3;
const PER_CALL = 4; // ~4 relatórios por chamada (cada um usa IA); o cron roda de hora em hora

/** Envio automático do relatório mensal no último dia do mês (fuso de cada empresa). */
async function handle(req: Request) {
  if (!isCronRequest(req)) return new Response("unauthorized", { status: 401 });

  const db = supabaseAdmin();
  // Gerações interrompidas há mais de 30 min liberam nova tentativa
  await db.from("report_runs").update({ status: "failed", error: "Geração interrompida" })
    .eq("kind", "auto").eq("status", "generating").lt("started_at", new Date(Date.now() - 30 * 60_000).toISOString());

  const { data: settings, error } = await db.from("report_settings").select("*").eq("enabled", true)
    .not("template_id", "is", null).not("channel_id", "is", null).not("target_id", "is", null);
  if (error) return new Response("error", { status: 500 });

  const out = { due: 0, sent: 0, failed: 0, skipped: 0 };
  for (const s of (settings ?? []) as ReportSettings[]) {
    if (out.sent + out.failed >= PER_CALL) break;
    const tz = s.time_zone || "America/Sao_Paulo";
    if (!isLastDayOfMonth(tz) || hourIn(tz) < s.send_hour) continue;
    const period = currentPeriod(tz);

    // Empresa precisa estar com a assinatura em dia
    const { data: sub } = await db.from("subscriptions").select("status, current_period_end").eq("organization_id", s.organization_id).maybeSingle();
    if (sub?.status !== "active" || (sub.current_period_end && new Date(sub.current_period_end) <= new Date())) { out.skipped++; continue; }

    // Reserva o envio do mês (índice único impede duplicar)
    const { data: existing } = await db.from("report_runs").select("id, status, attempts").eq("organization_id", s.organization_id).eq("kind", "auto").eq("period", `${period}-01`).maybeSingle();
    let runId: string | undefined;
    if (!existing) {
      const ins = await db.from("report_runs").insert({ organization_id: s.organization_id, period: `${period}-01`, kind: "auto", status: "generating", target_name: s.target_name }).select("id").single();
      if (ins.error) { out.skipped++; continue; } // outra execução reservou primeiro
      runId = ins.data.id;
    } else if (existing.status === "failed" && existing.attempts < MAX_ATTEMPTS) {
      const upd = await db.from("report_runs").update({ status: "generating", attempts: existing.attempts + 1, started_at: new Date().toISOString(), error: null })
        .eq("id", existing.id).eq("status", "failed").select("id").maybeSingle();
      if (!upd.data) { out.skipped++; continue; }
      runId = existing.id;
    } else { out.skipped++; continue; }

    out.due++;
    try {
      await runReport({ orgId: s.organization_id, period, kind: "auto", send: true, runId });
      out.sent++;
    } catch {
      out.failed++;
    }
  }
  return Response.json(out);
}

export const GET = handle;
export const POST = handle;
