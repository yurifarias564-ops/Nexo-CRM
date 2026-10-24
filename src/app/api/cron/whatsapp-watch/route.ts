import { isCronRequest } from "@/lib/cron";
import { watchAll } from "@/lib/whatsapp/watchdog";
import { refreshAvatars } from "@/lib/whatsapp/avatars";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Vigia da conexão por QR Code. Chamado a cada minuto pelo pg_cron do Supabase. */
async function handle(req: Request) {
  if (!isCronRequest(req)) return new Response("unauthorized", { status: 401 });
  try {
    const watch = await watchAll(40_000);
    const avatars = await refreshAvatars(8).catch(() => 0);
    return Response.json({ watch, avatars });
  } catch (e) {
    console.error("[cron whatsapp-watch]", e);
    return new Response("error", { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
