import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { applyChanges, loadChannel, zapiCreds } from "@/lib/whatsapp";
import * as zapi from "@/lib/whatsapp/zapi";
import * as evo from "@/lib/whatsapp/evolution";

export const runtime = "nodejs";

// Limites do próprio WhatsApp
const EDIT_WINDOW_MS = 15 * 60_000;
const DELETE_WINDOW_MS = 48 * 3600_000;

async function load(id: string) {
  const ctx = await requireApiContext();
  await rateLimit(`msg-change:${ctx.userId}`, 30, 60, "Muitas alterações seguidas. Aguarde alguns segundos.");
  const sb = await supabaseServer();
  const { data: m } = await sb.from("messages")
    .select("id, channel_id, conversation_id, external_id, direction, type, body, sent_at, deleted_at, conversations(wa_id, wa_lid)")
    .eq("id", id).maybeSingle();
  if (!m) throw new HttpError(404, "Mensagem não encontrada");
  if (m.direction !== "out") throw new HttpError(422, "Só dá para alterar mensagens enviadas por você");
  if (m.deleted_at) throw new HttpError(409, "Esta mensagem já foi apagada");
  const ch = await loadChannel(m.channel_id);
  if (ch.organization_id !== ctx.org.id) throw new HttpError(404, "Mensagem não encontrada");
  if (ch.provider === "meta") throw new HttpError(422, "A API oficial do WhatsApp não permite apagar nem editar mensagens enviadas. Use o celular.");
  const conv = (Array.isArray(m.conversations) ? m.conversations[0] : m.conversations) as { wa_id: string; wa_lid: string | null } | null;
  if (!conv) throw new HttpError(404, "Conversa não encontrada");
  const to = conv.wa_lid && conv.wa_lid === conv.wa_id && ch.provider === "zapi" ? `${conv.wa_lid}@lid` : conv.wa_id;
  return { m, ch, to };
}

const EditBody = z.object({ text: z.string().trim().min(1, "Digite o texto").max(4096) });

/** Editar mensagem de texto enviada (até 15 min, como no WhatsApp). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { text } = EditBody.parse(await readJson(req, 16_000));
    const { m, ch, to } = await load(id);
    if (m.type !== "text") throw new HttpError(422, "Só mensagens de texto podem ser editadas");
    if (Date.now() - new Date(m.sent_at).getTime() > EDIT_WINDOW_MS) throw new HttpError(422, "O WhatsApp só deixa editar até 15 minutos depois do envio");
    if (ch.provider === "zapi") await zapi.editText(zapiCreds(ch), to, m.external_id, text);
    else await evo.editText(ch.evolution_instance!, to, m.external_id, text);
    await applyChanges(ch.id, [{ external_id: m.external_id, kind: "edit", body: text }]);
    return ok({ edited: true });
  } catch (e) {
    return fail(e);
  }
}

/** Apagar para todos (até 48 h, como no WhatsApp). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { m, ch, to } = await load(id);
    if (Date.now() - new Date(m.sent_at).getTime() > DELETE_WINDOW_MS) throw new HttpError(422, "O WhatsApp só deixa apagar para todos até 2 dias depois do envio");
    if (ch.provider === "zapi") await zapi.deleteForEveryone(zapiCreds(ch), to, m.external_id);
    else await evo.deleteForEveryone(ch.evolution_instance!, to, m.external_id);
    await applyChanges(ch.id, [{ external_id: m.external_id, kind: "delete" }]);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e);
  }
}
