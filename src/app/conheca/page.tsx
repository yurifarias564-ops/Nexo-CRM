import type { Metadata } from "next";
import { companyLine } from "@/lib/company";
import { LeadButton, LeadFormProvider, WhatsAppButton } from "./lead-form";
import { MetaPixel } from "@/components/meta-pixel";

export const metadata: Metadata = {
  title: "Nexo CRM — Pare de perder venda no WhatsApp",
  description: "O CRM que você controla falando. IA que atende 24h, funil em tempo real e um especialista que implementa junto com você. 7 dias grátis.",
};

function Button({ children = "Começar meus 7 dias grátis" }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <WhatsAppButton className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#22c55e] px-6 text-base font-semibold text-white shadow-[0_12px_40px_-10px_rgba(34,197,94,.8)] transition hover:bg-[#16a34a] sm:w-auto">
        <span aria-hidden>💬</span> Falar no WhatsApp agora
      </WhatsAppButton>
      <LeadButton intent="teste" className="inline-flex h-14 w-full items-center justify-center rounded-2xl border border-white/20 px-6 text-base font-semibold text-white transition hover:bg-white/5 sm:w-auto">
        {children} →
      </LeadButton>
    </div>
  );
}

const HERO = ["A IA responde seus clientes em segundos, 24h por dia", "Nenhum lead esquecido: funil organizado sozinho", "Implantação feita por um especialista, junto com você"];

const PAINS = [
  "Cliente pergunta no WhatsApp, ninguém responde e ele compra no concorrente.",
  "Lead esquecido no meio de 300 conversas, sem follow-up.",
  "Você não sabe quanto vendeu hoje, nem qual anúncio trouxe a venda.",
];

const FEATURES = [
  { t: "Você fala, o CRM faz", d: "“Move o João pra negociação”, “manda a cobrança no Pix”, “quanto vendi hoje?”. Tudo por comando de voz, sem clicar em nada.", i: "🎙️" },
  { t: "IA que atende 24h", d: "Responde na hora, qualifica, marca o cliente como quente e passa pro vendedor no momento certo. Até de madrugada.", i: "🤖" },
  { t: "Funil em tempo real", d: "Veja quem está parado, quem está quase fechando e quanto tem em negociação. Nenhum lead some.", i: "📊" },
];

const BEFORE = ["Lead esperando resposta", "Venda perdida pro concorrente", "Planilha e bagunça", "Não sabe qual anúncio vende"];
const AFTER = ["Resposta em segundos", "Follow-up automático", "Funil organizado", "Cada venda ligada ao anúncio"];

const FAQ = [
  ["Funciona com o meu número de WhatsApp?", "Sim. Conectamos o número da sua empresa pela API oficial do WhatsApp, e o especialista faz isso junto com você."],
  ["Preciso entender de tecnologia?", "Não. Um especialista implementa o Nexo com você: conecta o WhatsApp, cadastra a equipe e deixa o primeiro lead no funil."],
  ["Como funciona o teste?", "Você usa tudo por 7 dias, sem compromisso. Se gostar, continua por R$ 299 por mês."],
  ["Tem fidelidade?", "Não. Você cancela quando quiser."],
  ["Funciona no celular?", "Sim. Funciona no navegador do computador e do celular, inclusive os comandos por voz."],
];

