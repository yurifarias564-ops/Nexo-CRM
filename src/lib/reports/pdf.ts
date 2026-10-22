import "server-only";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { ReportData } from "./data";
import type { WrittenReport } from "./writer";

const A4 = { w: 595.28, h: 841.89 };
const M = 48; // margem
const C = {
  navy: rgb(0.043, 0.086, 0.188),
  blue: rgb(0.145, 0.388, 0.922),
  ink: rgb(0.1, 0.12, 0.17),
  muted: rgb(0.42, 0.46, 0.54),
  line: rgb(0.87, 0.89, 0.93),
  soft: rgb(0.95, 0.96, 0.98),
  green: rgb(0.02, 0.55, 0.33),
  red: rgb(0.8, 0.15, 0.15),
  white: rgb(1, 1, 1),
};

// Fontes padrão do PDF usam WinAnsi: troca o que não existe nessa tabela.
const CP1252_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
export function sanitize(s: string): string {
  return s
    .replace(/[→⇒➜➔]/g, "->").replace(/[←]/g, "<-").replace(/[✓✔☑]/g, "OK").replace(/[✗✘❌]/g, "X")
    .replace(/[   ]/g, " ").replace(/[‐‑‒]/g, "-").replace(/−/g, "-")
    .replace(/\r/g, "")
    .split("")
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return ch === "\n" || (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || CP1252_EXTRA.has(ch);
    })
    .join("");
}

const brl = (v: number) => sanitize(v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const num = (v: number) => v.toLocaleString("pt-BR");

class Writer {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont) {}

  newPage() {
    this.page = this.doc.addPage([A4.w, A4.h]);
    this.pages.push(this.page);
    this.y = A4.h - M;
  }
  ensure(h: number) {
    if (this.y - h < M + 20) this.newPage();
  }
  wrap(text: string, size: number, width: number, f = this.font): string[] {
    const out: string[] = [];
    for (const para of sanitize(text).split("\n")) {
      const words = para.split(/\s+/).filter(Boolean);
      let line = "";
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(test, size) <= width) line = test;
        else {
          if (line) out.push(line);
          // palavra maior que a linha: quebra à força
          let rest = w;
          while (f.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
            let i = rest.length;
            while (i > 1 && f.widthOfTextAtSize(rest.slice(0, i), size) > width) i--;
            out.push(rest.slice(0, i));
            rest = rest.slice(i);
          }
          line = rest;
        }
      }
      out.push(line);
    }
    return out;
  }
  text(t: string, o: { size?: number; bold?: boolean; color?: RGB; x?: number; width?: number; gap?: number } = {}) {
    const size = o.size ?? 10.5;
    const f = o.bold ? this.bold : this.font;
    const x = o.x ?? M;
    const width = o.width ?? A4.w - M - x;
    const lh = size * 1.45;
    for (const line of this.wrap(t, size, width, f)) {
      this.ensure(lh);
      this.page.drawText(line, { x, y: this.y - size, size, font: f, color: o.color ?? C.ink });
      this.y -= lh;
    }
    this.y -= o.gap ?? 4;
  }
  heading(t: string) {
    this.ensure(40);
    this.y -= 10;
    this.page.drawRectangle({ x: M, y: this.y - 15, width: 3, height: 15, color: C.blue });
    this.page.drawText(sanitize(t), { x: M + 10, y: this.y - 13, size: 13.5, font: this.bold, color: C.navy });
    this.y -= 26;
  }
  bullet(t: string) {
    const size = 10.5;
    const lines = this.wrap(t, size, A4.w - 2 * M - 14);
    lines.forEach((line, i) => {
      this.ensure(size * 1.45);
      if (i === 0) this.page.drawCircle({ x: M + 4, y: this.y - size + 3.5, size: 1.8, color: C.blue });
      this.page.drawText(line, { x: M + 14, y: this.y - size, size, font: this.font, color: C.ink });
      this.y -= size * 1.45;
    });
    this.y -= 2;
  }
}

