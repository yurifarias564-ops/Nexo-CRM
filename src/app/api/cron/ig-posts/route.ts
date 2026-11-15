import { isCronRequest } from "@/lib/cron";
import { runIgPosts } from "@/lib/ig-flows-server";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/** Publica no Instagram o que está agendado. Chamado a cada minuto pelo pg_cron (só quando há algo pendente). */
async function handle(req: Request) {
  if (!isCronRequest(req)) return new Response("unauthorized", { status: 401 });
  try {
    return Response.json(await runIgPosts());
  } catch (e) {
    console.error("[cron ig-posts]", e);
    return new Response("error", { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
