// Rótulos e filtros da aba Ligações (tela e Excel).
export const CALL_STATUS_LABEL: Record<string, string> = {
  completed: "Atendida", missed: "Não atendida", rejected: "Recusada", failed: "Falhou", canceled: "Cancelada",
  starting: "Iniciando", ringing: "Chamando", accepting: "Conectando", connected: "Em andamento",
};
export const ANSWERED = ["completed"];
export const NOT_ANSWERED = ["missed", "rejected", "failed", "canceled"];

export type CallPeriod = "hoje" | "7d" | "30d" | "mes" | "tudo";
export function periodStart(p: CallPeriod, now = new Date()): string | null {
  const d = new Date(now);
  if (p === "tudo") return null;
  if (p === "hoje") d.setHours(0, 0, 0, 0);
  else if (p === "7d") d.setDate(d.getDate() - 7);
  else if (p === "30d") d.setDate(d.getDate() - 30);
  else { d.setDate(1); d.setHours(0, 0, 0, 0); }
  return d.toISOString();
}
export const CALL_COLUMNS = "id, direction, status, wa_id, contact_name, lead_id, conversation_id, started_by, answered_by, duration_s, recording_path, backup_path, recording_mode, created_at, started_at, ended_at, error";
