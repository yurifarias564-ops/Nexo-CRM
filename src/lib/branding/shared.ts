// Personalização (white label): tipos e cálculo das cores. Usado no navegador e no servidor.

export interface Brand {
  appName: string;
  logoUrl: string | null;
  iconUrl: string | null;
  primaryColor: string;
  loginTitle: string | null;
  loginSubtitle: string | null;
  supportWhatsapp: string | null;
  hidePoweredBy: boolean;
  custom: boolean;
}

export const DEFAULT_COLOR = "#2563eb";
export const DEFAULT_BRAND: Brand = {
  appName: "Nexo CRM", logoUrl: null, iconUrl: null, primaryColor: DEFAULT_COLOR,
  loginTitle: null, loginSubtitle: null, supportWhatsapp: null, hidePoweredBy: false, custom: false,
};

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const mix = (a: [number, number, number], b: [number, number, number], t: number) => a.map((v, i) => Math.round(v + (b[i]! - v) * t)) as [number, number, number];
const W: [number, number, number] = [255, 255, 255];
const K: [number, number, number] = [0, 0, 0];

/** Tons da cor principal (50 a 700) e o "navy" do fundo, no formato "r g b" das variáveis CSS. */
export function palette(hex: string): Record<string, string> {
  const base = /^#[0-9a-fA-F]{6}$/.test(hex) ? hexToRgb(hex) : hexToRgb(DEFAULT_COLOR);
  const t = (c: [number, number, number]) => c.join(" ");
  return {
    "--brand-50": t(mix(base, W, 0.93)), "--brand-100": t(mix(base, W, 0.85)), "--brand-200": t(mix(base, W, 0.7)),
    "--brand-300": t(mix(base, W, 0.38)), "--brand-400": t(mix(base, W, 0.16)), "--brand-500": t(base),
    "--brand-600": t(mix(base, K, 0.15)), "--brand-700": t(mix(base, K, 0.3)),
    "--navy-500": t(mix(base, K, 0.45)), "--navy-400": t(mix(base, K, 0.33)),
  };
}

/** CSS que aplica a cor da empresa na tela toda. */
export function brandCss(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex) || hex.toLowerCase() === DEFAULT_COLOR) return "";
  return `:root{${Object.entries(palette(hex)).map(([k, v]) => `${k}:${v}`).join(";")}}`;
}

/** Domínio válido digitado pelo usuário (sem http, sem barra). */
export function cleanDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d) && d.length <= 253 ? d : null;
}

/** Subdomínio (crm.empresa.com.br) usa CNAME; domínio raiz (empresa.com.br) usa registro A. */
export function isApex(domain: string): boolean {
  const parts = domain.split(".");
  const twoLevelTld = /\.(com|net|org|gov|edu|art|blog|eco|ind|med|adv|eng|tec)\.br$/.test(domain) || /\.co\.uk$/.test(domain);
  return parts.length === (twoLevelTld ? 3 : 2);
}
