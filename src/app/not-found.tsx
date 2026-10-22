import Link from "next/link";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
      <Logo />
      <div>
        <p className="text-6xl font-semibold tracking-tight text-white">404</p>
        <p className="mt-2 text-slate-400">Esta página não existe.</p>
      </div>
      <Link href="/" className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-400">Voltar ao início</Link>
    </main>
  );
}
