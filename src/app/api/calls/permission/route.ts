import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { callTarget, chatNote } from "@/lib/calls";
import * as mc from "@/lib/whatsapp/meta-calls";

export const runtime = "nodejs";

const UUID = z.string().uuid("Conversa inválida");

async function windowOpen(conversationId: string) {
  const { data } = await supabaseAdmin().from("messages").select("sent_at").eq("conversation_id", conversationId).eq("direction", "in")
    .order("sent_at", { ascending: false }).limit(1).maybeSingle();
  return Boolean(data && Date.now() - new Date(data.sent_at).getTime() < 24 * 3600 * 1000);
}

/** O cliente já deixou ligar? (consulta a Meta) */
export async function GET(req: Request) {
  try {
    const ctx = await requireApiContext();
    const conversationId = UUID.parse(new URL(req.url).searchParams.get("conversationId"));
    const t = await callTarget(ctx.org.id, conversationId);
    await rateLimit(`call-perm:${ctx.userId}`, 60, 60);
    const p = await mc.getPermission(t.pnid, t.token, t.conv.wa_id);
    // Mantém a conversa em dia com a Meta
    await supabaseAdmin().from("conversations").update({
      call_permission_until: p.status === "temporary" ? p.expiresAt : null, call_permission_permanent: p.status === "permanent",
    }).eq("id", conversationId);
    return ok({ ...p, windowOpen: await windowOpen(conversationId), recording: t.ch.call_recording === "browser" ? "browser" : "meta" });
  } catch (e) {
    return fail(e);
  }
}

const Body = z.object({ conversationId: z.string().uuid(), text: z.string().trim().max(1000).optional() });

/** Envia ao cliente o pedido nativo do WhatsApp "Permitir ligações". */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    const b = Body.parse(await readJson(req, 8_000));
    await rateLimit(`call-perm-req:${ctx.userId}`, 20, 3600, "Muitos pedidos de permissão nesta hora.");
    const t = await callTarget(ctx.org.id, b.conversationId);
    if (!(await windowOpen(b.conversationId))) {
      throw new HttpError(409, "Pela regra da Meta, o pedido de permissão só pode ser enviado até 24h depois da última mensagem do cliente. Peça para ele responder qualquer coisa e tente de novo.");
    }
    const text = b.text || `Olá! Podemos te ligar aqui pelo WhatsApp para continuar o atendimento?`;
    const id = await mc.requestPermission(t.pnid, t.token, t.conv.wa_id, text);
    await chatNote(t.ch, t.conv.wa_id, id, `📞 Pedido de permissão para ligar enviado: "${text}"`, ctx.userId);
    return ok({ sent: true });
  } catch (e) {
    return fail(e);
  }
}
