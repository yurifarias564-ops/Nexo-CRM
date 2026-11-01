import { z } from "zod";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(160),
  password: z.string().min(8).max(72),
});

/**
 * Cadastro do teste grátis sem esperar e-mail de confirmação: a conta já nasce confirmada
 * e o navegador entra logo em seguida. Limitado por IP para evitar abuso.
 */
export async function POST(req: Request) {
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "anon";
    await rateLimit(`signup:${ip}`, 5, 3600, "Muitas contas criadas daqui. Tente de novo mais tarde.");
    const b = Body.parse(await readJson(req, 2000));
    const { error } = await supabaseAdmin().auth.admin.createUser({
      email: b.email, password: b.password, email_confirm: true, user_metadata: { full_name: b.name },
    });
    if (error) {
      if (/already|registered|exists/i.test(error.message)) throw new HttpError(409, "Este e-mail já tem conta. Entre com sua senha.");
      throw new HttpError(400, error.message);
    }
    return ok({ ok: true }, 201);
  } catch (e) {
    return fail(e);
  }
}
