// Pix "Copia e Cola" (BR Code estático, padrão EMV do Banco Central).
// O dinheiro cai direto na conta dona da chave — o CRM não intermedia o pagamento.

export type PixKeyType = "cpf" | "cnpj" | "phone" | "email" | "random";

export const PIX_KEY_LABEL: Record<PixKeyType, string> = {
  cpf: "CPF", cnpj: "CNPJ", phone: "Celular", email: "E-mail", random: "Chave aleatória",
};

function validCpf(d: string) {
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

function validCnpj(d: string) {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => {
    const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = w.reduce((acc, wi, i) => acc + Number(d[i]) * wi, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** Deixa a chave no formato do DICT (como o banco espera). Lança erro em português se for inválida. */
export function normalizePixKey(type: PixKeyType, raw: string): string {
  const v = raw.trim();
  const digits = v.replace(/\D/g, "");
  switch (type) {
    case "cpf":
      if (!validCpf(digits)) throw new Error("CPF inválido");
      return digits;
    case "cnpj":
      if (!validCnpj(digits)) throw new Error("CNPJ inválido");
      return digits;
    case "phone": {
      let d = digits;
      if (d.startsWith("0")) d = d.replace(/^0+/, "");
      if (d.length === 10 || d.length === 11) d = `55${d}`;
      if (!/^55\d{10,11}$/.test(d)) throw new Error("Celular inválido. Use DDD + número, ex.: 85999003908");
      return `+${d}`;
    }
    case "email": {
      const e = v.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 77) throw new Error("E-mail inválido");
      return e;
    }
    case "random": {
      const r = v.toLowerCase();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(r)) throw new Error("Chave aleatória inválida (formato 00000000-0000-0000-0000-000000000000)");
      return r;
    }
  }
}

/** Como mostrar a chave para o cliente (CNPJ com pontuação, celular formatado...). */
export function displayPixKey(type: PixKeyType, key: string): string {
  if (type === "cpf") return key.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  if (type === "cnpj") return key.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (type === "phone") return key.replace(/^\+55(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3");
  return key;
}

// Nome e cidade no BR Code: só letras sem acento, números e espaço.
function plain(s: string, max: number) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 .\-]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function field(id: string, value: string) {
  const len = new TextEncoder().encode(value).length;
  if (len > 99) throw new Error("Campo do Pix muito longo");
  return `${id}${String(len).padStart(2, "0")}${value}`;
}

export function crc16(payload: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(payload)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export interface BrCodeInput {
  key: string;          // já normalizada
  name: string;         // recebedor
  city: string;
  amount?: number | null;
  description?: string | null;
  txid?: string | null; // até 25 letras/números; sem = "***"
}

/** Gera o código "Pix Copia e Cola". */
export function brCode(i: BrCodeInput): string {
  const name = plain(i.name, 25) || "RECEBEDOR";
  const city = plain(i.city, 15) || "BRASIL";
  const desc = i.description ? plain(i.description, 40) : "";
  const gui = field("00", "br.gov.bcb.pix") + field("01", i.key) + (desc ? field("02", desc) : "");
  const txid = (i.txid ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  let p = field("00", "01")
    + field("26", gui)
    + field("52", "0000")
    + field("53", "986")
    + (i.amount && i.amount > 0 ? field("54", i.amount.toFixed(2)) : "")
    + field("58", "BR")
    + field("59", name)
    + field("60", city)
    + field("62", field("05", txid))
    + "6304";
  p += crc16(p);
  return p;
}
