/** Dados oficiais da empresa dona do Nexo CRM (mostrados no site e nas páginas legais). */
export const COMPANY = {
  legalName: "55.255.981 YURI FARIAS DE ARAUJO",
  cnpj: "55.255.981/0001-00",
  address: "Rua 55, 180 – Jereissati II, Maracanaú – CE, 61901-170",
  email: "yurifarias564@gmail.com",
} as const;
export const companyLine = `Nexo CRM é um produto de ${COMPANY.legalName} · CNPJ ${COMPANY.cnpj} · ${COMPANY.address}`;
