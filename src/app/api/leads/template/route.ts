import ExcelJS from "exceljs";
import { requireApiContext } from "@/lib/auth";
import { fail } from "@/lib/http";
import { COLUMNS, styleHeader } from "@/lib/spreadsheet";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireApiContext();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Leads");
    ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    ws.addRow({ name: "Maria Silva", phone: "85 99999-0000", email: "maria@email.com", value: 1500, stage: "Novo lead", tags: "Anúncio, Indicação", source: "Instagram", notes: "Exemplo — apague esta linha" });
    styleHeader(ws);
    const buf = await wb.xlsx.writeBuffer();
    return new Response(buf as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="modelo-importacao-leads.xlsx"',
      },
    });
  } catch (e) {
    return fail(e);
  }
}
