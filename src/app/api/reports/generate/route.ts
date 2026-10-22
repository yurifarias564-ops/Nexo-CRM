import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { runReport } from "@/lib/reports/run";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Período inválido"), send: z.boolean().default(false) });

/** Gera o relatório do mês agora (prévia) ou gera e envia no WhatsApp. */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`report-gen:${ctx.org.id}`, 15, 3600, "Limite de relatórios gerados por hora atingido. Tente mais tarde.");
    const b = Body.parse(await readJson(req, 4_000));
    const r = await runReport({ orgId: ctx.org.id, period: b.period, kind: b.send ? "manual" : "preview", send: b.send, requestedBy: ctx.userId });
    return ok({ runId: r.runId, status: r.status, headline: r.written.headline, fileName: r.fileName }, 201);
  } catch (e) {
    return fail(e);
  }
}
