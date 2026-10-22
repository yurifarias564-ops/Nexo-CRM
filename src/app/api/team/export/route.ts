import ExcelJS from "exceljs";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, HttpError } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { styleHeader } from "@/lib/spreadsheet";
import { DEFAULT_TZ, isValidTimeZone } from "@/lib/time";
import { periodLabel } from "@/lib/reports/period";
import { delta, monthDays, pct, targetFor, totals, type TeamGoal, type TeamMetric, type TeamSeller, type TeamValue } from "@/lib/team";

export const runtime = "nodejs";
export const maxDuration = 60;

const P = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Planilha do time: resumo do mês x meta x mês de comparação + lançamentos dia a dia. */
export async function GET(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`team-export:${ctx.userId}`, 20, 60);
    const q = new URL(req.url).searchParams;
    const period = q.get("period") ?? "";
    const compare = q.get("compare") ?? "";
    const tzQ = q.get("tz") ?? undefined;
    const tz = isValidTimeZone(tzQ) ? tzQ : DEFAULT_TZ;
    if (!P.test(period) || !P.test(compare)) throw new HttpError(422, "Período inválido");

    const sb = await supabaseServer();
    const a = monthDays(period);
    const full = monthDays(compare);
    const upto = Number(q.get("upto") ?? 0);
    const b = upto >= 1 && upto <= 31 ? { ...full, last: `${compare}-${String(Math.min(upto, full.days)).padStart(2, "0")}` } : full;
    const [s, m, g, cur, prev] = await Promise.all([
      sb.from("team_sellers").select("id, name, user_id, active, position").eq("organization_id", ctx.org.id).order("position"),
      sb.from("team_metrics").select("id, name, unit, source, daily_target, monthly_target, active, position").eq("organization_id", ctx.org.id).order("position"),
      sb.from("team_goals").select("seller_id, metric_id, daily_target, monthly_target").eq("organization_id", ctx.org.id).eq("period", a.first),
      sb.rpc("team_values", { org: ctx.org.id, p_from: a.first, p_to: a.last, tz }),
      sb.rpc("team_values", { org: ctx.org.id, p_from: b.first, p_to: b.last, tz }),
    ]);
    if (cur.error) throw cur.error;
    if (prev.error) throw prev.error;
    const sellers = (s.data ?? []) as TeamSeller[];
    const metrics = ((m.data ?? []) as TeamMetric[]).filter((x) => x.active);
    const goals = (g.data ?? []) as TeamGoal[];
    const curV = ((cur.data ?? []) as TeamValue[]).map((v) => ({ ...v, value: Number(v.value) }));
    const prevV = ((prev.data ?? []) as TeamValue[]).map((v) => ({ ...v, value: Number(v.value) }));
    const curT = totals(curV);
    const prevT = totals(prevV);
    const rows = sellers.filter((x) => x.active || metrics.some((mm) => (curT.get(`${x.id}:${mm.id}`) ?? 0) > 0));

    const wb = new ExcelJS.Workbook();
    wb.creator = "Nexo CRM";
    const money = '"R$" #,##0.00';

    // Resumo
    const ws = wb.addWorksheet("Resumo");
    ws.columns = [
      { header: "Vendedora", key: "seller", width: 22 },
      { header: "Indicador", key: "metric", width: 26 },
      { header: `Realizado ${periodLabel(period)}`, key: "cur", width: 20 },
      { header: "Meta do mês", key: "target", width: 14 },
      { header: "% da meta", key: "pct", width: 11 },
      { header: "Bateu?", key: "hit", width: 9 },
      { header: `Realizado ${periodLabel(compare)}${upto >= 1 && upto <= 31 ? ` (dias 1-${upto})` : ""}`, key: "prev", width: 24 },
      { header: "Variação %", key: "delta", width: 12 },
    ];
    for (const sel of [...rows, null]) {
      for (const mm of metrics) {
        const sum = (map: Map<string, number>) => sel ? (map.get(`${sel.id}:${mm.id}`) ?? 0) : rows.reduce((acc, r) => acc + (map.get(`${r.id}:${mm.id}`) ?? 0), 0);
        const target = sel ? targetFor(goals, mm, sel.id).monthly
          : (rows.some((r) => targetFor(goals, mm, r.id).monthly !== null) ? rows.reduce((acc, r) => acc + (targetFor(goals, mm, r.id).monthly ?? 0), 0) : null);
        const c = sum(curT), p = sum(prevT);
        const row = ws.addRow({ seller: sel?.name ?? "TIME (total)", metric: mm.name, cur: c, target, pct: pct(c, target) === null ? null : pct(c, target)! / 100,
          hit: target ? (c >= target ? "Sim" : "Não") : "", prev: p, delta: delta(c, p) === null ? null : delta(c, p)! / 100 });
        if (!sel) row.font = { bold: true };
        if (mm.unit === "money") for (const k of ["cur", "target", "prev"]) row.getCell(k).numFmt = money;
        row.getCell("pct").numFmt = "0.0%";
        row.getCell("delta").numFmt = "+0.0%;-0.0%;0%";
      }
    }
    styleHeader(ws);

    // Diário
    const wd = wb.addWorksheet("Dia a dia");
    wd.columns = [
      { header: "Data", key: "day", width: 12 },
      { header: "Vendedora", key: "seller", width: 22 },
      ...metrics.map((mm) => ({ header: mm.name, key: mm.id, width: Math.max(12, Math.min(28, mm.name.length + 2)) })),
    ];
    const byDay = new Map<string, Map<string, number>>();
    for (const v of curV) {
      const k = `${v.day}|${v.seller_id}`;
      const inner = byDay.get(k) ?? new Map<string, number>();
      inner.set(v.metric_id, (inner.get(v.metric_id) ?? 0) + v.value);
      byDay.set(k, inner);
    }
    const names = new Map(sellers.map((x) => [x.id, x.name]));
    for (const k of [...byDay.keys()].sort()) {
      const [day, sid] = k.split("|") as [string, string];
      const inner = byDay.get(k)!;
      const row = wd.addRow({ day: new Date(`${day}T12:00:00Z`), seller: names.get(sid) ?? "", ...Object.fromEntries(metrics.map((mm) => [mm.id, inner.get(mm.id) ?? 0])) });
      row.getCell("day").numFmt = "dd/mm/yyyy";
      metrics.forEach((mm) => { if (mm.unit === "money") row.getCell(mm.id).numFmt = money; });
    }
    styleHeader(wd);

    // Metas
    const wg = wb.addWorksheet("Metas");
    wg.columns = [
      { header: "Vendedora", key: "seller", width: 22 },
      { header: "Indicador", key: "metric", width: 26 },
      { header: "Meta diária", key: "d", width: 13 },
      { header: "Meta mensal", key: "m", width: 13 },
      { header: "Origem", key: "o", width: 16 },
    ];
    for (const sel of rows) for (const mm of metrics) {
      const t = targetFor(goals, mm, sel.id);
      const own = goals.some((x) => x.seller_id === sel.id && x.metric_id === mm.id);
      wg.addRow({ seller: sel.name, metric: mm.name, d: t.daily, m: t.monthly, o: own ? "Individual" : "Padrão" });
    }
    styleHeader(wg);

    const buf = await wb.xlsx.writeBuffer();
    return new Response(buf as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="time-comercial-${period}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
