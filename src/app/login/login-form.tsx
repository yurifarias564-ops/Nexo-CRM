"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Mic, MessageCircle, KanbanSquare } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/misc";
import { Logo } from "@/components/logo";
import type { Brand } from "@/lib/branding/shared";
import { cn } from "@/lib/utils";

type Mode = "login" | "signup" | "forgot";

const AC_NEW = "new-password";
const AC_CURRENT = "current-password";

function safeNext(n: string | null) {
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

export function LoginForm({ brand }: { brand?: Brand }) {
  const custom = Boolean(brand?.custom);
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const sb = supabaseBrowser();
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) throw new Error(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos" : error.message);
        router.replace(safeNext(params.get("next")));
        router.refresh();
      } else if (mode === "signup") {
        if (pass.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres");
        const { data, error } = await sb.auth.signUp({
          email,
          options: { data: { full_name: name }, emailRedirectTo: `${location.origin}/auth/callback` },
          password: pass,
        });
        if (error) throw error;
        if (data.session) {
          router.replace("/onboarding");
          router.refresh();
        } else {
          toast.success("Conta criada! Confirme seu e-mail para entrar.");
          setMode("login");
        }
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/auth/callback?next=/auth/reset` });
        if (error) throw error;
        toast.success("Enviamos um link de redefinição para o seu e-mail.");
        setMode("login");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Algo deu errado");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-ink-900/60 p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -left-32 top-1/3 h-96 w-96 rounded-full bg-brand-600/20 blur-3xl" />
        <Logo brand={brand} />
        <div className="relative space-y-8">
          {custom ? (
            <div className="space-y-3">
              <h1 className="max-w-md text-4xl font-semibold leading-tight tracking-tight text-white">{brand!.loginTitle || `Bem-vindo ao ${brand!.appName}`}</h1>
              {brand!.loginSubtitle && <p className="max-w-md text-lg text-slate-300">{brand!.loginSubtitle}</p>}
            </div>
          ) : (
          <h1 className="max-w-md text-4xl font-semibold leading-tight tracking-tight text-white">
            Seu comercial inteiro em <span className="text-brand-300">uma tela</span>.
          </h1>
          )}
          <ul className="space-y-4 text-slate-300">
            {[
              { icon: MessageCircle, t: "WhatsApp com histórico completo das conversas" },
              { icon: KanbanSquare, t: "Funil visual com arrastar e soltar em tempo real" },
              { icon: Mic, t: "Mova leads e aplique tags falando com o sistema" },
            ].map(({ icon: I, t }) => (
              <li key={t} className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-ink-800 text-brand-300"><I className="h-4 w-4" /></span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-slate-500">
          Dados protegidos com isolamento por empresa e criptografia em trânsito.{custom && !brand!.hidePoweredBy ? " · Tecnologia Nexo CRM" : ""}
        </p>
      </aside>

      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm animate-fadeIn">
          <div className="mb-8 lg:hidden"><Logo brand={brand} /></div>
          <h2 className="text-2xl font-semibold tracking-tight text-white">
            {mode === "login" ? "Entrar na sua conta" : mode === "signup" ? "Criar conta" : "Recuperar senha"}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {mode === "login" ? "Bem-vindo de volta." : mode === "signup" ? "Comece a organizar suas vendas hoje." : "Enviaremos um link para o seu e-mail."}
          </p>

          {mode !== "forgot" && !custom && (
            <div className="mt-6 grid grid-cols-2 rounded-lg border border-line bg-ink-900 p-1 text-sm">
              {(["login", "signup"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={cn("rounded-md py-1.5 font-medium transition", mode === m ? "bg-ink-700 text-white" : "text-slate-400 hover:text-slate-200")}>
                  {m === "login" ? "Entrar" : "Criar conta"}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <Field label="Seu nome"><input className="field" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
            )}
            <Field label="E-mail"><input className="field" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
            {mode !== "forgot" && (
              <Field label="Senha">
                <input className="field" type="password" required minLength={mode === "signup" ? 8 : 1} value={pass} onChange={(e) => setPass(e.target.value)}
                  autoComplete={mode === "signup" ? AC_NEW : AC_CURRENT} />
              </Field>
            )}
            <Button type="submit" className="w-full" size="lg" loading={loading}>
              {mode === "login" ? "Entrar" : mode === "signup" ? "Criar conta" : "Enviar link"}
            </Button>
          </form>

          <button type="button" onClick={() => setMode(mode === "forgot" ? "login" : "forgot")} className="mt-4 text-sm text-slate-400 hover:text-brand-300">
            {mode === "forgot" ? "← Voltar para o login" : "Esqueci minha senha"}
          </button>
          {custom && brand!.supportWhatsapp && (
            <a href={`https://wa.me/${brand!.supportWhatsapp}`} target="_blank" rel="noopener noreferrer" className="mt-2 block text-sm text-slate-400 hover:text-brand-300">Precisa de ajuda? Fale com o suporte</a>
          )}
        </div>
      </main>
    </div>
  );
}
