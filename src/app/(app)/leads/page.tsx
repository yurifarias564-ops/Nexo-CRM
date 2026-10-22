import { requireAppContext } from "@/lib/auth";
import { LeadsTable } from "@/components/leads/leads-table";

export const metadata = { title: "Leads" };

export default async function LeadsPage() {
  await requireAppContext();
  return <LeadsTable />;
}
