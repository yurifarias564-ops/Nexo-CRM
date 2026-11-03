"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trackPixel } from "@/components/meta-pixel";

type Intent = "teste" | "especialista";
const Ctx = createContext<(i: Intent) => void>(() => {});

const NICHOS = ["Loja de veículos (carros/motos)", "Clínica / estética / saúde", "Moda e varejo", "Imobiliária", "Serviços (assistência, manutenção…)", "Educação / cursos", "Outro"];
const OBJETIVOS = ["Responder os clientes mais rápido", "Parar de perder lead no WhatsApp", "Organizar o funil de vendas", "IA atendendo 24h", "Controlar a equipe de vendedores", "Saber qual anúncio vende"];

/** Botão que abre o formulário (dentro da página de vendas). */
export function LeadButton({ intent = "teste", className, children }: { intent?: Intent; className?: string; children: React.ReactNode }) {
  const open = useContext(Ctx);
  return <button type="button" onClick={() => open(intent)} className={className}>{children}</button>;
}

/** Formulário rápido: vira lead no CRM e avisa o especialista no WhatsApp. */
export function LeadFormProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [intent, setIntent] = useState<Intent | null>(null);
  const [f, setF] = useState({ nome: "", whatsapp: "", email: "", empresa: "", nicho: "", objetivo: "", outro: "", site: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ especialista: string | null } | null>(null);

  useEffect(() => {
    if (!intent) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setIntent(null); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [intent]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const utm: Record<string, string> = {};
    new URLSearchParams(window.location.search).forEach((v, k) => { if (k.startsWith("utm_") || k === "fbclid") utm[k] = v.slice(0, 120); });
    const objetivo = f.objetivo === "Outro" ? f.outro.trim() || "Outro" : f.objetivo;
    try {
      const r = await fetch("/api/conheca/lead", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ nome: f.nome, whatsapp: f.whatsapp, email: f.email, empresa: f.empresa, nicho: f.nicho, objetivo, intent, utm, site: f.site }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Não foi possível enviar. Tente de novo.");
      trackPixel("Lead", { content_name: intent === "teste" ? "Teste grátis 7 dias" : "Falar com especialista" }, j.eventId ?? undefined);
      if (intent === "teste") {
        const q = new URLSearchParams({ modo: "cadastro", nome: f.nome, ...(f.email ? { email: f.email } : {}) });
        router.push(`/login?${q}`);
        return;
      }
      setDone({ especialista: j.especialista ?? null });
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  const field = "h-12 w-full rounded-xl border border-white/15 bg-black/30 px-4 text-[15px] text-white placeholder:text-slate-500 focus:border-[#3b82f6] focus:outline-none";
  return (
    <Ctx.Provider value={(i) => { setIntent(i); setDone(null); setErr(null); }}>
      {children}
      {intent && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={() => setIntent(null)}>
          <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0b1224] p-6 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            {done ? (
              <div className="space-y-4 py-4 text-center">
                <p className="text-4xl">✅</p>
                <h3 className="text-xl font-bold text-white">Recebemos, {f.nome.split(" ")[0]}!</h3>
                <p className="text-slate-300">Um especialista vai te chamar no WhatsApp em instantes. Se preferir, chame agora:</p>
                {done.especialista && <a href={done.especialista} className="flex h-12 items-center justify-center rounded-xl bg-[#22c55e] font-semibold text-white">Chamar no WhatsApp agora</a>}
                <button type="button" onClick={() => setIntent(null)} className="text-sm text-slate-400">Fechar</button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-bold text-white">{intent === "teste" ? "Comece seus 7 dias grátis" : "Fale com um especialista"}</h3>
                    <p className="mt-1 text-sm text-slate-400">{intent === "teste" ? "Leva 30 segundos. Depois é só criar sua senha." : "A gente te chama no WhatsApp e monta tudo com você."}</p>
                  </div>
                  <button type="button" onClick={() => setIntent(null)} className="text-2xl leading-none text-slate-500" aria-label="Fechar">×</button>
                </div>
                <input className={field} placeholder="Seu nome" required minLength={2} maxLength={80} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoComplete="name" />
                <input className={field} placeholder="WhatsApp com DDD" required inputMode="tel" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} autoComplete="tel" />
                {intent === "teste" && <input className={field} type="email" placeholder="E-mail (para entrar no CRM)" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" />}
                <input className={field} placeholder="Nome da empresa (opcional)" maxLength={80} value={f.empresa} onChange={(e) => setF({ ...f, empresa: e.target.value })} autoComplete="organization" />
                <select className={field} required value={f.nicho} onChange={(e) => setF({ ...f, nicho: e.target.value })}>
                  <option value="" disabled>Qual o seu segmento?</option>
                  {NICHOS.map((n) => <option key={n}>{n}</option>)}
                </select>
                <select className={field} required value={f.objetivo} onChange={(e) => setF({ ...f, objetivo: e.target.value })}>
                  <option value="" disabled>O que você quer resolver com o CRM?</option>
                  {OBJETIVOS.map((n) => <option key={n}>{n}</option>)}
                  <option>Outro</option>
                </select>
                {f.objetivo === "Outro" && <input className={field} placeholder="Conte em poucas palavras" maxLength={200} value={f.outro} onChange={(e) => setF({ ...f, outro: e.target.value })} />}
                <input tabIndex={-1} autoComplete="off" className="hidden" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} aria-hidden />
                {err && <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{err}</p>}
                <button type="submit" disabled={busy} className="flex h-13 w-full items-center justify-center rounded-xl bg-[#2563eb] py-3.5 text-base font-semibold text-white disabled:opacity-60">
                  {busy ? "Enviando…" : intent === "teste" ? "Continuar →" : "Quero falar com um especialista →"}
                </button>
                <p className="text-center text-[11px] text-slate-500">Usamos seus dados só para entrar em contato sobre o Nexo. <a href="/privacidade" className="underline">Privacidade</a></p>
              </form>
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
