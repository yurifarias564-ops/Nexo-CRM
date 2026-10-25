"use client";
import { useState } from "react";
import { Ban, CircleHelp, Clock, Gauge, Info, ListChecks, Plus, ShieldAlert, Target, Trash2, UserRoundCog, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { GOALS, HANDOFF_PRESETS, PRICE_POLICY, type Goal, type Rules } from "@/lib/ai/rules";

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function Section({ icon: I, title, hint, children }: { icon: typeof Info; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-line bg-ink-900 p-4">
      <div>
        <h3 className="flex items-center gap-2 font-semibold text-white"><I className="h-4 w-4 text-brand-300" /> {title}</h3>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Lista editável (chips): adiciona com Enter, remove no X. */
function ChipList({ items, onChange, placeholder, max, maxLen, tone = "default" }: {
  items: string[]; onChange: (v: string[]) => void; placeholder: string; max: number; maxLen: number; tone?: "default" | "danger";
}) {
  const [v, setV] = useState("");
  const add = () => {
    const t = v.trim().slice(0, maxLen);
    if (!t || items.some((x) => x.toLowerCase() === t.toLowerCase()) || items.length >= max) return;
    onChange([...items, t]); setV("");
  };
  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((x) => (
            <span key={x} className={cn("inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-xs", tone === "danger" ? "bg-red-500/10 text-red-200" : "bg-ink-700 text-slate-200")}>
              <span className="truncate">{x}</span>
              <button onClick={() => onChange(items.filter((y) => y !== x))} className="text-slate-400 hover:text-white" aria-label={`Remover ${x}`}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input className="field flex-1" value={v} maxLength={maxLen} placeholder={placeholder} onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <Button variant="secondary" onClick={add} disabled={!v.trim() || items.length >= max}><Plus className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

export function RulesTab({ rules: r, set }: { rules: Rules; set: (p: Partial<Rules>) => void }) {
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const customTriggers = r.handoff_triggers.filter((t) => !(HANDOFF_PRESETS as readonly string[]).includes(t));

  return (
    <div className="space-y-5">
      <p className="rounded-xl border border-brand-400/20 bg-brand-500/5 p-3 text-sm text-slate-300">
        Estas regras valem acima de qualquer pedido do cliente. Além de irem para a IA, o CRM <b className="text-white">confere cada resposta antes de enviar</b>:
        palavra proibida, preço quando é proibido, valor que não está nas informações, desconto acima do limite ou emoji desligado → a IA reescreve; se insistir, a resposta é
        <b className="text-white"> bloqueada</b>, vai uma mensagem segura e o atendimento passa para a equipe.
      </p>

      <Section icon={Target} title="Objetivo do agente" hint="Define a postura da IA em toda conversa.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(GOALS) as Goal[]).map((g) => (
            <button key={g} type="button" onClick={() => set({ goal: g })}
              className={cn("rounded-xl border p-3 text-left transition", r.goal === g ? "border-brand-400/60 bg-brand-500/10" : "border-line hover:border-slate-500")}>
              <span className="block font-medium text-white">{GOALS[g].label}</span>
              <span className="mt-1 block text-xs text-slate-400">{GOALS[g].note}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section icon={Info} title="Informações que a IA pode usar" hint="Produtos, serviços, modelos, preços (se liberados), endereço, horários, diferenciais, garantia, entrega.">
        <textarea className="field min-h-[180px] text-sm" maxLength={30000} value={r.knowledge} onChange={(e) => set({ knowledge: e.target.value })}
          placeholder={"Ex.:\nMT-03 2026 — a partir de R$ 33.990 — cores: azul, preta, cinza\nFazer 250 2026 — a partir de R$ 22.490\nEndereço: Av. Central, 100 — Maracanaú\nRevisão gratuita até 1.000 km"} />
        <label className="flex items-start gap-2 text-sm text-slate-200">
          <input type="checkbox" className="mt-1" checked={r.strict} onChange={(e) => set({ strict: e.target.checked })} />
          <span>Responder <b>somente</b> com o que está escrito aqui <span className="block text-xs text-slate-500">O que não estiver nas informações, a IA diz que vai confirmar e transfere. Recomendado.</span></span>
        </label>
      </Section>

      <Section icon={Wallet} title="Condições, preço e desconto">
        <Field label="Condições comerciais" hint="Formas de pagamento, entrada, parcelamento, troca, prazo de entrega, garantia, política de reserva.">
          <textarea className="field min-h-[110px] text-sm" maxLength={10000} value={r.conditions} onChange={(e) => set({ conditions: e.target.value })}
            placeholder={"Ex.:\nÀ vista no Pix, cartão em até 12x, financiamento e consórcio\nAceitamos moto usada na troca (avaliação presencial)\nReserva com sinal de R$ 500"} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Preços">
            <select className="field" value={r.price_policy} onChange={(e) => set({ price_policy: e.target.value as Rules["price_policy"] })}>
              {Object.entries(PRICE_POLICY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Desconto máximo que a IA pode dar" hint="0 = nunca oferece desconto (pedido de desconto vai para o vendedor).">
            <div className="flex items-center gap-2">
              <input className="field w-24" type="number" min={0} max={100} value={r.max_discount_pct} onChange={(e) => set({ max_discount_pct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} />
              <span className="text-sm text-slate-400">%</span>
            </div>
          </Field>
        </div>
      </Section>

      <Section icon={Ban} title="O que a IA NÃO pode falar" hint="Assuntos proibidos. Se o cliente perguntar, a IA recusa com educação e, se fizer sentido, transfere.">
        <ChipList items={r.forbidden_topics} onChange={(v) => set({ forbidden_topics: v })} max={40} maxLen={300} tone="danger"
          placeholder="Ex.: taxa de juros do financiamento · prazo de entrega · concorrentes · política" />
      </Section>

      <Section icon={ShieldAlert} title="Palavras proibidas (bloqueio automático)" hint="Se a resposta tiver uma destas palavras, o CRM barra antes de enviar.">
        <ChipList items={r.forbidden_words} onChange={(v) => set({ forbidden_words: v })} max={80} maxLen={60} tone="danger"
          placeholder="Ex.: garantido · aprovado · grátis · promoção · barato" />
      </Section>

      <Section icon={ListChecks} title="Perguntas obrigatórias (qualificação)" hint="A IA faz todas ao longo da conversa, uma por vez, e guarda as respostas na memória do lead.">
        <ChipList items={r.required_questions} onChange={(v) => set({ required_questions: v })} max={15} maxLen={200}
          placeholder="Ex.: Qual modelo você procura? · Vai usar para cidade ou estrada? · Tem moto para dar na troca?" />
      </Section>

      <Section icon={UserRoundCog} title="Quando passar para o vendedor">
        <div className="grid gap-1.5 sm:grid-cols-2">
          {HANDOFF_PRESETS.map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" checked={r.handoff_triggers.includes(t)}
                onChange={(e) => set({ handoff_triggers: e.target.checked ? [...r.handoff_triggers, t] : r.handoff_triggers.filter((x) => x !== t) })} />
              {t}
            </label>
          ))}
        </div>
        <ChipList items={customTriggers} onChange={(v) => set({ handoff_triggers: [...r.handoff_triggers.filter((t) => (HANDOFF_PRESETS as readonly string[]).includes(t)), ...v] })}
          max={24} maxLen={200} placeholder="Outro motivo. Ex.: cliente perguntar por moto de leilão" />
        <Field label="Limite de respostas da IA por conversa" hint="Depois de X respostas, a IA para e a equipe assume. 0 = sem limite.">
          <input className="field w-28" type="number" min={0} max={200} value={r.max_ai_replies} onChange={(e) => set({ max_ai_replies: Math.min(200, Math.max(0, Math.round(Number(e.target.value) || 0))) })} />
        </Field>
      </Section>

      <Section icon={CircleHelp} title="Perguntas frequentes" hint="Respostas oficiais. A IA usa como base, no tom escolhido.">
        {r.faq.length > 0 && (
          <ul className="space-y-2">
            {r.faq.map((f, i) => (
              <li key={i} className="group rounded-lg border border-line bg-ink-850 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-100">{f.q}</p>
                    <p className="mt-1 whitespace-pre-wrap text-slate-400">{f.a}</p>
                  </div>
                  <button onClick={() => set({ faq: r.faq.filter((_, k) => k !== i) })} className="text-slate-500 hover:text-red-300" aria-label="Remover pergunta"><Trash2 className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-2">
          <input className="field" maxLength={300} placeholder="Pergunta. Ex.: Vocês fazem entrega?" value={q} onChange={(e) => setQ(e.target.value)} />
          <textarea className="field min-h-[70px] text-sm" maxLength={1500} placeholder="Resposta oficial" value={a} onChange={(e) => setA(e.target.value)} />
          <Button variant="secondary" className="justify-self-start" disabled={!q.trim() || !a.trim() || r.faq.length >= 60}
            onClick={() => { set({ faq: [...r.faq, { q: q.trim(), a: a.trim() }] }); setQ(""); setA(""); }}><Plus className="h-4 w-4" /> Adicionar pergunta</Button>
        </div>
      </Section>

      <Section icon={Clock} title="Horário de atendimento">
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={r.hours.enabled} onChange={(e) => set({ hours: { ...r.hours, enabled: e.target.checked } })} />
          Usar horário de atendimento (sem isso a IA atende 24h)
        </label>
        {r.hours.enabled && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d, i) => (
                <button key={d} type="button" onClick={() => set({ hours: { ...r.hours, days: r.hours.days.includes(i) ? r.hours.days.filter((x) => x !== i) : [...r.hours.days, i].sort() } })}
                  className={cn("rounded-full border px-3 py-1 text-xs", r.hours.days.includes(i) ? "border-brand-400/50 bg-brand-500/15 text-brand-100" : "border-line text-slate-400")}>{d}</button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
              das <input type="time" className="field w-32" value={r.hours.start} onChange={(e) => set({ hours: { ...r.hours, start: e.target.value } })} />
              às <input type="time" className="field w-32" value={r.hours.end} onChange={(e) => set({ hours: { ...r.hours, end: e.target.value } })} />
            </div>
            <Field label="Fora do horário, a IA…">
              <select className="field" value={r.hours.mode} onChange={(e) => set({ hours: { ...r.hours, mode: e.target.value as Rules["hours"]["mode"] } })}>
                <option value="responder_avisando">Atende normalmente e avisa que a equipe retorna no horário</option>
                <option value="so_mensagem">Só envia a mensagem de fora do horário (uma vez)</option>
                <option value="silencio">Não responde nada</option>
              </select>
            </Field>
            {r.hours.mode === "so_mensagem" && (
              <Field label="Mensagem de fora do horário">
                <textarea className="field min-h-[70px] text-sm" maxLength={1000} value={r.hours.off_message} onChange={(e) => set({ hours: { ...r.hours, off_message: e.target.value } })} />
              </Field>
            )}
          </div>
        )}
      </Section>

      <Section icon={Gauge} title="Estilo das respostas">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tamanho">
            <select className="field" value={r.length} onChange={(e) => set({ length: e.target.value as Rules["length"] })}>
              <option value="curta">Curtas (1 a 2 frases por mensagem)</option>
              <option value="media">Médias (até 4 frases quando precisar explicar)</option>
            </select>
          </Field>
          <Field label="Emojis">
            <select className="field" value={r.emojis ? "1" : "0"} onChange={(e) => set({ emojis: e.target.value === "1" })}>
              <option value="1">Permitidos com moderação</option>
              <option value="0">Proibidos (o CRM remove se aparecer)</option>
            </select>
          </Field>
        </div>
      </Section>
    </div>
  );
}
