export type Settings = {
  organization_id: string; enabled: boolean; template_id: string | null; template_name: string | null; channel_id: string | null;
  target_type: "group" | "phone" | null; target_id: string | null; target_name: string | null; send_hour: number; time_zone: string; caption: string | null;
};
export type Template = { id: string; name: string; file_name: string; created_at: string; blueprint: { title?: string; tone?: string; sections?: { title: string; purpose: string }[] } };
export type Run = { id: string; period: string; kind: "auto" | "manual" | "preview"; status: "generating" | "generated" | "sent" | "failed"; summary: string | null; error: string | null; target_name: string | null; created_at: string; sent_at: string | null; pdf_path: string | null };

export const GOALS: { metric: string; label: string; money?: boolean; hint: string }[] = [
  { metric: "new_leads", label: "Leads recebidos", hint: "Leads que entraram no mês" },
  { metric: "won_count", label: "Vendas", hint: "Negócios movidos para etapa de ganho" },
  { metric: "won_value", label: "Faturamento", money: true, hint: "Soma do valor das vendas" },
  { metric: "calls", label: "Ligações", hint: "Ligações registradas nos leads" },
  { metric: "followups", label: "Follow-ups", hint: "Ligações + mensagens agendadas enviadas" },
  { metric: "appointments", label: "Agendamentos", hint: "Reuniões marcadas no mês" },
];

export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "Erro inesperado");
  return body as T;
}
