import { requireAppContext } from "@/lib/auth";
import { CallsPage } from "@/components/calls/calls-page";

export const metadata = { title: "Ligações" };

export default async function Page() {
  await requireAppContext();
  return <CallsPage />;
}
