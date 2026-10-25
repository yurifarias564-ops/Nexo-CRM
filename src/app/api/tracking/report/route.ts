import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { DEFAULT_TZ, isValidTimeZone } from "@/lib/time";
import { campaignReport } from "@/lib/tracking/report";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Relatório de campanhas do período (?from=ISO&to=ISO&tz=...). */
export async function GET(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const q = new URL(req.url).searchParams;
    const from = new Date(q.get("from") ?? "");
    const to = new Date(q.get("to") ?? "");
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new HttpError(422, "Período inválido");
    if (to.getTime() - from.getTime() > 400 * 86_400_000) throw new HttpError(422, "Período máximo: 400 dias");
    const tz = q.get("tz");
    return ok(await campaignReport(ctx.org.id, from.toISOString(), to.toISOString(), isValidTimeZone(tz) ? tz : DEFAULT_TZ));
  } catch (e) {
    return fail(e);
  }
}
