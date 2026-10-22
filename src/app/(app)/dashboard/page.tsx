import { requireAppContext } from "@/lib/auth";
import { Dashboard } from "@/components/dashboard/dashboard";

export const metadata = { title: "Painel" };

export default async function DashboardPage() {
  await requireAppContext();
  return <Dashboard />;
}
