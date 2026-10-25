// Texto da cobrança enviada no grupo do cliente (boleto + Pix + link).

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dmy = (d: string) => d.split("-").reverse().join("/");

export function billingMessage(orgName: string, p: { value: number; dueDate: string; invoiceUrl?: string }, kind: "due" | "overdue" | "manual", line: string | null, pix: string | null) {
  const head = kind === "overdue"
    ? `Olá, equipe ${orgName}! A mensalidade do Nexo CRM venceu em ${dmy(p.dueDate)} e ainda está em aberto.`
    : kind === "due"
      ? `Olá, equipe ${orgName}! Hoje (${dmy(p.dueDate)}) vence a mensalidade do Nexo CRM.`
      : `Olá, equipe ${orgName}! Segue a mensalidade do Nexo CRM com vencimento em ${dmy(p.dueDate)}.`;
  return [
    head,
    `Valor: ${brl(p.value)}`,
    p.invoiceUrl ? `\nPagar por aqui (boleto, Pix ou cartão): ${p.invoiceUrl}` : "",
    line ? `\nLinha digitável do boleto:\n${line}` : "",
    pix ? `\nPix copia e cola:\n${pix}` : "",
    kind === "overdue" ? "\nPara não pausar o acesso ao CRM, é só pagar por um dos meios acima. Se já pagou, desconsidere." : "\nQualquer dúvida, é só chamar por aqui.",
  ].filter(Boolean).join("\n");
}

