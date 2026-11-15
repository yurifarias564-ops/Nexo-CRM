/**
 * Automações do Instagram (regras usadas no navegador e no servidor):
 * publicação agendada, gatilho de comentário e fluxo de botões no Direct.
 */

export interface IgStep {
  /** Texto da mensagem (até 640 caracteres, limite do Instagram para mensagem com botão). */
  text: string;
  /** Texto do botão que leva à próxima etapa (até 20 caracteres). */
  button: string;
  /** Só mostra esta etapa para quem já segue a conta. */
  requireFollow: boolean;
}

export interface IgPostMedia { path: string; mime: string; kind: "video" | "image"; name: string; size: number }

export type IgPostMode = "schedule" | "existing" | "any";
export type IgPostStatus = "none" | "scheduled" | "processing" | "published" | "failed" | "canceled";

export interface IgFlowRow {
  id: string;
  channel_id: string;
  name: string;
  enabled: boolean;
  post_mode: IgPostMode;
  post_media: IgPostMedia | null;
  post_caption: string | null;
  post_at: string | null;
  time_zone: string;
  post_status: IgPostStatus;
  post_media_id: string | null;
  post_permalink: string | null;
  post_error: string | null;
  published_at: string | null;
  keywords: string[];
  comment_reply: string | null;
  steps: IgStep[];
  final_text: string | null;
  final_button: string | null;
  final_url: string | null;
  final_require_follow: boolean;
  not_following_text: string | null;
  created_at: string;
  updated_at: string;
}

export const IG_LIMITS = { text: 640, button: 20, steps: 10, caption: 2200, keywords: 20, videoBytes: 100 * 1024 * 1024, imageBytes: 8 * 1024 * 1024 } as const;
export const DEFAULT_NOT_FOLLOWING = "Para continuar, me segue primeiro 🙂 Depois toque no botão abaixo.";
export const RETRY_FOLLOW_BUTTON = "Já estou seguindo";

/** Minúsculas, sem acento e sem pontuação: "Séguir!!" → "seguir". */
export function normalizeText(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** O comentário dispara o fluxo? Sem palavras cadastradas, qualquer comentário dispara. */
export function matchesKeywords(comment: string, keywords: string[]) {
  const ks = keywords.map(normalizeText).filter(Boolean);
  if (!ks.length) return true;
  const padded = ` ${normalizeText(comment)} `;
  return ks.some((k) => padded.includes(` ${k} `));
}

/** Carga do botão: qual execução e de qual etapa o clique veio. */
export const buttonPayload = (runId: string, step: number) => `igf:${runId}:${step}`;
export function parsePayload(p: string | undefined | null): { runId: string; step: number } | null {
  const m = /^igf:([0-9a-f-]{36}):(\d{1,2})$/.exec(p ?? "");
  return m ? { runId: m[1]!, step: Number(m[2]) } : null;
}

/** O que falta para o fluxo poder ser ligado (lista vazia = pronto). */
export function flowProblems(f: Pick<IgFlowRow, "post_mode" | "post_media" | "post_at" | "post_media_id" | "post_status" | "steps" | "final_text" | "final_button" | "final_url">): string[] {
  const out: string[] = [];
  if (f.post_mode === "schedule" && f.post_status !== "published") {
    if (!f.post_media) out.push("Envie o vídeo ou a foto da publicação");
    if (!f.post_at) out.push("Escolha o dia e a hora da publicação");
  }
  if (f.post_mode === "existing" && !f.post_media_id) out.push("Escolha a publicação que dispara o fluxo");
  if (!f.steps.length) out.push("Crie pelo menos uma mensagem no Direct");
  f.steps.forEach((s, i) => {
    if (!s.text.trim()) out.push(`Escreva o texto da mensagem ${i + 1}`);
    if (!s.button.trim()) out.push(`Dê um nome ao botão da mensagem ${i + 1}`);
  });
  if (!f.final_text?.trim()) out.push("Escreva a mensagem final");
  if (!f.final_button?.trim()) out.push("Dê um nome ao botão do link");
  if (!f.final_url || !/^https:\/\/[^\s]+\.[^\s]+$/.test(f.final_url)) out.push("Coloque o link da página final (começando com https://)");
  return out;
}

export const POST_STATUS_LABEL: Record<IgPostStatus, string> = {
  none: "Sem publicação", scheduled: "Agendada", processing: "Publicando…", published: "Publicada", failed: "Falhou", canceled: "Cancelada",
};
