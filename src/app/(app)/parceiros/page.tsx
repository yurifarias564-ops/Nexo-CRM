import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/auth";
import { PartnersPage } from "@/components/partners/partners-page";

export const metadata = { title: "Parceiros" };

export default async function Page() {
  const ctx = await requireAppContext();
  if (!ctx.isHouse) notFound();
  return <PartnersPage />;
}
