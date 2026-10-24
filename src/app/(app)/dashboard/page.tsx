import { requireManagerPage } from "@/lib/auth";
import { Dashboard } from "@/components/dashboard/dashboard";

export const metadata = { title: "Painel" };

export default async function DashboardPage() {
  await requireManagerPage();
  return <Dashboard />;
}
