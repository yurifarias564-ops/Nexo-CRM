import "server-only";
import ExcelJS from "exceljs";
import { norm } from "@/lib/utils";

export const COLUMNS = [
  { key: "name", header: "Nome", width: 28, aliases: ["nome", "name", "cliente", "contato", "nome completo"] },
  { key: "phone", header: "Telefone", width: 18, aliases: ["telefone", "celular", "whatsapp", "phone", "fone", "numero", "tel"] },
  { key: "email", header: "E-mail", width: 28, aliases: ["email", "e mail", "mail"] },
  { key: "value", header: "Valor", width: 14, aliases: ["valor", "value", "preco", "ticket", "orcamento"] },
  { key: "stage", header: "Etapa", width: 18, aliases: ["etapa", "coluna", "status", "stage", "fase"] },
  { key: "tags", header: "Tags", width: 24, aliases: ["tags", "tag", "etiquetas", "etiqueta"] },
  { key: "source", header: "Origem", width: 16, aliases: ["origem", "fonte", "source", "canal", "midia"] },
  { key: "notes", header: "Observações", width: 36, aliases: ["observacoes", "observacao", "notas", "nota", "obs", "notes"] },
] as const;
export type ColKey = (typeof COLUMNS)[number]["key"];

export function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1630" } };
  row.alignment = { vertical: "middle" };
  row.height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("result" in v) return String(v.result ?? "");
    if (v instanceof Date) return v.toISOString();
    if ("hyperlink" in v) return String((v as { text?: string }).text ?? v.hyperlink);
  }
  return String(v);
}

function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** Lê .xlsx ou .csv e devolve linhas como objetos pelas colunas reconhecidas. */
export async function readRows(file: File): Promise<{ rows: Partial<Record<ColKey, string>>[]; recognized: ColKey[] }> {
  let matrix: string[][] = [];
  const buf = Buffer.from(await file.arrayBuffer());
  if (file.name.toLowerCase().endsWith(".csv")) {
    matrix = parseCsv(buf.toString("utf8").replace(/^﻿/, ""));
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0];
    if (!ws) return { rows: [], recognized: [] };
    ws.eachRow({ includeEmpty: false }, (r) => {
      const vals: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) vals.push(cellText(r.getCell(c).value).trim());
      matrix.push(vals);
    });
  }
  const [header, ...body] = matrix;
  if (!header) return { rows: [], recognized: [] };
  const map = new Map<number, ColKey>();
  header.forEach((h, idx) => {
    const n = norm(h);
    const col = COLUMNS.find((c) => (c.aliases as readonly string[]).includes(n) || c.aliases.some((a) => n.startsWith(a)));
    if (col && ![...map.values()].includes(col.key)) map.set(idx, col.key);
  });
  const rows = body.map((r) => {
    const o: Partial<Record<ColKey, string>> = {};
    map.forEach((key, idx) => { const v = r[idx]?.trim(); if (v) o[key] = v; });
    return o;
  });
  return { rows, recognized: [...map.values()] };
}

/** "R$ 1.234,56" | "1234.56" | 1234 → número */
export function parseMoney(raw: string | undefined): number | null {
  if (!raw) return null;
  let s = raw.replace(/[^\d,.-]/g, "");
  if (s.includes(",") && s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