export async function renderReportPdf(d: ReportData, r: WrittenReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(sanitize(`${r.title} — ${d.orgName} — ${d.periodLabel}`));
  doc.setAuthor("Nexo CRM");
  doc.setCreator("Nexo CRM");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold);
  w.newPage();

  // Capa / cabeçalho
  const bandH = 128;
  w.page.drawRectangle({ x: 0, y: A4.h - bandH, width: A4.w, height: bandH, color: C.navy });
  w.page.drawRectangle({ x: 0, y: A4.h - bandH, width: A4.w, height: 3, color: C.blue });
  w.page.drawText(sanitize(d.periodLabel.toUpperCase()), { x: M, y: A4.h - 42, size: 9.5, font: bold, color: rgb(0.55, 0.7, 1) });
  const titleLines = w.wrap(r.title, 21, A4.w - 2 * M, bold).slice(0, 2);
  titleLines.forEach((l, i) => w.page.drawText(l, { x: M, y: A4.h - 70 - i * 25, size: 21, font: bold, color: C.white }));
  w.page.drawText(sanitize(d.orgName), { x: M, y: A4.h - bandH + 18, size: 11, font, color: rgb(0.8, 0.85, 0.95) });
  w.y = A4.h - bandH - 26;

  // Resumo executivo
  w.text(r.headline, { size: 12, color: C.ink, gap: 14 });

  // Indicadores
  const c = d.current;
  const kpis: [string, string, string][] = [
    ["Leads recebidos", num(c.new_leads), `mês anterior: ${num(d.previous.new_leads)}`],
    ["Vendas", num(c.won_count), `faturamento ${brl(c.won_value)}`],
    ["Conversão", c.conversion === null ? "-" : `${num(c.conversion)}%`, `${num(c.won_count)} ganhos, ${num(c.lost_count)} perdidos`],
    ["Ligações", num(c.calls), `${num(c.calls_answered)} atendidas`],
    ["Follow-ups", num(c.followups), `${num(c.scheduled_sent)} mensagens automáticas`],
    ["Agendamentos", num(c.appointments), `${num(c.appointments_held)} realizados`],
  ];
  const cols = 3;
  const gap = 10;
  const bw = (A4.w - 2 * M - gap * (cols - 1)) / cols;
  const bh = 62;
  w.ensure(bh * 2 + gap + 10);
  kpis.forEach(([label, value, sub], i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = M + col * (bw + gap);
    const y = w.y - row * (bh + gap) - bh;
    w.page.drawRectangle({ x, y, width: bw, height: bh, color: C.soft, borderColor: C.line, borderWidth: 0.8 });
    w.page.drawText(sanitize(label.toUpperCase()), { x: x + 10, y: y + bh - 16, size: 7.5, font: bold, color: C.muted });
    w.page.drawText(sanitize(value), { x: x + 10, y: y + 20, size: 18, font: bold, color: C.navy });
    const s = w.wrap(sub, 7.5, bw - 20)[0] ?? "";
    w.page.drawText(s, { x: x + 10, y: y + 8, size: 7.5, font, color: C.muted });
  });
  w.y -= bh * 2 + gap + 18;

  // Metas
  if (d.goals.length) {
    w.heading("Metas do mês");
    const colsW = [170, 80, 80, 50, 0];
    colsW[4] = A4.w - 2 * M - colsW.slice(0, 4).reduce((a, b) => a + b, 0);
    const head = ["Meta", "Alvo", "Realizado", "%", "Status"];
    w.ensure(24);
    w.page.drawRectangle({ x: M, y: w.y - 20, width: A4.w - 2 * M, height: 20, color: C.navy });
    let x = M;
    head.forEach((h, i) => { w.page.drawText(h, { x: x + 8, y: w.y - 14, size: 8.5, font: bold, color: C.white }); x += colsW[i]!; });
    w.y -= 20;
    d.goals.forEach((g, idx) => {
      w.ensure(22);
      if (idx % 2 === 0) w.page.drawRectangle({ x: M, y: w.y - 20, width: A4.w - 2 * M, height: 20, color: C.soft });
      const cells = [g.label, g.money ? brl(g.target) : num(g.target), g.money ? brl(g.actual) : num(g.actual), `${num(g.pct)}%`];
      let cx = M;
      cells.forEach((t, i) => { w.page.drawText(sanitize(t), { x: cx + 8, y: w.y - 14, size: 9, font, color: C.ink }); cx += colsW[i]!; });
      w.page.drawText(g.hit ? "Batida" : "Não batida", { x: cx + 8, y: w.y - 14, size: 9, font: bold, color: g.hit ? C.green : C.red });
      w.y -= 20;
    });
    w.y -= 8;
    for (const g of d.goals) {
      const cm = r.goal_comments.find((x) => x.metric === g.metric)?.comment;
      if (cm) w.text(`${g.label}: ${cm}`, { size: 10, color: C.ink, gap: 6 });
    }
  }

  // Seções do modelo
  for (const s of r.sections) {
    w.heading(s.title);
    for (const p of s.paragraphs) w.text(p, { gap: 7 });
    for (const b of s.bullets) w.bullet(b);
    w.y -= 4;
  }

  if (r.next_steps.length) {
    w.heading("Próximos passos");
    r.next_steps.forEach((s) => w.bullet(s));
  }

  // Rodapé com paginação
  const total = w.pages.length;
  w.pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 34 }, end: { x: A4.w - M, y: 34 }, thickness: 0.5, color: C.line });
    p.drawText(sanitize(`${d.orgName} · ${d.periodLabel}`), { x: M, y: 20, size: 8, font, color: C.muted });
    const t = `Página ${i + 1} de ${total}`;
    p.drawText(t, { x: A4.w - M - font.widthOfTextAtSize(t, 8), y: 20, size: 8, font, color: C.muted });
  });

  return doc.save();
}
