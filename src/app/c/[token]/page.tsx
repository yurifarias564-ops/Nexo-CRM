import type { Metadata } from "next";
import { PublicChecklist } from "@/components/team/public-checklist";
import { orgByToken } from "@/lib/team-server/share";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const name = await orgByToken(token).then((o) => o.orgName, () => "");
  return { title: { absolute: name ? `Checklist do dia · ${name}` : "Checklist do dia" }, robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicChecklist token={token} />;
}
