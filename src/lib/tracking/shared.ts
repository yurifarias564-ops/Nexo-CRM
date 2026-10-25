// Rastreio de campanhas: regras usadas no navegador e no servidor.

export const CHANNELS = {
  meta_ads: { label: "Anúncios Meta", color: "#1877F2" },
  instagram: { label: "Instagram", color: "#E1306C" },
  facebook: { label: "Facebook", color: "#4267B2" },
  google: { label: "Google", color: "#34A853" },
  tiktok: { label: "TikTok", color: "#25F4EE" },
  youtube: { label: "YouTube", color: "#FF0000" },
  site: { label: "Site", color: "#0EA5E9" },
  bio: { label: "Link da bio", color: "#A855F7" },
  email: { label: "E-mail", color: "#F59E0B" },
  indicacao: { label: "Indicação", color: "#10B981" },
  direto: { label: "Link direto", color: "#64748B" },
  outro: { label: "Outro", color: "#94A3B8" },
} as const;
export type Channel = keyof typeof CHANNELS;
export const NOT_TRACKED = { label: "Não rastreado", color: "#334155" };

export interface Utms { utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null; utm_content?: string | null; utm_term?: string | null }

const has = (v: string | null | undefined, ...words: string[]) => {
  const s = (v ?? "").toLowerCase();
  return words.some((w) => s.includes(w));
};

/** De qual canal veio o clique (pelas UTMs, ids de clique e página de origem). */
export function classify(i: Utms & { fbclid?: string | null; gclid?: string | null; ttclid?: string | null; referrer?: string | null; kind?: "link" | "site" }): Channel {
  const src = i.utm_source, med = i.utm_medium;
  const paid = has(med, "cpc", "paid", "pago", "ads", "anuncio", "trafego", "ppc", "cpm");
  if (has(med, "bio")) return "bio";
  if (i.gclid || has(src, "google", "adwords")) return "google";
  if (i.ttclid || has(src, "tiktok")) return "tiktok";
  if (has(src, "youtube", "yt")) return "youtube";
  if (has(src, "email", "e-mail", "newsletter") || has(med, "email")) return "email";
  if (has(src, "indica")) return "indicacao";
  if (has(src, "facebook", "fb", "instagram", "ig", "meta") || i.fbclid) {
    if (paid || (i.fbclid && !med) || has(src, "meta")) return "meta_ads";
    return has(src, "instagram", "ig") ? "instagram" : "facebook";
  }
  if (has(i.referrer, "instagram")) return "instagram";
  if (has(i.referrer, "facebook", "fb.com")) return "facebook";
  if (has(i.referrer, "google")) return "google";
  if (src) return "outro";
  return i.kind === "site" ? "site" : "direto";
}

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newCode(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return [...b].map((x) => ALPHA[x % ALPHA.length]).join("");
}

/** Texto que vai no WhatsApp com o protocolo no final (é assim que sabemos de onde o cliente veio). */
export function withProtocol(message: string | null | undefined, code: string): string {
  const base = (message ?? "").trim() || "Olá! Gostaria de mais informações.";
  return `${base}\n\nProtocolo: ${code}`;
}

/** Acha o protocolo dentro da mensagem do cliente. */
export function findProtocol(text: string | null | undefined): string | null {
  const m = /protocolo\s*:?\s*#?\s*([A-Z0-9]{6})\b/i.exec(text ?? "");
  return m ? m[1]!.toUpperCase() : null;
}

export const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);

/** Modelos prontos de link (como no Tintim): UTMs certas para cada lugar. */
export const LINK_TEMPLATES: { id: string; label: string; utm: Utms; hint: string }[] = [
  { id: "bio", label: "Link da bio do Instagram", utm: { utm_source: "instagram", utm_medium: "bio", utm_campaign: "bio" }, hint: "Cole na bio do Instagram." },
  { id: "stories", label: "Stories", utm: { utm_source: "instagram", utm_medium: "stories", utm_campaign: "stories" }, hint: "Use no adesivo de link dos stories." },
  { id: "meta", label: "Anúncio Meta (Facebook/Instagram)", utm: { utm_source: "facebook", utm_medium: "paid", utm_campaign: "{{campaign.name}}", utm_content: "{{ad.name}}", utm_term: "{{ad.id}}" }, hint: "Use como URL do site no anúncio. O Meta troca {{campaign.name}}, {{ad.name}} e {{ad.id}} pelos dados reais — assim o CRM liga cada venda ao anúncio exato." },
  { id: "google", label: "Google Ads", utm: { utm_source: "google", utm_medium: "cpc", utm_campaign: "{campaignid}", utm_content: "{creative}" }, hint: "URL final do anúncio no Google." },
  { id: "youtube", label: "YouTube", utm: { utm_source: "youtube", utm_medium: "video", utm_campaign: "youtube" }, hint: "Descrição ou comentário fixado do vídeo." },
  { id: "tiktok", label: "TikTok", utm: { utm_source: "tiktok", utm_medium: "bio", utm_campaign: "tiktok" }, hint: "Bio ou anúncio do TikTok." },
  { id: "livre", label: "Personalizado", utm: {}, hint: "Defina as UTMs como quiser." },
];

/** Monta a URL do link rastreado com as UTMs (sem as vazias). */
export function trackedUrl(base: string, slug: string, utm: Utms): string {
  const qs = Object.entries(utm).filter(([, v]) => v && String(v).trim()).map(([k, v]) => `${k}=${encodeURIComponent(String(v).trim()).replace(/%7B/g, "{").replace(/%7D/g, "}")}`);
  return `${base}/r/${slug}${qs.length ? `?${qs.join("&")}` : ""}`;
}
