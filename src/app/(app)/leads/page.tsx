import { requireManagerPage } from "@/lib/auth";
import { LeadsTable } from "@/components/leads/leads-table";

export const metadata = { title: "Leads" };

export default async function LeadsPage() {
  await requireManagerPage();
  return <LeadsTable />;
}
