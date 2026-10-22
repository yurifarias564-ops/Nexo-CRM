import ExcelJS from "exceljs";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, HttpError } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { styleHeader } from "@/lib/spreadsheet";
import { DEFAULT_TZ, isValidTimeZone } from "@/lib/time";
import {
  conv, delta, goalFor, metricApplies, pct, resultsOf, ROLE_LABEL, totals,
  type TeamMetric, type TeamNote, type TeamSale, type TeamSeller, type TeamSellerGoal, type TeamStore, type TeamValue,
} from "@/lib/team";

export const runtime = "nodejs";
export const maxDuration = 60;

const D = /^\d{4}-\d{2}-\d{2}$/;

/** Planilha do time: resumo x meta x período anterior x marco zero, dia a dia, OS, conversão e observações. */
export async function GET(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`team-export:${ctx.userId}`, 20, 60);
    const q = new URL(req.url).searchParams;
    const from = q.get("from") ?? "", to = q.get("to") ?? "", pfrom = q.get("pfrom") ?? "", pto = q.get("pto") ?? "";
    if (![from, to, pfrom, pto].every((d) => D.test(d)) || from > to || pfrom > pto) throw new HttpError(422, "Período inválido");
    const label = (q.get("label") ?? `${from} a ${to}`).slice(0, 60);
    const tzQ = q.get("tz") ?? undefined;
    const tz = isValidTimeZone(tzQ) ? tzQ : DEFAULT_TZ;

    const sb = await supabaseServer();
    const org = ctx.org.id;
    const [st, s, m, g, cfg, cur, prev, sl, nt] = await Promise.all([
      sb.from("team_stores").select("id, name, revenue_goal, os_daily_goal, position").eq("organization_id", org).order("position"),
      sb.from("team_sellers").select("id, name, user_id, active, position, role, store_id").eq("organization_id", org).order("position"),
      sb.from("team_metrics").select("id, name, unit, source:origin, role, result_of, daily_target, weekly_target, monthly_target, active, position").eq("organization_id", org).eq("active", true).order("position"),
      sb.from("team_seller_goals").select("seller_id, metric_id, daily_target, weekly_target, monthly_target").eq("organization_id", org),
      sb.from("team_settings").select("baseline").eq("organization_id", org).maybeSingle(),
      sb.rpc("team_values", { org, p_from: from, p_to: to, tz }),
      sb.rpc("team_values", { org, p_from: pfrom, p_to: pto, tz }),
      sb.from("team_sales").select("id, seller_id, store_id, sdr_id, day, value, os_number, note, created_at").eq("organization_id", org).gte("day", from).lte("day", to).order("created_at"),
      sb.from("team_notes").select("seller_id, day, body, updated_at").eq("organization_id", org).gte("day", from).lte("day", to).order("day"),
    ]);
    if (cur.error) throw cur.error;
    if (prev.error) throw prev.error;
    const stores = (st.data ?? []) as TeamStore[];
    const sellers = (s.data ?? []) as TeamSeller[];
    const metrics = (m.data ?? []) as TeamMetric[];
    const goals = (g.data ?? []) as TeamSellerGoal[];
    const baseline = (cfg.data?.baseline ?? {}) as Record<string, number>;
    const curV = ((cur.data ?? []) as TeamValue[]).map((v) => ({ ...v, value: Number(v.value) }));
    const prevV = ((prev.data ?? []) as TeamValue[]).map((v) => ({ ...v, value: Number(v.value) }));
    const sales = ((sl.data ?? []) as TeamSale[]).map((x) => ({ ...x, value: Number(x.value) }));
    const notes = (nt.data ?? []) as TeamNote[];
    const curT = totals(curV), prevT = totals(prevV);
    const people = sellers.filter((x) => x.active || metrics.some((mm) => (curT.get(`${x.id}:${mm.id}`) ?? 0) > 0));
    const name = (id: string | null) => sellers.find((x) => x.id === id)?.name ?? "";
    const storeName = (id: string | null) => stores.find((x) => x.id === id)?.name ?? "";

    const wb = new ExcelJS.Workbook();
    wb.creator = "Nexo CRM";
    const money = '"R$" #,##0.00';

    // Resumo
    const ws = wb.addWorksheet("Resumo");
    ws.columns = [
      { header: "Pessoa", key: "p", width: 20 }, { header: "Função", key: "f", width: 9 }, { header: "Loja", key: "l", width: 12 },
      { header: "Indicador", key: "i", width: 26 }, { header: `Realizado (${label})`, key: "c", width: 22 }, { header: "Meta do período", key: "t", width: 15 },
      { header: "% da meta", key: "pc", width: 11 }, { header: "Bateu?", key: "h", width: 8 }, { header: "Período anterior", key: "pv", width: 16 },
      { header: "Variação %", key: "d", width: 11 },
    ];
    for (const p of [...people, null]) {
      for (const mm of metrics) {
        if (p && !metricApplies(mm, p)) continue;
        const list = p ? [p] : people.filter((x) => metricApplies(mm, x));
        const c = list.reduce((a, x) => a + (curT.get(`${x.id}:${mm.id}`) ?? 0), 0);
        const pv = list.reduce((a, x) => a + (prevT.get(`${x.id}:${mm.id}`) ?? 0), 0);
        const goalsList = mm.result_of ? [] : list.map((x) => goalFor(goals, mm, x.id).monthly);
        const t = goalsList.some((x) => x) ? goalsList.reduce<number>((a, x) => a + (x ?? 0), 0) : null;
        const pc = pct(c, t), dl = delta(c, pv);
        const row = ws.addRow({ p: p?.name ?? "TIME (total)", f: p?.role ? ROLE_LABEL[p.role] : "", l: p ? storeName(p.store_id) : "", i: `${mm.result_of ? "↳ " : ""}${mm.name}`,
          c, t, pc: pc === null ? null : pc / 100, h: t ? (c >= t ? "Sim" : "Não") : "", pv, d: dl === null ? null : dl / 100 });
        if (!p) row.font = { bold: true };
        if (mm.unit === "money") for (const k of ["c", "t", "pv"]) row.getCell(k).numFmt = money;
        row.getCell("pc").numFmt = "0.0%";
        row.getCell("d").numFmt = "+0.0%;-0.0%;0%";
      }
    }
    styleHeader(ws);

    // Lojas
    if (stores.length) {
      const wl = wb.addWorksheet("Lojas");
      wl.columns = [{ header: "Loja", key: "l", width: 16 }, { header: "OS fechadas", key: "o", width: 12 }, { header: "Faturamento", key: "f", width: 16 }, { header: "Meta faturamento", key: "m", width: 17 }, { header: "% da meta", key: "p", width: 10 }];
      for (const x of stores) {
        const ss = sales.filter((v) => v.store_id === x.id);
        const fat = ss.reduce((a, v) => a + v.value, 0);
        const r = wl.addRow({ l: x.name, o: ss.length, f: fat, m: x.revenue_goal, p: pct(fat, x.revenue_goal) === null ? null : pct(fat, x.revenue_goal)! / 100 });
        r.getCell("f").numFmt = money; r.getCell("m").numFmt = money; r.getCell("p").numFmt = "0.0%";
      }
      styleHeader(wl);
    }

    // Conversão
    const acts = metrics.filter((mm) => !mm.result_of && resultsOf(metrics, mm.id).length);
    if (acts.length) {
      const wc = wb.addWorksheet("Conversão");
      wc.columns = [{ header: "Pessoa", key: "p", width: 20 }, { header: "Atividade", key: "a", width: 22 }, { header: "Feito", key: "f", width: 9 }, { header: "Resultado", key: "r", width: 22 }, { header: "Qtde", key: "q", width: 8 }, { header: "Conversão", key: "c", width: 11 }];
      for (const p of people) for (const a of acts) {
        if (!metricApplies(a, p)) continue;
        const done = curT.get(`${p.id}:${a.id}`) ?? 0;
        for (const r of resultsOf(metrics, a.id)) {
          const q2 = curT.get(`${p.id}:${r.id}`) ?? 0;
          const c = conv(q2, done);
          wc.addRow({ p: p.name, a: a.name, f: done, r: r.name, q: q2, c: c === null ? null : c / 100 }).getCell("c").numFmt = "0.0%";
        }
      }
      styleHeader(wc);
    }

    // Dia a dia
    const wd = wb.addWorksheet("Dia a dia");
    wd.columns = [{ header: "Data", key: "day", width: 12 }, { header: "Pessoa", key: "p", width: 20 }, ...metrics.map((mm) => ({ header: `${mm.result_of ? "↳ " : ""}${mm.name}`, key: mm.id, width: Math.max(11, Math.min(26, mm.name.length + 3)) }))];
    const byDay = new Map<string, Map<string, number>>();
    for (const v of curV) {
      const k = `${v.day}|${v.seller_id}`;
      const inner = byDay.get(k) ?? new Map<string, number>();
      inner.set(v.metric_id, (inner.get(v.metric_id) ?? 0) + v.value);
      byDay.set(k, inner);
    }
    for (const k of [...byDay.keys()].sort()) {
      const [day, sid] = k.split("|") as [string, string];
      const inner = byDay.get(k)!;
      const row = wd.addRow({ day: new Date(`${day}T12:00:00Z`), p: name(sid), ...Object.fromEntries(metrics.map((mm) => [mm.id, inner.get(mm.id) ?? 0])) });
      row.getCell("day").numFmt = "dd/mm/yyyy";
      metrics.forEach((mm) => { if (mm.unit === "money") row.getCell(mm.id).numFmt = money; });
    }
    styleHeader(wd);

    // OS registradas
    const wo = wb.addWorksheet("OS registradas");
    wo.columns = [{ header: "Data", key: "d", width: 12 }, { header: "Hora", key: "h", width: 8 }, { header: "Closer", key: "c", width: 18 }, { header: "Loja", key: "l", width: 12 }, { header: "Nº OS", key: "n", width: 12 }, { header: "Valor", key: "v", width: 14 }, { header: "Origem (SDR)", key: "s", width: 18 }];
    for (const x of sales) {
      const r = wo.addRow({ d: new Date(`${x.day}T12:00:00Z`), h: new Date(x.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz }), c: name(x.seller_id), l: storeName(x.store_id), n: x.os_number ?? "", v: x.value, s: x.sdr_id ? name(x.sdr_id) : "Direto" });
      r.getCell("d").numFmt = "dd/mm/yyyy"; r.getCell("v").numFmt = money;
    }
    styleHeader(wo);

    // Observações
    const wn = wb.addWorksheet("Observações");
    wn.columns = [{ header: "Data", key: "d", width: 12 }, { header: "Pessoa", key: "p", width: 18 }, { header: "Função", key: "f", width: 9 }, { header: "Notas", key: "n", width: 90 }];
    for (const n of notes.filter((x) => x.body.trim())) {
      const p = sellers.find((x) => x.id === n.seller_id);
      const r = wn.addRow({ d: new Date(`${n.day}T12:00:00Z`), p: p?.name ?? "", f: p?.role ? ROLE_LABEL[p.role] : "", n: n.body });
      r.getCell("d").numFmt = "dd/mm/yyyy"; r.getCell("n").alignment = { wrapText: true, vertical: "top" };
    }
    styleHeader(wn);

    // Marco zero
    if (Object.keys(baseline).length) {
      const wb0 = wb.addWorksheet("Antes x depois");
      wb0.columns = [{ header: "Indicador", key: "i", width: 26 }, { header: "Marco zero", key: "b", width: 13 }, { header: `Realizado (${label})`, key: "c", width: 22 }, { header: "Variação %", key: "d", width: 11 }];
      for (const mm of metrics) {
        const c = people.reduce((a, x) => a + (curT.get(`${x.id}:${mm.id}`) ?? 0), 0);
        const b = baseline[mm.id];
        const dl = b === undefined ? null : delta(c, Number(b));
        const r = wb0.addRow({ i: mm.name, b: b === undefined ? null : Number(b), c, d: dl === null ? null : dl / 100 });
        r.getCell("d").numFmt = "+0.0%;-0.0%;0%";
        if (mm.unit === "money") { r.getCell("b").numFmt = money; r.getCell("c").numFmt = money; }
      }
      styleHeader(wb0);
    }

    const buf = await wb.xlsx.writeBuffer();
    return new Response(buf as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="time-comercial-${from}-a-${to}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
