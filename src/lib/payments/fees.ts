// Taxa da plataforma por venda Pix (função pura, testável).

export interface PixFeeSettings { firstCents: number; afterCents: number; firstDays: number }

/** 1º mês de uso da loja: taxa reduzida; depois, a taxa cheia. Nunca passa da metade do valor da venda. */
export function feeFor(s: PixFeeSettings, orgCreatedAt: Date, at: Date, saleCents: number): number {
  const firstPeriodEnds = orgCreatedAt.getTime() + s.firstDays * 86_400_000;
  const fee = at.getTime() < firstPeriodEnds ? s.firstCents : s.afterCents;
  return Math.max(0, Math.min(fee, Math.floor(saleCents / 2)));
}

/** CPF/CNPJ mascarado para exibir (não guardamos o número inteiro). */
export function maskDoc(doc: string): string {
  const d = doc.replace(/\D/g, "");
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-**`;
  return "***";
}
