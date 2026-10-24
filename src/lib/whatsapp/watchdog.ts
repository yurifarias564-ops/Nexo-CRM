import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import * as evo from "./evolution";
import * as zapi from "./zapi";
import { loadChannel, zapiCreds } from "./index";

const QR_PROVIDERS = ["evolution", "zapi"];

// Espera entre tentativas automáticas (segundos): rápido no começo, depois espaça para não ser bloqueado.
export const BACKOFF = [5, 10, 20, 30, 60, 120, 300];
export const LOGGED_OUT_CODES = new Set([401, 402, 403, 406]);
export const backoffFor = (attempt: number) => BACKOFF[Math.min(attempt, BACKOFF.length - 1)]!;

type Ch = { id: string; provider: string; evolution_instance: string | null; status: string; retry_count: number; next_retry_at: string | null; needs_qr: boolean };

const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Estado da conexão em qualquer provedor por QR Code. */
async function stateOf(channelId: string): Promise<{ state: "open" | "close" | "error"; phone?: () => Promise<string | null>; restart: () => Promise<void>; qrRequired: () => Promise<boolean> }> {
  const ch = await loadChannel(channelId);
  if (ch.provider === "zapi") {
    const c = zapiCreds(ch);
    const st = await zapi.status(c).catch(() => null);
    return {
      state: st === null ? "error" : st.connected ? "open" : "close",
      phone: () => zapi.phoneNumber(c),
      restart: () => zapi.restart(c),
      // Sem sessão para restaurar, a Z-API passa a entregar um QR Code novo
      qrRequired: async () => Boolean(await zapi.qrImage(c).catch(() => null)),
    };
  }
  const inst = ch.evolution_instance!;
  const s = await evo.connectionState(inst).catch(() => "error" as const);
  return {
    state: s === "open" ? "open" : s === "error" ? "error" : "close",
    phone: () => evo.ownerNumber(inst),
    restart: () => evo.restart(inst).then(() => undefined),
    qrRequired: async () => Boolean((await evo.connect(inst).catch(() => null))?.base64),
  };
}

export async function markUp(channelId: string, phone?: string | null) {
  await supabaseAdmin().from("whatsapp_channels").update({
    status: "connected", disconnected_at: null, next_retry_at: null, retry_count: 0, needs_qr: false, last_error: null,
    last_check_at: nowIso(), ...(phone ? { phone_number: phone } : {}),
  }).eq("id", channelId);
}

/** Registra a queda e agenda a próxima tentativa (contagem regressiva que aparece no CRM). */
export async function markDown(channelId: string, opts: { needsQr?: boolean; error?: string } = {}) {
  const db = supabaseAdmin();
  const { data: ch } = await db.from("whatsapp_channels").select("disconnected_at, retry_count").eq("id", channelId).maybeSingle();
  const attempt = ch?.retry_count ?? 0;
  await db.from("whatsapp_channels").update({
    status: "disconnected",
    disconnected_at: ch?.disconnected_at ?? nowIso(),
    needs_qr: Boolean(opts.needsQr),
    next_retry_at: opts.needsQr ? null : new Date(Date.now() + backoffFor(attempt) * 1000).toISOString(),
    last_error: opts.error ?? (opts.needsQr ? "Sessão encerrada no celular: escaneie o QR Code de novo" : "Conexão caiu — reconectando automaticamente"),
    last_check_at: nowIso(),
  }).eq("id", channelId);
}

/**
 * Tenta reconectar sozinho, reaproveitando a sessão salva. Só uma tentativa por vez por número
 * (trava pela próxima-tentativa no banco), com espera crescente entre tentativas.
 */
export async function tryReconnect(channelId: string, force = false): Promise<"connected" | "retrying" | "needs_qr" | "busy"> {
  const db = supabaseAdmin();
  const lockUntil = new Date(Date.now() + 45_000).toISOString();
  let q = db.from("whatsapp_channels").update({ next_retry_at: lockUntil, status: "connecting", last_check_at: nowIso() })
    .eq("id", channelId).in("provider", QR_PROVIDERS).eq("needs_qr", false);
  if (!force) q = q.or(`next_retry_at.is.null,next_retry_at.lte.${nowIso()}`);
  const { data: claimed } = await q.select("id, retry_count").maybeSingle();
  if (!claimed) return "busy";
  const attempt = (claimed.retry_count ?? 0) + 1;

  try {
    let st = await stateOf(channelId);
    if (st.state !== "open") {
      await st.restart().catch(() => undefined);
      for (let i = 0; i < 4 && st.state !== "open"; i++) { await sleep(2500); st = await stateOf(channelId); }
    }
    if (st.state === "open") {
      await markUp(channelId, await st.phone?.().catch(() => null));
      return "connected";
    }
    // Sem sessão válida, o provedor passa a pedir QR Code: aí não adianta insistir.
    if (st.state === "close" && attempt >= 2 && await st.qrRequired()) {
      await db.from("whatsapp_channels").update({ retry_count: attempt }).eq("id", channelId);
      await markDown(channelId, { needsQr: true });
      return "needs_qr";
    }
  } catch { /* servidor fora do ar: tenta de novo depois */ }

  await db.from("whatsapp_channels").update({ retry_count: attempt }).eq("id", channelId);
  await markDown(channelId, { error: attempt >= 3 ? "Servidor do WhatsApp (QR Code) não respondeu — tentando de novo" : undefined });
  return "retrying";
}

/** Passa por todos os números por QR Code: confere a conexão e reconecta quem caiu. */
export async function watchAll(budgetMs = 50_000) {
  const start = Date.now();
  const db = supabaseAdmin();
  const done: Record<string, string> = {};
  while (Date.now() - start < budgetMs) {
    // Só números que já conectaram alguma vez (no primeiro QR Code não é queda)
    const { data } = await db.from("whatsapp_channels").select("id, provider, evolution_instance, status, retry_count, next_retry_at, needs_qr")
      .in("provider", QR_PROVIDERS).eq("needs_qr", false).not("phone_number", "is", null);
    const chans = (data ?? []) as Ch[];
    if (!chans.length) break;
    let nextDue = Infinity;
    for (const ch of chans) {
      if (ch.status === "connected" && !done[ch.id]) {
        // Confirma que está mesmo de pé (a cada passada do vigia)
        const s = (await stateOf(ch.id).catch(() => ({ state: "error" as const }))).state;
        done[ch.id] = s;
        if (s === "open") { await db.from("whatsapp_channels").update({ last_check_at: nowIso() }).eq("id", ch.id); continue; }
        await markDown(ch.id);
        nextDue = Math.min(nextDue, Date.now() + backoffFor(0) * 1000);
        continue;
      }
      if (ch.status === "connected") continue;
      const due = ch.next_retry_at ? new Date(ch.next_retry_at).getTime() : 0;
      if (due <= Date.now()) {
        const r = await tryReconnect(ch.id);
        done[ch.id] = r;
        if (r === "retrying") nextDue = Math.min(nextDue, Date.now() + backoffFor(ch.retry_count + 1) * 1000);
      } else nextDue = Math.min(nextDue, due);
    }
    const wait = nextDue - Date.now();
    if (!Number.isFinite(nextDue) || Date.now() + wait - start > budgetMs) break;
    await sleep(Math.max(1000, wait));
  }
  return done;
}
