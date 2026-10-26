import { requireManagerPage } from "@/lib/auth";
import { FinancePage } from "@/components/finance/finance-page";

export const metadata = { title: "Finanças" };

export default async function Page() {
  await requireManagerPage();
  return <FinancePage />;
}
