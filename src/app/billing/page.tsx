import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { formatBRL } from "@/lib/utils";
import { BillingPanel } from "./panel";

export const metadata = { title: "Assinatura" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.org) redirect("/onboarding");
  if (ctx.active) redirect("/pipeline");
  const price = Number(process.env.PLAN_PRICE_CENTS ?? 19700) / 100;
  return (
    <BillingPanel
      orgName={ctx.org.name}
      isOwner={ctx.role === "owner"}
      status={ctx.subscription?.status ?? "pending"}
      checkoutUrl={ctx.subscription?.checkout_url ?? null}
      price={formatBRL(price)}
      planName={process.env.PLAN_NAME ?? "Plano Profissional"}
    />
  );
}