export default function Conheca() {
  return (
    <LeadFormProvider>
      <MetaPixel viewContent="Página de vendas Nexo CRM" />
    <main className="min-h-dvh bg-[#060a16] text-slate-200">
      {/* Topo */}
      <section className="relative overflow-hidden px-4 pb-14 pt-10">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[#2563eb]/25 blur-[120px]" />
        <div className="relative mx-auto max-w-3xl">
          <div>
            <div className="mb-6 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#2563eb] text-lg font-bold text-white">N</span>
              <span className="text-lg font-semibold text-white">Nexo CRM</span>
            </div>
            <h1 className="text-[2.1rem] font-bold leading-tight text-white sm:text-5xl">
              Pare de perder venda <span className="text-[#f87171]">no WhatsApp.</span>
            </h1>
            <p className="mt-4 text-lg text-slate-300">O CRM que você controla <b className="text-[#67e8f9]">falando</b>.</p>
            <ul className="mt-5 space-y-2.5">
              {HERO.map((h) => <li key={h} className="flex gap-2.5 text-[15px] text-slate-200"><span className="text-[#22c55e]">✓</span>{h}</li>)}
            </ul>
            <div className="mt-7 space-y-3">
              <Button />
              <p className="text-sm text-slate-400">Fale direto com um especialista · ou teste 7 dias grátis, sem cartão</p>
            </div>
          </div>

        </div>
      </section>

      {/* Dor */}
      <section className="px-4 py-14">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-2xl font-bold text-white sm:text-3xl">Você reconhece isso?</h2>
          <ul className="mt-8 space-y-3">
            {PAINS.map((p) => (
              <li key={p} className="flex gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-4"><span>❌</span><span>{p}</span></li>
            ))}
          </ul>
          <p className="mt-6 text-center text-lg text-slate-300"><b className="text-white">Cliente que espera, compra do concorrente.</b> Cada minuto sem resposta é dinheiro indo embora.</p>
        </div>
      </section>

      {/* Vídeo */}
      <section className="px-4 py-10">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Veja o Nexo funcionando em 1 minuto</h2>
          <div className="mx-auto mt-6 w-full max-w-[300px]">
            <video className="aspect-[9/16] w-full rounded-[28px] border border-white/10 shadow-2xl" src="/videos/nexo-anuncio.mp4" poster="/videos/nexo-anuncio-capa.jpg" controls playsInline preload="none" />
          </div>
        </div>
      </section>

      {/* Recursos */}
      <section className="px-4 py-14">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold text-white sm:text-3xl">Como o Nexo resolve</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.t} className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <div className="text-3xl">{f.i}</div>
                <h3 className="mt-3 text-lg font-semibold text-white">{f.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.d}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-sm text-slate-400">E ainda: automações de follow-up e pós-venda, ligações gravadas, campanhas com ROAS, Pix com confirmação na hora, agenda e muito mais.</p>
        </div>
      </section>

      {/* Antes e depois */}
      <section className="px-4 py-14">
        <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-red-500/30 bg-red-500/5 p-6">
            <p className="text-sm font-semibold tracking-wide text-red-300">SEM O NEXO</p>
            <ul className="mt-4 space-y-3">{BEFORE.map((b) => <li key={b} className="flex gap-2"><span className="text-red-400">✕</span>{b}</li>)}</ul>
          </div>
          <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/5 p-6">
            <p className="text-sm font-semibold tracking-wide text-emerald-300">COM O NEXO</p>
            <ul className="mt-4 space-y-3">{AFTER.map((b) => <li key={b} className="flex gap-2"><span className="text-emerald-400">✓</span>{b}</li>)}</ul>
          </div>
        </div>
      </section>

      {/* Especialista */}
      <section className="px-4 py-14">
        <div className="mx-auto max-w-3xl rounded-3xl border border-[#2563eb]/30 bg-[#2563eb]/[0.07] p-8 text-center">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Você não fica sozinho</h2>
          <p className="mt-3 text-slate-300">Um especialista implementa o Nexo junto com você e dá suporte durante todo o uso.</p>
          <ol className="mx-auto mt-6 grid max-w-xl gap-3 text-left sm:grid-cols-3">
            {["Conectamos seu WhatsApp", "Cadastramos sua equipe", "Primeiro lead no funil"].map((s, i) => (
              <li key={s} className="rounded-2xl bg-black/30 p-4 text-sm"><b className="block text-[#67e8f9]">Passo {i + 1}</b>{s}</li>
            ))}
          </ol>
        </div>
      </section>

      {/* Oferta */}
      <section id="oferta" className="px-4 py-14">
        <div className="mx-auto max-w-md rounded-[32px] border border-white/15 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-8 text-center shadow-2xl">
          <p className="text-sm font-semibold tracking-wide text-[#67e8f9]">PLANO NEXO COMPLETO</p>
          <p className="mt-4 text-slate-400">Teste <b className="text-white">7 dias grátis</b>, depois</p>
          <p className="mt-1 text-5xl font-bold text-white">R$ 299<span className="text-lg font-medium text-slate-400">/mês</span></p>
          <p className="mt-2 text-sm text-slate-400">Menos de R$ 10 por dia. Uma venda salva já paga o mês.</p>
          <ul className="mt-6 space-y-2 text-left text-sm">
            {["WhatsApp oficial + funil de vendas", "Agente de IA 24h", "Comandos por voz", "Automações, ligações e campanhas", "Implantação com especialista", "Suporte durante todo o uso", "Sem fidelidade"].map((x) => <li key={x}>✓ {x}</li>)}
          </ul>
          <div className="mt-7 flex justify-center"><Button /></div>
        </div>
      </section>

      {/* Perguntas */}
      <section className="px-4 py-14">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-2xl font-bold text-white sm:text-3xl">Perguntas frequentes</h2>
          <div className="mt-8 space-y-3">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <summary className="cursor-pointer list-none font-medium text-white">{q}</summary>
                <p className="mt-3 text-sm text-slate-400">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final */}
      <section className="px-4 pb-24 pt-10 text-center">
        <h2 className="text-2xl font-bold text-white sm:text-3xl">Comece hoje e pare de perder cliente.</h2>
        <div className="mt-6 flex justify-center"><Button /></div>
        <p className="mx-auto mt-10 max-w-xl text-[11px] leading-relaxed text-slate-500">{companyLine}</p>
        <p className="mt-2 flex justify-center gap-3 text-[11px] text-slate-500"><a href="/privacidade">Privacidade</a><a href="/termos">Termos</a></p>
      </section>

      {/* Botão fixo no celular */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-white/10 bg-[#060a16]/95 p-3 backdrop-blur md:hidden">
        <WhatsAppButton className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#22c55e] font-semibold text-white">💬 Falar no WhatsApp agora</WhatsAppButton>
      </div>
    </main>
    </LeadFormProvider>
  );
}
