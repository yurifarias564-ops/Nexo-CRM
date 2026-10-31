import { PublicChecklist } from "@/components/team/public-checklist";

export const metadata = { title: "Checklist do dia", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicChecklist token={token} />;
}
