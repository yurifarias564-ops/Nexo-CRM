import { requireAppContext } from "@/lib/auth";
import { ReportsPage } from "@/components/reports/reports-page";

export const metadata = { title: "Relatórios" };

export default async function Page() {
  await requireAppContext();
  return <ReportsPage />;
}
