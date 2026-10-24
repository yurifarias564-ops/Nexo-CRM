import ExcelJS from "exceljs";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { styleHeader } from "@/lib/spreadsheet";
import { appUrl } from "@/lib/env";
import { formatPhone } from "@/lib/utils";
import { ANSWERED, CALL_COLUMNS, CALL_STATUS_LABEL, NOT_ANSWERED, periodStart, type CallPeriod } from "@/lib/calls-shared";

export const runtime = "nodejs";
export const maxDuration = 60;

const PERIODS: CallPeriod[] = ["hoje", "7d", "30d", "mes", "tudo"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Planilha com todas as ligações do filtro (com link para ouvir cada gravação). */
export async function GET(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`calls-export:${ctx.userId}`, 10, 60);
    const p = new URL(req.url).searchParams;
    const period = (PERIODS.includes(p.get("period") as CallPeriod) ? p.get("period") : "30d") as CallPeriod;
    const sb = await supabaseServer();
    let s = sb.from("wa_calls").select(CALL_COLUMNS).eq("organization_id", ctx.org.id);
    const from = periodStart(period);
    if (from) s = s.gte("created_at", from);
    const dir = p.get("dir");
    if (dir === "out" || dir === "in") s = s.eq("direction", dir);
    if (p.get("st") === "answered") s = s.in("status", ANSWERED);
    if (p.get("st") === "not") s = s.in("status", NOT_ANSWERED);
    const who = p.get("who") ?? "";
    if (UUID.test(who)) s = s.or(`started_by.eq.${who},answered_by.eq.${who}`);
    const q = (p.get("q") ?? "").trim();
    if (q) {
      const digits = q.replace(/\D/g, "");
      const safe = q.replace(/[%,()*]/g, " ").trim();
      const ors = [safe && `contact_name.ilike.%${safe}%`, digits.length >= 4 && `wa_id.ilike.%${digits}%`].filter(Boolean).join(",");
      if (ors) s = s.or(ors);
    }
    const [{ data, error }, { data: mem }] = await Promise.all([
      s.order("created_at", { ascending: false }).limit(20000),
      sb.from("organization_members").select("user_id, profiles(full_name, email)").eq("organization_id", ctx.org.id),
    ]);
    if (error) throw error;
    type M = { user_id: string; profiles: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null };
    const names = new Map(((mem ?? []) as M[]).map((m) => { const pr = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return [m.user_id, pr?.full_name || pr?.email || ""]; }));
    type R = { id: string; direction: string; status: string; wa_id: string; contact_name: string | null; started_by: string | null; answered_by: string | null; duration_s: number | null; recording_path: string | null; backup_path: string | null; created_at: string };
    const base = appUrl();

    const wb = new ExcelJS.Workbook();
    wb.creator = "Nexo CRM";
    const ws = wb.addWorksheet("Ligações");
    ws.columns = [
      { header: "Data", key: "d", width: 12 }, { header: "Hora", key: "h", width: 8 }, { header: "Cliente", key: "c", width: 24 }, { header: "Telefone", key: "t", width: 18 },
      { header: "Tipo", key: "k", width: 10 }, { header: "Via", key: "v", width: 11 }, { header: "Atendente", key: "a", width: 20 }, { header: "Situação", key: "s", width: 14 },
      { header: "Duração (min)", key: "m", width: 13 }, { header: "Gravação", key: "g", width: 16 },
    ];
    for (const r of (data ?? []) as unknown as R[]) {
      const dt = new Date(r.created_at);
      const person = r.direction === "out" ? r.started_by : r.answered_by;
      const row = ws.addRow({
        d: dt, h: dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
        c: r.contact_name ?? "", t: formatPhone(r.wa_id), k: r.direction === "out" ? "Feita" : "Recebida", v: (r as { kind?: string }).kind === "voip" ? "Telefone" : "WhatsApp", a: person ? names.get(person) ?? "" : "",
        s: CALL_STATUS_LABEL[r.status] ?? r.status, m: r.duration_s ? Math.round((r.duration_s / 60) * 10) / 10 : 0,
        g: r.recording_path || r.backup_path ? { text: "Ouvir", hyperlink: `${base}/api/calls/${r.id}/recording` } : "",
      });
      row.getCell("d").numFmt = "dd/mm/yyyy";
    }
    styleHeader(ws);
    const buf = await wb.xlsx.writeBuffer();
    return new Response(buf as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="ligacoes-${new Date().toISOString().slice(0, 10)}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
