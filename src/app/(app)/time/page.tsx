import { requireAppContext } from "@/lib/auth";
import { TeamPage } from "@/components/team/team-page";

export const metadata = { title: "Time comercial" };

export default async function Page() {
  await requireAppContext();
  return <TeamPage />;
}
