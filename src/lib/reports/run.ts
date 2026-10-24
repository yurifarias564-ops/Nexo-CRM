import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { HttpError } from "@/lib/http";
import { loadChannel, zapiCreds } from "@/lib/whatsapp";
import * as zapi from "@/lib/whatsapp/zapi";
import * as meta from "@/lib/whatsapp/meta";
import * as evo from "@/lib/whatsapp/evolution";
import { Blueprint } from "./blueprint";
import { buildReportData, type ReportData } from "./data";
import { renderReportPdf } from "./pdf";
import { writeReport, type WrittenReport } from "./writer";

export const BUCKET = "reports";

export interface ReportSettings {
  organization_id: string; enabled: boolean; template_id: string | null; template_name: string | null; channel_id: string | null;
  target_type: "group" | "phone" | null; target_id: string | null; target_name: string | null; send_hour: number; time_zone: string; caption: string | null;
}

async function loadBlueprint(templateId: string | null): Promise<Blueprint> {
  if (!templateId) throw new HttpError(409, "Escolha um modelo de relatório para esta empresa.");
  const { data } = await supabaseAdmin().from("report_templates").select("blueprint").eq("id", templateId).maybeSingle();
  const bp = Blueprint.safeParse(data?.blueprint);
  if (!bp.success) throw new HttpError(409, "O modelo escolhido não está disponível. Envie ou escolha outro modelo.");
  return bp.data;
}

export function reportFileName(d: ReportData) {
  const slug = d.orgName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "cliente";
  return `relatorio-${slug}-${d.period}.pdf`;
}

/** Envia o PDF no grupo (QR Code) ou número (QR ou oficial) configurado. */
export async function deliverReport(s: ReportSettings, pdf: Uint8Array, fileName: string, caption: string) {
  if (!s.channel_id || !s.target_id || !s.target_type) throw new HttpError(409, "Configure o WhatsApp e o grupo/número de destino do relatório.");
  const ch = await loadChannel(s.channel_id);
  if (ch.organization_id !== s.organization_id) throw new HttpError(409, "Canal inválido para esta empresa");
  if (ch.status !== "connected") throw new HttpError(409, `O WhatsApp "${ch.name}" está desconectado. Reconecte para enviar o relatório.`);
  const b64 = Buffer.from(pdf).toString("base64");
  if (ch.provider === "zapi") {
    if (s.target_type === "group") throw new HttpError(409, "Envio para grupos ainda não é suportado no número da Z-API. Escolha um número.");
    return zapi.sendMedia(zapiCreds(ch), s.target_id.replace(/\D/g, ""), "document", "application/pdf", b64, fileName, caption.slice(0, 1000));
  }
  if (ch.provider === "evolution") {
    const to = s.target_type === "group" ? s.target_id : s.target_id.replace(/\D/g, "");
    return evo.sendMedia(ch.evolution_instance!, to, "document", "application/pdf", b64, fileName, caption.slice(0, 1000));
  }
  if (s.target_type === "group") throw new HttpError(409, "Envio para grupos só é possível no número conectado por QR Code.");
  const auth = ch.secrets.meta_access_token;
  if (!auth || !ch.meta_phone_number_id) throw new HttpError(409, "Canal oficial sem credenciais");
  const mediaId = await meta.uploadMedia(ch.meta_phone_number_id, auth, new Blob([Buffer.from(pdf)], { type: "application/pdf" }), "application/pdf", fileName);
  return meta.sendMedia(ch.meta_phone_number_id, auth, s.target_id.replace(/\D/g, ""), "document", mediaId, caption.slice(0, 1000), fileName);
}

/**
 * Gera (e opcionalmente envia) o relatório de uma empresa/mês e registra em
 * report_runs. Usa o cliente admin: quem chama já validou o acesso.
 */
export async function runReport(opts: {
  orgId: string; period: string; kind: "auto" | "manual" | "preview"; send: boolean; requestedBy?: string | null; runId?: string;
}): Promise<{ runId: string; pdfPath: string; status: "generated" | "sent"; written: WrittenReport; data: ReportData; fileName: string }> {
  const db = supabaseAdmin();
  const { data: sRow } = await db.from("report_settings").select("*").eq("organization_id", opts.orgId).maybeSingle();
  const s = (sRow as ReportSettings | null) ?? null;
  const tz = s?.time_zone || "America/Sao_Paulo";

  let runId = opts.runId;
  if (!runId) {
    const { data, error } = await db.from("report_runs").insert({
      organization_id: opts.orgId, period: `${opts.period}-01`, kind: opts.kind, status: "generating", requested_by: opts.requestedBy ?? null,
      target_name: opts.send ? s?.target_name ?? null : null,
    }).select("id").single();
    if (error) throw error;
    runId = data.id as string;
  }

  try {
    const blueprint = await loadBlueprint(s?.template_id ?? null);
    const data = await buildReportData(db, opts.orgId, opts.period, tz);
    const written = await writeReport(blueprint, data);
    const pdf = await renderReportPdf(data, written);
    const fileName = reportFileName(data);
    const pdfPath = `${opts.orgId}/${opts.period}/${runId}.pdf`;
    const up = await db.storage.from(BUCKET).upload(pdfPath, Buffer.from(pdf), { contentType: "application/pdf", upsert: true });
    if (up.error) throw up.error;

    let status: "generated" | "sent" = "generated";
    if (opts.send) {
      if (!s) throw new HttpError(409, "Configure o envio do relatório (WhatsApp e destino).");
      const caption = [s.caption?.trim(), written.whatsapp_caption].filter(Boolean).join("\n\n");
      await deliverReport(s, pdf, fileName, caption);
      status = "sent";
    }
    await db.from("report_runs").update({
      status, pdf_path: pdfPath, summary: written.headline.slice(0, 600), error: null,
      sent_at: status === "sent" ? new Date().toISOString() : null, target_name: status === "sent" ? s?.target_name ?? null : null,
    }).eq("id", runId);
    return { runId, pdfPath, status, written, data, fileName };
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : "Erro inesperado ao gerar o relatório";
    if (!(e instanceof HttpError)) console.error("[report]", opts.orgId, opts.period, e);
    await db.from("report_runs").update({ status: "failed", error: msg }).eq("id", runId);
    throw e instanceof HttpError ? e : new HttpError(500, msg);
  }
}
