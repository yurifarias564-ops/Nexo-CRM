"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/misc";
import { Logo } from "@/components/logo";

export function OnboardingForm({ name }: { name: string }) {
  const router = useRouter();
  const [org, setOrg] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabaseBrowser().rpc("create_organization", { org_name: org });
    setLoading(false);
    if (error) return toast.error(error.message);
    router.replace("/billing");
    router.refresh();
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="card w-full max-w-md animate-fadeIn space-y-6 p-8">
        <Logo />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Olá, {name.split(" ")[0]} 👋</h1>
          <p className="mt-1 text-sm text-slate-400">Vamos criar o espaço da sua empresa. Já deixamos um funil de vendas, tags e mensagens rápidas prontos para você começar.</p>
        </div>
        <Field label="Nome da empresa">
          <div className="relative">
            <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input className="field pl-9" value={org} onChange={(e) => setOrg(e.target.value)} required minLength={2} maxLength={120} placeholder="Ex.: Loja Central" />
          </div>
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={loading}>Criar empresa</Button>
      </form>
    </main>
  );
}
