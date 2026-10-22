import { requireAppContext } from "@/lib/auth";
import { ScheduledPage } from "@/components/scheduled/scheduled-page";

export const metadata = { title: "Mensagens agendadas" };

export default async function Page() {
  await requireAppContext();
  return <ScheduledPage />;
}
