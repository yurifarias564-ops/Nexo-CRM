import { randomInt } from "node:crypto";
import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import * as a4 from "@/lib/voip/api4com";
import { loadVoip } from "@/lib/voip";

export const runtime = "nodejs";

const Body = z.object({
  userId: z.string().uuid(),
  // Ramal que já existe na Api4Com (opcional). Sem isso, o sistema cria o próximo livre.
  ramal: z.string().trim().regex(/^[0-9]{2,10}$/, "Ramal inválido").optional(),
  sipPass: z.string().min(4).max(200).optional(),
});

function generateSipPass() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from({ length: 16 }, () => abc[randomInt(abc.length)]).join("");
}

/** Dá um ramal para a pessoa da equipe (cria na central ou vincula um existente). */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`voip-ext:${ctx.org.id}`, 60, 3600);
    const b = Body.parse(await readJson(req, 4_000));
    if (Boolean(b.ramal) !== Boolean(b.sipPass)) throw new HttpError(422, "Informe ramal e senha juntos (ou deixe os dois vazios para criar um novo).");
    const v = await loadVoip(ctx.org.id);
    const db = supabaseAdmin();
    const { data: member } = await db.from("organization_members").select("user_id, profiles(full_name)").eq("organization_id", ctx.org.id).eq("user_id", b.userId).maybeSingle();
    if (!member) throw new HttpError(404, "Pessoa não encontrada na equipe");
    const { data: existing } = await db.from("voip_extensions").select("id").eq("organization_id", ctx.org.id).eq("user_id", b.userId).maybeSingle();
    if (existing) throw new HttpError(409, "Esta pessoa já tem ramal");

    let ramal = b.ramal ?? null;
    let sipPass = b.sipPass ?? null;
    let domain = v.domain;
    let providerId: string | null = null;
    if (!ramal) {
      const { data: u } = await db.auth.admin.getUserById(b.userId);
      const prof = (Array.isArray(member.profiles) ? member.profiles[0] : member.profiles) as { full_name: string | null } | null;
      const [first, ...rest] = (prof?.full_name || u.user?.email?.split("@")[0] || "Vendedor").trim().split(/\s+/);
      sipPass = generateSipPass();
      // E-mail único na central (a pessoa pode já ter um usuário lá com o próprio e-mail):
      // usa a variação "nome+crm…@dominio", que chega na mesma caixa de entrada.
      const mail = u.user?.email ?? "";
      const at = mail.indexOf("@");
      const tag = `crm${b.userId.replace(/-/g, "").slice(0, 6)}`;
      const email = at > 0 ? `${mail.slice(0, at).split("+")[0]}+${tag}${mail.slice(at)}` : `${tag}@nexo.invalid`;
      const ext = await a4.createExtension(v.api_token, { firstName: first!, lastName: rest.join(" "), email, sipPass });
      ramal = String(ext.ramal);
      if (ext.id !== undefined && ext.id !== null) providerId = String(ext.id);
      if (ext.senha) sipPass = String(ext.senha);
      if (ext.domain) domain = String(ext.domain).toLowerCase();
    }
    if (!/^[0-9]{2,10}$/.test(ramal)) throw new HttpError(502, "Ramal devolvido pela central é inválido");
    if (domain && domain !== v.domain) await db.from("voip_settings").update({ domain, updated_at: new Date().toISOString() }).eq("organization_id", ctx.org.id);

    const { data: row, error } = await db.from("voip_extensions").insert({ organization_id: ctx.org.id, user_id: b.userId, ramal, domain, provider_ext_id: providerId }).select("id").single();
    if (error) throw error.code === "23505" ? new HttpError(409, "Este ramal já está com outra pessoa") : error;
    const s = await db.from("voip_extension_secrets").insert({ extension_id: row.id, sip_password: sipPass! });
    if (s.error) { await db.from("voip_extensions").delete().eq("id", row.id); throw s.error; }
    return ok({ id: row.id, ramal }, 201);
  } catch (e) {
    return fail(e);
  }
}

/** Remove o ramal da pessoa no CRM (não apaga na central). */
export async function DELETE(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const userId = new URL(req.url).searchParams.get("userId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new HttpError(422, "Pessoa inválida");
    const { error } = await supabaseAdmin().from("voip_extensions").delete().eq("organization_id", ctx.org.id).eq("user_id", userId);
    if (error) throw error;
    return ok({ removed: true });
  } catch (e) {
    return fail(e);
  }
}

const BinaBody = z.object({
  userId: z.string().uuid(),
  // null = bina dinâmica (número local da central). Senão: DDD + número (com ou sem 55).
  bina: z.string().trim().nullable(),
});

/** Define o número que aparece para o cliente nas ligações do vendedor. Vale já na próxima ligação. */
export async function PATCH(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    await rateLimit(`voip-bina:${ctx.org.id}`, 60, 3600);
    const b = BinaBody.parse(await readJson(req, 2_000));
    let bina: string | null = null;
    if (b.bina) {
      let d = b.bina.replace(/\D/g, "");
      if (d.startsWith("0")) d = d.replace(/^0+/, "");
      if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
      if (!/^\d{10,11}$/.test(d)) throw new HttpError(422, "Número de saída inválido. Use DDD + número, ex.: 85999003908.");
      bina = d;
    }
    const v = await loadVoip(ctx.org.id);
    const db = supabaseAdmin();
    const { data: ext } = await db.from("voip_extensions").select("id, ramal, provider_ext_id").eq("organization_id", ctx.org.id).eq("user_id", b.userId).maybeSingle();
    if (!ext) throw new HttpError(404, "Esta pessoa ainda não tem ramal");
    let pid = ext.provider_ext_id;
    if (!pid) {
      const found = await a4.findExtension(v.api_token, ext.ramal);
      if (!found?.id && found?.id !== 0) throw new HttpError(404, `Não achei o ramal ${ext.ramal} na central`);
      pid = String(found.id);
    }
    try {
      await a4.setExtensionBina(v.api_token, { id: pid, ramal: ext.ramal, bina });
    } catch (e) {
      if (bina && e instanceof HttpError) throw new HttpError(e.status, `A central recusou o número ${bina}. Ela só aceita números liberados na sua conta Api4Com (peça a eles para cadastrar esse número como bina). Detalhe: ${e.message}`);
      throw e;
    }
    const { error } = await db.from("voip_extensions").update({ bina, provider_ext_id: pid }).eq("id", ext.id);
    if (error) throw error;
    return ok({ bina });
  } catch (e) {
    return fail(e);
  }
}
