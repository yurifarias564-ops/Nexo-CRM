import { requireManagerPage } from "@/lib/auth";
import { Settings } from "@/components/settings/settings";

export const metadata = { title: "Configurações" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; google?: string; msg?: string }> }) {
  const ctx = await requireManagerPage();
  const { tab, google, msg } = await searchParams;
  return <Settings initialTab={tab ?? "whatsapp"} subscription={{ status: ctx.subscription?.status ?? "pending", periodEnd: ctx.subscription?.current_period_end ?? null }} googleStatus={google} googleMsg={msg} />;
}
