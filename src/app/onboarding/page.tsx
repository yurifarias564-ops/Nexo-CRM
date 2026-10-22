import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { OnboardingForm } from "./form";

export const metadata = { title: "Criar empresa" };

export default async function OnboardingPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.org) redirect(ctx.active ? "/pipeline" : "/billing");
  return <OnboardingForm name={ctx.fullName} />;
}
