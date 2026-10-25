import { requireManagerPage } from "@/lib/auth";
import { CampaignsPage } from "@/components/campaigns/campaigns-page";

export const metadata = { title: "Campanhas" };

export default async function Page() {
  await requireManagerPage();
  return <CampaignsPage />;
}
