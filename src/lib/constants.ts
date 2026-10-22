export const KANBAN_PAGE_SIZE = 50;

/** Resultado de uma ligação (relatório conta "atendeu" como atendida). */
export const CALL_OUTCOMES = [
  { value: "atendeu", label: "Atendeu" },
  { value: "nao_atendeu", label: "Não atendeu" },
  { value: "caixa_postal", label: "Caixa postal" },
  { value: "ocupado", label: "Ocupado" },
  { value: "numero_errado", label: "Número errado" },
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number]["value"];
export const callOutcomeLabel = (v: unknown) => CALL_OUTCOMES.find((o) => o.value === v)?.label ?? "Ligação";
