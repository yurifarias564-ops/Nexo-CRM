import { isCronRequest } from "@/lib/cron";
import { dispatchBroadcasts } from "@/lib/broadcasts-server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Disparador dos disparos em massa. Chamado a cada minuto pelo pg_cron (só quando há envio pendente). */
async function handle(req: Request) {
  if (!isCronRequest(req)) return new Response("unauthorized", { status: 401 });
  try {
    return Response.json(await dispatchBroadcasts(50_000));
  } catch (e) {
    console.error("[cron broadcasts]", e);
    return new Response("error", { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
