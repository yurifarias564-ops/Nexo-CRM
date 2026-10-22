import ExcelJS from "exceljs";
import { rateLimit } from "@/lib/rate-limit";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail } from "@/lib/http";
import { styleHeader } from "@/lib/spreadsheet";
import { formatPhone } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`export:${ctx.userId}`, 10, 60);
    const sb = await supabaseServer();
    const stageFilter = new URL(req.url).searchParams.get("stage");

    const [{ data: stages }, { data: tags }, { data: members }] = await Promise.all([
      sb.from("stages").select("id, name, pipelines(name)"),
      sb.from("tags").select("id, name"),
      sb.from("organization_members").select("user_id, profiles(full_name, email)").eq("organization_id", ctx.org.id),
    ]);
    type StageRow = { id: string; name: string; pipelines: { name: string } | { name: string }[] | null };
    const stageMap = new Map(((stages ?? []) as StageRow[]).map((s) => {
      const p = Array.isArray(s.pipelines) ? s.pipelines[0] : s.pipelines;
      return [s.id, { name: s.name, pipeline: p?.name ?? "" }];
    }));
    const tagMap = new Map(((tags ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
    type MemberRow = { user_id: string; profiles: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null };
    const memberMap = new Map(((members ?? []) as MemberRow[]).map((m) => {
      const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      return [m.user_id, p?.full_name || p?.email || ""];
    }));

    const wb = new ExcelJS.Workbook();
    wb.creator = "Nexo CRM";
    const ws = wb.addWorksheet("Leads");
    ws.columns = [
      { header: "Nome", key: "name", width: 28 },
      { header: "Telefone", key: "phone", width: 20 },
      { header: "E-mail", key: "email", width: 28 },
      { header: "Valor", key: "value", width: 14, style: { numFmt: '"R$" #,##0.00' } },
      { header: "Etapa", key: "stage", width: 18 },
      { header: "Funil", key: "pipeline", width: 18 },
      { header: "Tags", key: "tags", width: 26 },
      { header: "Origem", key: "source", width: 16 },
      { header: "Responsável", key: "owner", width: 20 },
      { header: "Observações", key: "notes", width: 36 },
      { header: "Criado em", key: "created", width: 18, style: { numFmt: "dd/mm/yyyy hh:mm" } },
      { header: "Última mensagem", key: "last", width: 18, style: { numFmt: "dd/mm/yyyy hh:mm" } },
    ];
    styleHeader(ws);

    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      let q = sb.from("leads")
        .select("id, name, phone, email, value, stage_id, source, notes, assigned_to, created_at, last_message_at, lead_tags(tag_id)")
        .order("created_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (stageFilter) q = q.eq("stage_id", stageFilter);
      const { data, error } = await q;
      if (error) throw error;
      for (const l of data ?? []) {
        const st = stageMap.get(l.stage_id);
        ws.addRow({
          name: l.name,
          phone: formatPhone(l.phone),
          email: l.email ?? "",
          value: Number(l.value ?? 0),
          stage: st?.name ?? "",
          pipeline: st?.pipeline ?? "",
          tags: ((l.lead_tags ?? []) as { tag_id: string }[]).map((t) => tagMap.get(t.tag_id)).filter(Boolean).join(", "),
          source: l.source ?? "",
          owner: l.assigned_to ? memberMap.get(l.assigned_to) ?? "" : "",
          notes: l.notes ?? "",
          created: new Date(l.created_at),
          last: l.last_message_at ? new Date(l.last_message_at) : null,
        });
      }
      if (!data || data.length < PAGE) break;
    }

    const buf = await wb.xlsx.writeBuffer();
    const date = new Date().toISOString().slice(0, 10);
    return new Response(buf as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="leads-${date}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
