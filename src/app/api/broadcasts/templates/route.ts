import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import * as meta from "@/lib/whatsapp/meta";
import { channelFor, META_APP_ID } from "@/lib/broadcasts-server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Modelos do número oficial (aprovados, em análise e recusados). */
export async function GET(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const channelId = new URL(req.url).searchParams.get("channelId") ?? "";
    if (!z.string().uuid().safeParse(channelId).success) throw new HttpError(422, "Escolha o número");
    const ch = await channelFor(ctx.org.id, channelId);
    if (ch.provider !== "meta") return ok({ templates: [] });
    if (!ch.meta_waba_id || !ch.secrets.meta_access_token) throw new HttpError(409, "Número oficial sem credenciais");
    return ok({ templates: await meta.listAllTemplates(ch.meta_waba_id, ch.secrets.meta_access_token) });
  } catch (e) {
    return fail(e);
  }
}

const NewT = z.object({
  channelId: z.string().uuid(),
  name: z.string().trim().min(1, "Dê um nome ao modelo").max(512),
  category: z.enum(["MARKETING", "UTILITY"]),
  headerType: z.enum(["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"]),
  headerText: z.string().trim().max(60, "Título com no máximo 60 caracteres").default(""),
  body: z.string().trim().min(1, "Escreva a mensagem").max(1024, "Mensagem com no máximo 1024 caracteres"),
  examples: z.array(z.string().trim().min(1, "Preencha o exemplo de cada campo").max(200)).max(20).default([]),
  footer: z.string().trim().max(60, "Rodapé com no máximo 60 caracteres").default(""),
  quickReplies: z.array(z.string().trim().min(1).max(25, "Botão com no máximo 25 caracteres")).max(3).default([]),
});

/** Cria um modelo e manda para a Meta aprovar (multipart: "payload" + arquivo "sample" para cabeçalho com mídia). */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`tpl-new:${ctx.userId}`, 20, 3600, "Muitos modelos criados seguidos. Aguarde um pouco.");
    const form = await req.formData().catch(() => { throw new HttpError(400, "Envio inválido"); });
    const raw = form.get("payload");
    if (typeof raw !== "string") throw new HttpError(400, "Envio inválido");
    const t = NewT.parse(JSON.parse(raw));
    const ch = await channelFor(ctx.org.id, t.channelId);
    if (ch.provider !== "meta" || !ch.meta_waba_id || !ch.secrets.meta_access_token) throw new HttpError(422, "Modelos só existem na API oficial");
    const name = t.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 512);
    if (!name) throw new HttpError(422, "Use letras ou números no nome do modelo");
    const nums = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    const max = nums.length ? Math.max(...nums) : 0;
    if (new Set(nums).size !== max) throw new HttpError(422, "Numere os campos em ordem, sem pular: {{1}}, {{2}}…");
    if (t.examples.length !== max) throw new HttpError(422, `Preencha um exemplo para cada um dos ${max} campos`);
    if (/^\s*\{\{\d+\}\}|\{\{\d+\}\}\s*$/.test(t.body)) throw new HttpError(422, "A Meta recusa mensagem que começa ou termina com um campo {{n}}. Coloque um texto antes/depois.");

    let header: meta.NewTemplate["header"] = null;
    if (t.headerType === "TEXT") {
      if (!t.headerText) throw new HttpError(422, "Escreva o título");
      header = { format: "TEXT", text: t.headerText };
    } else if (t.headerType !== "NONE") {
      const f = form.get("sample");
      if (!(f instanceof File) || f.size === 0) throw new HttpError(422, "Envie um arquivo de exemplo para o cabeçalho");
      if (f.size > 16 * 1024 * 1024) throw new HttpError(413, "Arquivo maior que 16 MB");
      const handle = await meta.uploadTemplateSample(META_APP_ID, ch.secrets.meta_access_token, await f.arrayBuffer(), f.type || "application/octet-stream");
      header = { format: t.headerType, handle };
    }
    const r = await meta.createTemplate(ch.meta_waba_id, ch.secrets.meta_access_token, {
      name, language: "pt_BR", category: t.category, header, body: t.body, examples: t.examples, footer: t.footer || null, quickReplies: t.quickReplies,
    });
    return ok({ ...r, name }, 201);
  } catch (e) {
    return fail(e);
  }
}
