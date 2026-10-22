"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ExternalLink, Lock, LogOut, RefreshCw } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/misc";
import { Logo } from "@/components/logo";
import type { SubscriptionStatus } from "@/lib/types";

const FEATURES = [
  "WhatsApp oficial e por QR Code com histórico completo",
  "Funil de vendas com arrastar e soltar em tempo real",
  "Comandos por voz para mover leads e aplicar tags",
  "Mensagens rápidas, importação e exportação Excel",
  "Equipe com permissões por função",
];

export function BillingPanel(props: {
  orgName: string; isOwner: boolean; status: SubscriptionStatus; checkoutUrl: string | null; price: string; planName: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: "", cpfCnpj: "", phone: "" });
  const [url, setUrl] = useState(props.checkoutUrl);

  // Enquanto aguarda o pagamento, verifica a liberação a cada 8s
  useEffect(() => {
    if (!url) return;
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [url, router]);

  async function subscribe(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/billing/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setUrl(body.url);
      window.open(body.url, "_blank", "noopener");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao gerar cobrança");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
  }

  const title = props.status === "past_due" ? "Pagamento pendente" : props.status === "canceled" ? "Assinatura cancelada" : "Ative sua conta";
  const subtitle = props.status === "past_due"
    ? "O acesso foi pausado porque a última fatura não foi paga. Seus dados estão seguros e voltam assim que o pagamento for confirmado."
    : "O acesso é liberado automaticamente assim que o pagamento for confirmado.";

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="grid w-full max-w-4xl animate-fadeIn gap-6 md:grid-cols-2">
        <section className="card relative overflow-hidden p-8">
          <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-brand-500/20 blur-3xl" />
          <Logo />
          <p className="mt-8 text-sm font-medium uppercase tracking-wider text-brand-300">{props.planName}</p>
          <p className="mt-2 flex items-baseline gap-1 text-white">
            <span className="text-4xl font-semibold tracking-tight">{props.price}</span>
            <span className="text-slate-400">/mês</span>
          </p>
          <ul className="mt-8 space-y-3">
            {FEATURES.map((f) => (
              <li key={f} className="flex gap-3 text-sm text-slate-300">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" /> {f}
              </li>
            ))}
          </ul>
          <p className="mt-8 text-xs text-slate-500">Pix, boleto ou cartão. Cancele quando quiser.</p>
        </section>

        <section className="card flex flex-col p-8">
          <div className="flex items-center gap-2 text-amber-300">
            <Lock className="h-4 w-4" />
            <span className="text-sm font-medium">{props.orgName}</span>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white">{title}</h1>
          <p className="mt-2 text-sm text-slate-400">{subtitle}</p>

          {!props.isOwner ? (
            <p className="mt-8 rounded-lg border border-line bg-ink-900 p-4 text-sm text-slate-300">
              Peça ao responsável pela conta para regularizar a assinatura.
            </p>
          ) : url ? (
            <div className="mt-8 space-y-3">
              <a href={url} target="_blank" rel="noopener noreferrer" className="flex h-11 items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-glow hover:bg-brand-400">
                Abrir fatura e pagar <ExternalLink className="h-4 w-4" />
              </a>
              <Button variant="outline" className="w-full" onClick={() => router.refresh()}>
                <RefreshCw className="h-4 w-4" /> Já paguei — verificar
              </Button>
              <p className="text-center text-xs text-slate-500">Verificando automaticamente a confirmação…</p>
            </div>
          ) : (
            <form onSubmit={subscribe} className="mt-8 space-y-4">
              <Field label="Nome completo ou razão social">
                <input className="field" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="CPF ou CNPJ" hint="Exigido para emissão da cobrança.">
                <input className="field" required inputMode="numeric" value={form.cpfCnpj} onChange={(e) => setForm({ ...form, cpfCnpj: e.target.value })} />
              </Field>
              <Field label="Celular (opcional)">
                <input className="field" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Button type="submit" size="lg" className="w-full" loading={loading}>Assinar e pagar</Button>
            </form>
          )}

          <button onClick={logout} className="mt-auto flex items-center gap-2 pt-8 text-xs text-slate-500 hover:text-slate-300">
            <LogOut className="h-3.5 w-3.5" /> Sair
          </button>
        </section>
      </div>
    </main>
  );
}
