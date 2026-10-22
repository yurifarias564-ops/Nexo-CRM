import { requireAppContext } from "@/lib/auth";
import { Inbox } from "@/components/inbox/inbox";

export const metadata = { title: "Conversas" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  await requireAppContext();
  const { c } = await searchParams;
  return <Inbox initialConversationId={c ?? null} />;
}
