import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import "./globals.css";
import { brandForHost } from "@/lib/branding/server";
import { brandCss } from "@/lib/branding/shared";

/** Título, ícone e app instalável conforme o domínio acessado (domínio próprio do cliente = marca dele). */
export async function generateMetadata(): Promise<Metadata> {
  const { brand } = await brandForHost();
  return {
    title: { default: brand.appName, template: `%s · ${brand.appName}` },
    description: brand.custom ? `${brand.appName} — atendimento e vendas.` : "CRM com WhatsApp, funil de vendas e comandos por voz.",
    robots: { index: false, follow: false },
    manifest: "/manifest.webmanifest",
    ...(brand.iconUrl ? { icons: { icon: brand.iconUrl, apple: brand.iconUrl } } : {}),
    appleWebApp: { capable: true, title: brand.appName, statusBarStyle: "black-translucent" },
  };
}

export const viewport: Viewport = { themeColor: "#03050a", colorScheme: "dark" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { brand } = await brandForHost();
  const css = brandCss(brand.primaryColor);
  return (
    <html lang="pt-BR" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans">
        {css && <style id="brand-host">{css}</style>}
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{ classNames: { toast: "!bg-ink-850 !border !border-line !text-slate-100", description: "!text-slate-400" } }}
        />
      </body>
    </html>
  );
}
