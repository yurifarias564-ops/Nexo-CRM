import { requireApiContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { fail, HttpError } from "@/lib/http";
import { loadChannel } from "@/lib/whatsapp";
import * as meta from "@/lib/whatsapp/meta";
import * as evo from "@/lib/whatsapp/evolution";
import { trustedRecordingUrl } from "@/lib/voip/api4com";

export const runtime = "nodejs";

/** Proxy de mídia: baixa do provedor sob demanda, só para quem tem acesso à mensagem. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireApiContext();
    const sb = await supabaseServer();
    const { data: msg } = await sb.from("messages").select("id, channel_id, media_ref, media_mime").eq("id", id).maybeSingle();
    if (!msg?.media_ref) throw new HttpError(404, "Mídia não encontrada");

    const ch = await loadChannel(msg.channel_id);
    if (ch.organization_id !== ctx.org.id) throw new HttpError(404, "Mídia não encontrada");

    let data: ArrayBuffer;
    let mime = msg.media_mime ?? "application/octet-stream";
    if (ch.provider === "meta") {
      const r = await meta.downloadMedia(msg.media_ref, ch.secrets.meta_access_token!);
      data = r.data;
      mime = r.mime || mime;
    } else if (ch.provider === "zapi") {
      // Z-API guarda a mídia por 30 dias e manda o link no aviso da mensagem
      if (!trustedRecordingUrl(msg.media_ref)) throw new HttpError(404, "Mídia indisponível");
      const u = new URL(msg.media_ref);
      const res = await fetch(u, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new HttpError(404, "Mídia expirada ou indisponível");
      data = await res.arrayBuffer();
      mime = res.headers.get("content-type") || mime;
    } else {
      const r = await evo.getMediaBase64(ch.evolution_instance!, msg.media_ref);
      if (!r.base64) throw new HttpError(404, "Mídia indisponível");
      const buf = Buffer.from(r.base64, "base64");
      data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      mime = r.mimetype || mime;
    }

    const safeMime = /^[\w.+-]+\/[\w.+-]+(;.*)?$/.test(mime) ? mime.split(";")[0]! : "application/octet-stream";
    return new Response(data, {
      headers: {
        "Content-Type": safeMime,
        "Cache-Control": "private, max-age=86400",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
