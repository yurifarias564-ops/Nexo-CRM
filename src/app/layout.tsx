import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Nexo CRM", template: "%s · Nexo CRM" },
  description: "CRM com WhatsApp, funil de vendas e comandos por voz.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#03050a", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans">
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
