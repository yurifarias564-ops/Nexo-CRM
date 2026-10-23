import Link from "next/link";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-ink-950 px-4 py-10 text-slate-300">
      <article className="mx-auto max-w-3xl space-y-4 text-sm leading-relaxed [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-white [&_h2]:pt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-white [&_li]:ml-5 [&_li]:list-disc [&_a]:text-brand-300">
        {children}
        <nav className="flex flex-wrap gap-4 border-t border-line pt-6 text-xs text-slate-500">
          <Link href="/privacidade">Política de privacidade</Link>
          <Link href="/termos">Termos de uso</Link>
          <Link href="/exclusao-de-dados">Exclusão de dados</Link>
          <Link href="/login">Entrar</Link>
        </nav>
      </article>
    </div>
  );
}
