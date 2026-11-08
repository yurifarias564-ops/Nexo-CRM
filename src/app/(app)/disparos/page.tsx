import { requireManagerPage } from "@/lib/auth";
import { BroadcastsPage } from "@/components/broadcasts/broadcasts-page";

export const metadata = { title: "Disparos" };

export default async function Page() {
  await requireManagerPage();
  return <BroadcastsPage />;
}
