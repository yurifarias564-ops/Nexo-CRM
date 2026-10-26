import { z } from "zod";
import { requireApiContext } from "@/lib/auth";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { activateStore, deactivateStore, reactivateStore, setPayoutKey } from "@/lib/payments/asaas-store";
import { audit } from "@/lib/platform/partners";

export const runtime = "nodejs";
export const maxDuration = 60;

async function owner() {
  const ctx = await requireApiContext({ manage: true });
  if (ctx.role !== "owner") throw new HttpError(403, "Só o dono da conta pode mexer no dinheiro da empresa");
  return ctx;
}

const Activate = z.object({
  personType: z.enum(["PF", "PJ"]),
  name: z.string().trim().min(3, "Nome completo ou razão social").max(120),
  email: z.string().trim().email("E-mail inválido").max(120),
  doc: z.string().trim().min(11).max(20),
  mobilePhone: z.string().trim().min(10, "Celular com DDD").max(20),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  companyType: z.enum(["MEI", "LIMITED", "INDIVIDUAL", "ASSOCIATION"]).optional(),
  postalCode: z.string().trim().min(8, "CEP").max(10),
  address: z.string().trim().min(3, "Endereço").max(120),
  addressNumber: z.string().trim().min(1, "Número").max(10),
  complement: z.string().trim().max(60).optional(),
  province: z.string().trim().min(2, "Bairro").max(60),
  incomeValue: z.number().positive("Faturamento mensal").max(1_000_000_000),
  accept: z.literal(true, { message: "Confirme o adicional e as tarifas para ativar" }),
}).superRefine((b, c) => {
  if (b.personType === "PF" && !b.birthDate) c.addIssue({ code: "custom", path: ["birthDate"], message: "Data de nascimento" });
  if (b.personType === "PJ" && !b.companyType) c.addIssue({ code: "custom", path: ["companyType"], message: "Tipo da empresa" });
});

/** Ativa o Pix Nexo: abre a conta de recebimento da loja. */
export async function POST(req: Request) {
  try {
    const ctx = await owner();
    await rateLimit(`pix-account:${ctx.org.id}`, 5, 3600, "Muitas tentativas. Aguarde um pouco.");
    const b = Activate.parse(await readJson(req, 4_000));
    await activateStore(ctx.org.id, ctx.userId, b);
    await audit(ctx.userId, ctx.org.id, "Pix Nexo ativado", { personType: b.personType });
    return ok({ ok: true }, 201);
  } catch (e) {
    return fail(e);
  }
}

const Patch = z.union([
  z.object({ payoutKeyType: z.enum(["cpf", "cnpj", "phone", "email", "random"]), payoutKey: z.string().trim().min(3).max(80) }),
  z.object({ autoPayout: z.boolean() }),
  z.object({ enabled: z.boolean() }),
]);

export async function PATCH(req: Request) {
  try {
    const ctx = await owner();
    const b = Patch.parse(await readJson(req, 1_000));
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    if ("payoutKey" in b) {
      await setPayoutKey(ctx.org.id, b.payoutKeyType, b.payoutKey);
      await audit(ctx.userId, ctx.org.id, "chave de saque alterada", { type: b.payoutKeyType });
    } else if ("autoPayout" in b) {
      await supabaseAdmin().from("org_payment_accounts").update({ auto_payout: b.autoPayout, updated_at: new Date().toISOString() }).eq("organization_id", ctx.org.id);
    } else if (b.enabled) {
      await reactivateStore(ctx.org.id);
      await audit(ctx.userId, ctx.org.id, "Pix Nexo reativado");
    } else {
      await deactivateStore(ctx.org.id);
      await audit(ctx.userId, ctx.org.id, "Pix Nexo desligado");
    }
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
