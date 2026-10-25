import { requireManagerPage } from "@/lib/auth";
import { AutomationsPage } from "@/components/automations/automations-page";

export const metadata = { title: "Automações" };

export default async function Page() {
  await requireManagerPage();
  return <AutomationsPage />;
}
