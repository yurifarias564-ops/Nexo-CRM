import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { requireApiContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { ingestBatch, loadChannel } from "@/lib/whatsapp";
import * as evo from "@/lib/whatsapp/evolution";
import * as meta from "@/lib/whatsapp/meta";
import type { NormalizedMessage } from "@/lib/whatsapp/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({ cursor: z.number().int().min(0).default(0) });
const CHATS_PER_CALL = 4;
const MAX_PAGES_PER_CHAT = 40; // até 4.000 mensagens por conversa

/**
 * Importa o histórico completo em etapas (o navegador chama repetidamente
 * com o cursor até `done`), evitando estouro de tempo em contas grandes.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`history:${ctx.org.id}`, 2000, 3600);
    const { cursor } = Body.parse(await readJson(req));
    const ch = await loadChannel(id);
    if (ch.organization_id !== ctx.org.id) throw new HttpError(404, "Canal não encontrado");
    if (ch.status !== "connected") throw new HttpError(409, "Conecte o número antes de importar o histórico");

    if (ch.provider === "meta") {
      await meta.requestHistorySync(ch.meta_phone_number_id!, ch.secrets.meta_access_token!);
      return ok({ done: true, mode: "async" as const, message: "Solicitação enviada. O histórico chega automaticamente nos próximos minutos." });
    }

    const chats = await evo.findChats(ch.evolution_instance!);
    chats.sort((a, b) => a.remoteJid.localeCompare(b.remoteJid)); // ordem estável entre chamadas
    const slice = chats.slice(cursor, cursor + CHATS_PER_CALL);
    let imported = 0;

    for (const chat of slice) {
      const batch: NormalizedMessage[] = [];
      let page = 1;
      let pages = 1;
      do {
        const r = await evo.findMessages(ch.evolution_instance!, chat.remoteJid, page);
        pages = r.pages;
        for (const rec of r.records) {
          const m = evo.normalizeRecord(rec, true);
          if (m) {
            if (!m.contact_name && chat.pushName && m.direction === "in") m.contact_name = chat.pushName;
            batch.push(m);
          }
        }
        page++;
      } while (page <= pages && page <= MAX_PAGES_PER_CHAT);
      if (batch.length) await ingestBatch(id, batch, true);
      imported += batch.length;
    }

    const next = cursor + slice.length;
    const done = next >= chats.length;
    if (done) await supabaseAdmin().from("whatsapp_channels").update({ history_imported_at: new Date().toISOString() }).eq("id", id);
    return ok({ done, next, total: chats.length, imported, mode: "sync" as const });
  } catch (e) {
    return fail(e);
  }
}
