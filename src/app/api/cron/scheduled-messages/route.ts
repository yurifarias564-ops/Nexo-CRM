import { isCronRequest } from "@/lib/cron";
import { dispatchDue } from "@/lib/scheduled";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Disparador das mensagens agendadas. Chamado a cada minuto pelo pg_cron do
 * Supabase (ou por qualquer agendador) com "Authorization: Bearer CRON_SECRET".
 */
async function handle(req: Request) {
  if (!isCronRequest(req)) return new Response("unauthorized", { status: 401 });
  try {
    const total = { claimed: 0, sent: 0, retried: 0, failed: 0 };
    // Até 4 lotes por chamada (200 mensagens/minuto); para quando esvaziar
    for (let i = 0; i < 4; i++) {
      const r = await dispatchDue(50);
      total.claimed += r.claimed; total.sent += r.sent; total.retried += r.retried; total.failed += r.failed;
      if (r.claimed < 50) break;
    }
    return Response.json(total);
  } catch (e) {
    console.error("[cron scheduled]", e);
    return new Response("error", { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
