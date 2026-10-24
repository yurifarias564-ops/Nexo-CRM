import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { normalizePixKey } from "@/lib/pix";

export const runtime = "nodejs";

const Body = z.object({
  type: z.enum(["cpf", "cnpj", "phone", "email", "random"]),
  key: z.string().trim().min(3).max(100),
  holderName: z.string().trim().min(2, "Informe o nome do recebedor").max(60),
  city: z.string().trim().min(2, "Informe a cidade").max(40),
  label: z.string().trim().max(40).optional(),
});

/** Cadastra uma chave Pix da empresa (só dono/administrador). */
export async function POST(req: Request) {
  try {
    const ctx = await requireApiContext({ manage: true });
    const b = Body.parse(await readJson(req, 4_000));
    let key: string;
    try { key = normalizePixKey(b.type, b.key); } catch (e) { throw new HttpError(422, (e as Error).message); }
    const { data, error } = await supabaseAdmin().from("pix_keys").insert({
      organization_id: ctx.org.id, key_type: b.type, key, holder_name: b.holderName, city: b.city, label: b.label || null, created_by: ctx.userId,
    }).select("id, key_type, key, holder_name, city, label").single();
    if (error) throw error.code === "23505" ? new HttpError(409, "Essa chave já está cadastrada") : error;
    return ok(data, 201);
  } catch (e) {
    return fail(e);
  }
}
