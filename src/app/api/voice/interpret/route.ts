import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { transcribe } from "@/lib/voice";
import { resolveCommand } from "@/lib/voice-resolve";
import { rateLimit } from "@/lib/rate-limit";
import { DEFAULT_TZ, isValidTimeZone } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_AUDIO = 10 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext();
    await rateLimit(`voice:${ctx.userId}`, 20, 60, "Muitos comandos de voz seguidos. Aguarde um minuto.");
    await rateLimit(`voice-org:${ctx.org.id}`, 600, 3600, "Limite de comandos de voz da empresa por hora atingido.");
    let transcript = "";
    let tz = DEFAULT_TZ;

    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await req.formData();
      const audio = form.get("audio");
      const ftz = form.get("tz");
      if (isValidTimeZone(ftz)) tz = ftz;
      if (!(audio instanceof Blob) || audio.size === 0) throw new HttpError(422, "Áudio não recebido");
      if (audio.size > MAX_AUDIO) throw new HttpError(413, "Áudio muito longo (máx. ~2 minutos)");
      const ext = audio.type.includes("mp4") ? "mp4" : audio.type.includes("ogg") ? "ogg" : "webm";
      // Texto que o próprio navegador entendeu (reserva se a transcrição do servidor falhar)
      const hint = typeof form.get("text") === "string" ? String(form.get("text")).trim().slice(0, 1000) : "";
      try {
        transcript = await transcribe(audio, `comando.${ext}`);
      } catch (e) {
        if (!hint) throw e;
        transcript = hint;
      }
      if (!transcript && hint) transcript = hint;
    } else {
      const body = (await readJson(req, 8_000)) as { text?: unknown; tz?: unknown };
      if (isValidTimeZone(body.tz)) tz = body.tz;
      transcript = typeof body.text === "string" ? body.text.trim().slice(0, 1000) : "";
    }
    if (!transcript) throw new HttpError(422, "Não consegui ouvir nada. Tente falar mais perto do microfone.");

    return ok(await resolveCommand(ctx, transcript, tz));
  } catch (e) {
    return fail(e);
  }
}
