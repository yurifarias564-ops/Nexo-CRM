import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { adsReport } from "@/lib/meta-ads/report";

export const runtime = "nodejs";
export const maxDuration = 60;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Anúncios com investimento, cliques, conversas, leads, vendas e faturamento (?from&to ISO, fromDay&toDay AAAA-MM-DD). */
export async function GET(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const q = new URL(req.url).searchParams;
    const from = new Date(q.get("from") ?? ""), to = new Date(q.get("to") ?? "");
    const fromDay = q.get("fromDay") ?? "", toDay = q.get("toDay") ?? "";
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || !DAY.test(fromDay) || !DAY.test(toDay)) throw new HttpError(422, "Período inválido");
    return ok(await adsReport(ctx.org.id, from.toISOString(), to.toISOString(), fromDay, toDay));
  } catch (e) {
    return fail(e);
  }
}
