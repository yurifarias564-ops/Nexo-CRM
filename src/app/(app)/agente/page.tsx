import { requireManagerPage } from "@/lib/auth";
import { AgentPage } from "@/components/agent/agent-page";

export const metadata = { title: "Agente de IA" };

export default async function Page() {
  await requireManagerPage();
  return <AgentPage />;
}
