"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Brain, CreditCard, KeyRound, Plug, RotateCcw, Send, Sparkles, Tag as TagIcon, Trash2, Activity, Settings2, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Spinner } from "@/components/ui/misc";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { cn, relativeTime } from "@/lib/utils";

type Provider = "claude" | "gemini" | "groq";
interface Agent {
  enabled: boolean; name: string; provider: Provider; model: string | null; prompt: string; channel_ids: string[] | null;
  start_mode: "new_leads" | "all"; reply_delay_seconds: number; pause_on_human: boolean; pause_hours: number;
  auto_tags: boolean; transcribe_audio: boolean; time_zone: string; tone: Tone;
}
type Tone = "executivo" | "consultivo" | "proximo";
interface KeyInfo { own: boolean; ownHint: string | null; platform: boolean }
interface Channel { id: string; name: string; phone_number: string | null; provider: string; status: string }
interface Config { agent: Agent; keys: Record<Provider, KeyInfo>; channels: Channel[]; models: Record<Provider, { id: string; label: string }[]> }

const PROVIDERS: { id: Provider; label: string; note: string; keyUrl: string }[] = [
  { id: "claude", label: "Claude", note: "O mais inteligente para vender e seguir regras. Pago por uso.", keyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "gemini", label: "Gemini", note: "Do Google. Tem uso gratuito com limite diário.", keyUrl: "https://aistudio.google.com/apikey" },
  { id: "groq", label: "Groq", note: "Modelos abertos, muito rápidos. Uso gratuito com limite.", keyUrl: "https://console.groq.com/keys" },
];

const TABS = [
  { id: "config", label: "Configuração", icon: Settings2 },
  { id: "test", label: "Testar", icon: FlaskConical },
  { id: "memory", label: "Memória", icon: Brain },
  { id: "activity", label: "Atividade", icon: Activity },
  { id: "credit", label: "Análise de crédito", icon: CreditCard },
  { id: "api", label: "API", icon: Plug },
] as const;
type TabId = (typeof TABS)[number]["id"];

const TONES: { id: Tone; label: string; note: string; sample: string }[] = [
  { id: "executivo", label: "Executivo", note: "Português culto e elegante, padrão de marca premium. Sem gírias.", sample: "Boa noite, Yuri. Será um prazer apresentar a MT-03. Para indicar a melhor condição, ela seria para uso diário?" },
  { id: "consultivo", label: "Consultivo", note: "Profissional e caloroso, como um especialista.", sample: "Boa noite, Yuri! A MT-03 é uma ótima escolha. Você pensa em usar no dia a dia ou mais na estrada?" },
  { id: "proximo", label: "Próximo", note: "Leve e simpático, linguagem do dia a dia.", sample: "Opa, boa noite, Yuri! Tem MT-03 sim 😄 Vai usar mais pra cidade?" },
];

const EXAMPLE_PROMPT = `# IDENTIDADE
Você é o especialista de atendimento da (nome da loja), concessionária de motos em (cidade). Seu papel é receber cada cliente com excelência, entender exatamente o que ele procura e conduzi-lo para uma visita, um test drive ou para o especialista de vendas.

# A EMPRESA
- Endereço: (endereço completo) — (ponto de referência)
- Horário: segunda a sexta, 8h às 18h; sábado, 8h às 12h
- Diferenciais: (ex.: revisão gratuita nos primeiros 1.000 km, entrega em 24h, oficina própria, 15 anos de mercado)

# PRODUTOS
- Motos novas: (ex.: MT-03, Fazer 250, Factor 150, NMax 160)
- Seminovas: com procedência e revisão, estoque muda toda semana
- Preços: NÃO informe valores fechados. Diga que o especialista prepara a melhor condição de acordo com entrada e prazo.

# CONDIÇÕES DE PAGAMENTO
- À vista (Pix ou transferência), cartão de crédito, financiamento e consórcio
- Aceitamos moto usada na troca, mediante avaliação presencial
- Simulação de financiamento: sempre feita pelo especialista

# ROTEIRO DE ATENDIMENTO
1. Cumprimente e responda primeiro o que o cliente perguntou.
2. Descubra, uma pergunta por vez: modelo de interesse → uso (cidade, estrada, trabalho) → forma de pagamento → se tem entrada ou moto para troca → prazo para comprar.
3. Valorize o modelo de acordo com o uso que ele contou.
4. Convide para visita ou test drive oferecendo dois horários.
5. Cliente pronto para negociar valores → transfira para o especialista.

# OBJEÇÕES FREQUENTES
- "Está caro": reconheça, pergunte quanto pretende investir por mês e diga que o especialista monta uma condição dentro disso.
- "Vou pensar": pergunte com delicadeza o que falta para decidir e ofereça enviar mais detalhes.
- "Achei mais barato em outro lugar": pergunte as condições da outra proposta e diga que o especialista vai analisar para apresentar a melhor alternativa.

# TRANSFERIR PARA O ESPECIALISTA QUANDO
- O cliente pedir preço final, simulação ou desconto
- Quiser fechar, reservar ou pagar
- Pedir para falar com uma pessoa, fizer reclamação ou perguntar algo que não está aqui`;

function useConfig() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/ai/agent");
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    setCfg(data);
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  return { cfg, setCfg, load };
}

export function AgentPage() {
  const { cfg, setCfg, load } = useConfig();
  const [tab, setTab] = useState<TabId>("config");
  const [draft, setDraft] = useState<Agent | null>(null);
  const agent = draft ?? cfg?.agent ?? null;
  const dirty = Boolean(draft && cfg && JSON.stringify(draft) !== JSON.stringify(pick(cfg.agent)));

  if (!cfg || !agent) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  const set = (p: Partial<Agent>) => setDraft({ ...pick(agent), ...p });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/15 text-brand-200"><Bot className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-white">Agente de IA</h2>
            <p className="text-sm text-slate-400">Atende seus clientes no WhatsApp 24h, coloca tags, guarda tudo o que o cliente contou e passa para o vendedor na hora certa.</p>
          </div>
          <span className={cn("rounded-full px-3 py-1 text-xs font-medium", cfg.agent.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-ink-700 text-slate-400")}>
            {cfg.agent.enabled ? "● Atendendo" : "Desligado"}
          </span>
        </div>

        <div className="flex gap-1 overflow-x-auto rounded-lg border border-line bg-ink-900 p-1 text-sm" role="tablist">
          {TABS.map(({ id, label, icon: I }) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition", tab === id ? "bg-ink-700 text-white" : "text-slate-400 hover:text-slate-200")}>
              <I className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        {tab === "config" && <ConfigTab cfg={cfg} agent={agent} set={set} dirty={dirty} onSaved={(a) => { setCfg({ ...cfg, agent: a }); setDraft(null); }} reloadKeys={load} />}
        {tab === "test" && <TestTab agent={agent} keys={cfg.keys} />}
        {tab === "memory" && <MemoryTab />}
        {tab === "activity" && <ActivityTab />}
        {tab === "credit" && <Soon title="Análise de crédito" text="Na próxima etapa: a IA pede o CPF com o consentimento do cliente, consulta no sistema de crédito da loja (bureau, banco ou correspondente) e, se aprovar, passa para o vendedor com o resultado. Terá um teste para conferir com o seu próprio CPF." />}
        {tab === "api" && <Soon title="API aberta" text="Na próxima etapa: chave de API por empresa e avisos automáticos (webhooks) para ligar o agente e o CRM a outros sistemas — estoque, ERP, site, planilhas." />}
      </div>
    </div>
  );
}

function pick(a: Agent): Agent {
  const { enabled, name, provider, model, prompt, channel_ids, start_mode, reply_delay_seconds, pause_on_human, pause_hours, auto_tags, transcribe_audio, time_zone, tone } = a;
  return { enabled, name, provider, model, prompt, channel_ids, start_mode, reply_delay_seconds, pause_on_human, pause_hours, auto_tags, transcribe_audio, time_zone, tone: tone ?? "executivo" };
}

function Soon({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-ink-900/60 p-6">
      <p className="font-semibold text-white">{title} <span className="ml-2 rounded-full bg-brand-500/15 px-2 py-0.5 text-[11px] text-brand-200">em construção</span></p>
      <p className="mt-2 text-sm text-slate-400">{text}</p>
    </div>
  );
}

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
        className={cn("mt-0.5 h-5 w-9 shrink-0 rounded-full p-0.5 transition", on ? "bg-emerald-500" : "bg-ink-600")}>
        <span className={cn("block h-4 w-4 rounded-full bg-white transition", on && "translate-x-4")} />
      </button>
      <span><span className="block text-sm text-slate-100">{label}</span>{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
    </label>
  );
}

function ConfigTab({ cfg, agent, set, dirty, onSaved, reloadKeys }: {
  cfg: Config; agent: Agent; set: (p: Partial<Agent>) => void; dirty: boolean; onSaved: (a: Agent) => void; reloadKeys: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const key = cfg.keys[agent.provider];
  const hasKey = key.own || key.platform;

  async function save(override?: Partial<Agent>) {
    const body = { ...pick(agent), ...override };
    if (body.enabled && !cfg.keys[body.provider].own && !cfg.keys[body.provider].platform) return toast.error("Cadastre a chave da IA escolhida antes de ligar o agente.");
    setBusy(true);
    try {
      const res = await fetch("/api/ai/agent", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSaved(data.agent);
      toast.success(body.enabled ? "Agente salvo e atendendo" : "Agente salvo");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-ink-900 p-4">
        <Toggle on={agent.enabled} onChange={(v) => set({ enabled: v })} label="Agente atendendo no WhatsApp" hint="Desligado, ele não responde ninguém (o teste continua funcionando)." />
        <div className="ml-auto flex gap-2">
          <Button onClick={() => void save()} loading={busy} disabled={!dirty}>Salvar</Button>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-line bg-ink-900 p-4">
        <h3 className="font-semibold text-white">Qual IA</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          {PROVIDERS.map((p) => (
            <button key={p.id} type="button" onClick={() => set({ provider: p.id, model: null })}
              className={cn("rounded-xl border p-3 text-left transition", agent.provider === p.id ? "border-brand-400/60 bg-brand-500/10" : "border-line hover:border-slate-500")}>
              <span className="flex items-center justify-between font-medium text-white">{p.label}
                {(cfg.keys[p.id].own || cfg.keys[p.id].platform) ? <span className="text-[11px] text-emerald-300">chave ok</span> : <span className="text-[11px] text-amber-300">sem chave</span>}
              </span>
              <span className="mt-1 block text-xs text-slate-400">{p.note}</span>
            </button>
          ))}
        </div>
        <Field label="Modelo">
          <select className="field" value={agent.model ?? ""} onChange={(e) => set({ model: e.target.value || null })}>
            {cfg.models[agent.provider].map((m, i) => <option key={m.id} value={i === 0 ? "" : m.id}>{m.label}</option>)}
          </select>
        </Field>
        <KeyBox provider={agent.provider} info={key} onChange={reloadKeys} />
        {!hasKey && <p className="text-xs text-amber-300">Sem chave para {PROVIDERS.find((p) => p.id === agent.provider)?.label}: cadastre acima para testar e ligar.</p>}
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-ink-900 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex-1 font-semibold text-white">Prompt — como o agente deve atender</h3>
          {!agent.prompt.trim() && <Button size="sm" variant="outline" onClick={() => set({ prompt: EXAMPLE_PROMPT })}><Sparkles className="h-3.5 w-3.5" /> Usar modelo de loja de motos</Button>}
        </div>
        <Field label="Nome do agente" hint="Como ele se apresenta para o cliente.">
          <input className="field" maxLength={40} value={agent.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Tom de voz</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {TONES.map((t) => (
              <button key={t.id} type="button" onClick={() => set({ tone: t.id })}
                className={cn("rounded-xl border p-3 text-left transition", agent.tone === t.id ? "border-brand-400/60 bg-brand-500/10" : "border-line hover:border-slate-500")}>
                <span className="block font-medium text-white">{t.label}</span>
                <span className="mt-1 block text-xs text-slate-400">{t.note}</span>
                <span className="mt-1.5 block text-[11px] italic text-slate-500">“{t.sample}”</span>
              </button>
            ))}
          </div>
        </div>
        <textarea className="field min-h-[320px] font-mono text-[13px] leading-5" maxLength={30000} value={agent.prompt} onChange={(e) => set({ prompt: e.target.value })}
          placeholder="Explique a empresa, produtos, preços que pode falar, horários, endereço, regras e quando passar para o vendedor." />
        <p className="text-xs text-slate-500">{agent.prompt.length.toLocaleString("pt-BR")} / 30.000 · O CRM já ensina o agente a colocar tags, guardar a memória, resumir a negociação, agendar e transferir.</p>
      </section>

      <section className="grid gap-4 rounded-xl border border-line bg-ink-900 p-4 md:grid-cols-2">
        <div className="space-y-4">
          <h3 className="font-semibold text-white">Quando responder</h3>
          <Field label="Números de WhatsApp">
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={!agent.channel_ids} onChange={(e) => set({ channel_ids: e.target.checked ? null : cfg.channels.map((c) => c.id) })} /> Todos os números</label>
              {agent.channel_ids && cfg.channels.map((c) => (
                <label key={c.id} className="flex items-center gap-2 pl-5 text-sm text-slate-300">
                  <input type="checkbox" checked={agent.channel_ids!.includes(c.id)}
                    onChange={(e) => set({ channel_ids: e.target.checked ? [...agent.channel_ids!, c.id] : agent.channel_ids!.filter((x) => x !== c.id) })} />
                  {c.name}{c.phone_number ? ` · ${c.phone_number}` : ""}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Quais conversas">
            <select className="field" value={agent.start_mode} onChange={(e) => set({ start_mode: e.target.value as Agent["start_mode"] })}>
              <option value="new_leads">Só conversas novas (depois de ligar o agente)</option>
              <option value="all">Todas, inclusive clientes antigos</option>
            </select>
          </Field>
          <Field label="Esperar antes de responder" hint="O cliente costuma mandar várias mensagens seguidas; a IA espera e responde tudo de uma vez.">
            <select className="field" value={agent.reply_delay_seconds} onChange={(e) => set({ reply_delay_seconds: Number(e.target.value) })}>
              {[3, 5, 8, 12, 20, 30, 45, 60].map((s) => <option key={s} value={s}>{s} segundos</option>)}
            </select>
          </Field>
        </div>
        <div className="space-y-4">
          <h3 className="font-semibold text-white">Comportamento</h3>
          <Toggle on={agent.pause_on_human} onChange={(v) => set({ pause_on_human: v })} label="Pausar quando o vendedor responder" hint="Se alguém da equipe escrever na conversa (pelo CRM ou pelo celular), a IA para nessa conversa." />
          {agent.pause_on_human && (
            <Field label="Pausar por">
              <select className="field" value={agent.pause_hours} onChange={(e) => set({ pause_hours: Number(e.target.value) })}>
                {[1, 2, 4, 8, 12, 24, 48, 72, 168, 720].map((h) => <option key={h} value={h}>{h < 24 ? `${h} hora${h > 1 ? "s" : ""}` : `${h / 24} dia${h > 24 ? "s" : ""}`}</option>)}
              </select>
            </Field>
          )}
          <Toggle on={agent.auto_tags} onChange={(v) => set({ auto_tags: v })} label="Criar tags automaticamente" hint='Cliente procurou uma MT-03 → a IA cria a tag "MT-03" e coloca no lead.' />
          <Toggle on={agent.transcribe_audio} onChange={(v) => set({ transcribe_audio: v })} label="Ouvir os áudios do cliente" hint="Transforma o áudio em texto para a IA entender (usa a Groq, gratuita)." />
          <Field label="Fuso horário (para agendar)">
            <select className="field" value={agent.time_zone} onChange={(e) => set({ time_zone: e.target.value })}>
              {["America/Sao_Paulo", "America/Fortaleza", "America/Recife", "America/Bahia", "America/Belem", "America/Manaus", "America/Cuiaba", "America/Porto_Velho", "America/Rio_Branco", "America/Noronha"].map((z) => <option key={z} value={z}>{z.replace("America/", "").replace("_", " ")}</option>)}
            </select>
          </Field>
        </div>
      </section>

      {dirty && (
        <div className="sticky bottom-3 flex items-center justify-end gap-2 rounded-xl border border-brand-400/30 bg-ink-850/95 p-3 shadow-xl backdrop-blur">
          <span className="mr-auto text-sm text-slate-300">Alterações não salvas — dá para testar antes na aba Testar.</span>
          <Button onClick={() => void save()} loading={busy}>Salvar</Button>
        </div>
      )}
    </div>
  );
}

function KeyBox({ provider, info, onChange }: { provider: Provider; info: KeyInfo; onChange: () => Promise<void> }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const p = PROVIDERS.find((x) => x.id === provider)!;
  async function put(apiKey: string | null) {
    setBusy(true);
    try {
      const res = await fetch("/api/ai/agent/key", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, apiKey }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setValue("");
      toast.success(apiKey ? "Chave salva" : "Chave removida");
      await onChange();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="rounded-lg border border-line bg-ink-850 p-3 text-sm">
      <p className="flex items-center gap-2 text-slate-200"><KeyRound className="h-4 w-4 text-slate-400" /> Chave da {p.label}
        <span className="ml-auto text-xs text-slate-400">
          {info.own ? `própria da empresa (${info.ownHint})` : info.platform ? "usando a chave da plataforma" : "não cadastrada"}
        </span>
      </p>
      <div className="mt-2 flex gap-2">
        <input className="field flex-1" type="password" autoComplete="off" placeholder={info.own ? "Colar nova chave para trocar" : "Cole aqui a chave (opcional se a plataforma já tiver)"} value={value} onChange={(e) => setValue(e.target.value)} />
        <Button variant="secondary" onClick={() => void put(value.trim())} disabled={value.trim().length < 20} loading={busy}>Salvar</Button>
        {info.own && <Button variant="ghost" onClick={() => void put(null)} disabled={busy} aria-label="Remover chave"><Trash2 className="h-4 w-4" /></Button>}
      </div>
      <a href={p.keyUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-block text-xs text-brand-300 hover:text-brand-200">Onde pegar a chave da {p.label} →</a>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Teste
// ------------------------------------------------------------------------------------------------

type Effect =
  | { kind: "tag_add"; name: string } | { kind: "tag_remove"; name: string } | { kind: "memory"; facts: string[] }
  | { kind: "summary"; text: string } | { kind: "stage"; name: string } | { kind: "value"; value: number }
  | { kind: "appointment"; when: string; title: string } | { kind: "handoff"; reason: string; seller: string | null };
type TMsg = { role: "user" | "assistant"; text: string; effects?: Effect[]; meta?: string; error?: boolean };
interface SimLead { name: string; tags: string[]; memory: string[]; summary: string | null; stage: string | null; value: number }

function effectLabel(e: Effect): string {
  switch (e.kind) {
    case "tag_add": return `🏷️ Tag “${e.name}” no lead`;
    case "tag_remove": return `🏷️ Tirou a tag “${e.name}”`;
    case "memory": return `🧠 Guardou: ${e.facts.join(" · ")}`;
    case "summary": return "📝 Atualizou o resumo da negociação";
    case "stage": return `➡️ Moveu para ${e.name}`;
    case "value": return `💰 Valor R$ ${e.value.toLocaleString("pt-BR")}`;
    case "appointment": return `📅 Agendou: ${e.title} (${e.when})`;
    case "handoff": return `🙋 Transferiu para ${e.seller ?? "um vendedor"}: ${e.reason}`;
  }
}

function TestTab({ agent, keys }: { agent: Agent; keys: Record<Provider, KeyInfo> }) {
  const ws = useWorkspace();
  const fresh = (): SimLead => ({ name: "Cliente teste", tags: [], memory: [], summary: null, stage: null, value: 0 });
  const [msgs, setMsgs] = useState<TMsg[]>([]);
  const [lead, setLead] = useState<SimLead>(fresh);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [handedOff, setHandedOff] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const hasKey = keys[agent.provider].own || keys[agent.provider].platform;

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [msgs, busy]);

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    const next: TMsg[] = [...msgs, { role: "user", text: t }];
    setMsgs(next); setText(""); setBusy(true);
    try {
      const history = next.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
      const res = await fetch("/api/ai/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: { name: agent.name, prompt: agent.prompt, provider: agent.provider, model: agent.model, auto_tags: agent.auto_tags, tone: agent.tone, time_zone: agent.time_zone }, history, lead }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const effects = data.effects as Effect[];
      let l = { ...lead };
      for (const e of effects) {
        if (e.kind === "tag_add" && !l.tags.includes(e.name)) l = { ...l, tags: [...l.tags, e.name] };
        if (e.kind === "tag_remove") l = { ...l, tags: l.tags.filter((x) => x !== e.name) };
        if (e.kind === "memory") l = { ...l, memory: [...l.memory, ...e.facts.filter((f) => !l.memory.includes(f))] };
        if (e.kind === "summary") l = { ...l, summary: e.text };
        if (e.kind === "stage") l = { ...l, stage: e.name };
        if (e.kind === "value") l = { ...l, value: e.value };
        if (e.kind === "handoff") setHandedOff(true);
      }
      setLead(l);
      const parts = (data.messages as string[]).length ? (data.messages as string[]) : [""];
      const meta = `${data.model} · ${(data.ms / 1000).toFixed(1)}s`;
      setMsgs((cur) => [...cur, ...parts.map((p, i) => ({ role: "assistant" as const, text: p, effects: i === parts.length - 1 ? effects : undefined, meta: i === parts.length - 1 ? meta : undefined }))]);
    } catch (e) {
      setMsgs((cur) => [...cur, { role: "assistant", text: `⚠️ ${(e as Error).message}`, error: true }]);
    } finally { setBusy(false); }
  }

  function reset() { setMsgs([]); setLead(fresh()); setHandedOff(false); }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="flex h-[620px] flex-col overflow-hidden rounded-xl border border-line bg-[#0b141a]">
        <header className="flex items-center gap-3 border-b border-white/5 bg-[#202c33] px-4 py-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600/30 text-emerald-200"><Bot className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{agent.name} · {ws.orgName}</p>
            <p className="text-[11px] text-slate-400">Simulação — você é o cliente. Nada é enviado nem alterado no CRM.</p>
          </div>
          <Button size="sm" variant="ghost" onClick={reset}><RotateCcw className="h-3.5 w-3.5" /> Recomeçar</Button>
        </header>
        <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto px-4 py-4 text-sm">
          {!msgs.length && (
            <div className="mx-auto mt-10 max-w-sm rounded-lg bg-[#182229] p-4 text-center text-xs text-slate-300">
              Escreva como se fosse um cliente, por exemplo: <i>“Oi, vocês têm MT-03? Quanto fica financiada?”</i><br />
              {!hasKey && <span className="mt-2 block text-amber-300">Cadastre a chave da IA na aba Configuração para testar.</span>}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[80%] rounded-lg px-3 py-1.5 shadow", m.role === "user" ? "bg-[#005c4b] text-white" : m.error ? "bg-red-900/40 text-red-100" : "bg-[#202c33] text-slate-100")}>
                {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                {m.effects && m.effects.length > 0 && (
                  <div className="mt-1.5 space-y-0.5 border-t border-white/10 pt-1.5">
                    {m.effects.map((e, k) => <p key={k} className="text-[11px] text-emerald-200/90">{effectLabel(e)}</p>)}
                  </div>
                )}
                {m.meta && <p className="mt-0.5 text-right text-[10px] text-slate-500">{m.meta}</p>}
              </div>
            </div>
          ))}
          {busy && <p className="text-xs text-slate-500">digitando…</p>}
          {handedOff && <p className="mx-auto w-fit rounded-md bg-amber-500/10 px-3 py-1 text-[11px] text-amber-200">Aqui o atendimento passaria para o vendedor e a IA pararia nesta conversa.</p>}
        </div>
        <footer className="flex items-end gap-2 bg-[#202c33] p-2.5">
          <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder="Mensagem do cliente"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            className="max-h-32 min-h-[42px] flex-1 resize-none rounded-lg bg-[#2a3942] px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500" />
          <Button size="icon" className="h-[42px] w-[42px] rounded-full bg-emerald-600 hover:bg-emerald-500" onClick={() => void send()} disabled={!text.trim() || busy} aria-label="Enviar"><Send className="h-4 w-4" /></Button>
        </footer>
      </div>

      <aside className="space-y-3 rounded-xl border border-line bg-ink-900 p-4 text-sm">
        <Field label="Nome do cliente no teste">
          <input className="field" maxLength={80} value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value || "Cliente" })} />
        </Field>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Tags</p>
          <div className="flex flex-wrap gap-1">{lead.tags.length ? lead.tags.map((t) => <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-500/15 px-2 py-0.5 text-xs text-brand-100"><TagIcon className="h-3 w-3" />{t}</span>) : <span className="text-xs text-slate-500">nenhuma</span>}</div>
        </div>
        <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Etapa</p><p className="text-slate-200">{lead.stage ?? "—"}{lead.value ? ` · R$ ${lead.value.toLocaleString("pt-BR")}` : ""}</p></div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Memória</p>
          {lead.memory.length ? <ul className="space-y-1 text-xs text-slate-300">{lead.memory.map((f) => <li key={f}>• {f}</li>)}</ul> : <p className="text-xs text-slate-500">nada ainda</p>}
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Resumo da negociação</p>
          <p className="whitespace-pre-wrap text-xs text-slate-300">{lead.summary ?? "—"}</p>
        </div>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Memória
// ------------------------------------------------------------------------------------------------

interface MemRow { id: number; lead_id: string; fact: string; source: string; created_at: string }

function MemoryTab() {
  const [rows, setRows] = useState<(MemRow & { leads: { name: string; ai_summary: string | null } | null })[] | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [fact, setFact] = useState("");
  const [summary, setSummary] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().from("ai_lead_memory").select("id, lead_id, fact, source, created_at, leads(name, ai_summary)").order("created_at", { ascending: false }).limit(2000);
    if (error) { toast.error(error.message); return; }
    setRows((data ?? []) as unknown as typeof rows);
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const leads = useMemo(() => {
    const m = new Map<string, { id: string; name: string; summary: string | null; count: number; last: string }>();
    for (const r of rows ?? []) {
      const cur = m.get(r.lead_id);
      if (cur) cur.count++;
      else m.set(r.lead_id, { id: r.lead_id, name: r.leads?.name ?? "Lead", summary: r.leads?.ai_summary ?? null, count: 1, last: r.created_at });
    }
    const n = q.trim().toLowerCase();
    return [...m.values()].filter((l) => !n || l.name.toLowerCase().includes(n));
  }, [rows, q]);
  const cur = leads.find((l) => l.id === sel) ?? null;
  const facts = (rows ?? []).filter((r) => r.lead_id === sel).sort((a, b) => a.created_at.localeCompare(b.created_at));

  async function add() {
    if (!sel || !fact.trim()) return;
    const res = await fetch("/api/ai/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: sel, fact }) });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error);
    setFact(""); void load();
  }
  async function remove(id: number) {
    const { error } = await supabaseBrowser().from("ai_lead_memory").delete().eq("id", id);
    if (error) return toast.error(error.message);
    void load();
  }
  async function saveSummary() {
    if (!sel || summary === null) return;
    const res = await fetch("/api/ai/memory", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: sel, summary }) });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error);
    toast.success("Resumo salvo"); setSummary(null); void load();
  }

  if (!rows) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (!rows.length) return <Soon title="Memória dos clientes" text="Ainda vazia. Quando o agente conversar com os clientes, tudo o que eles contarem (modelo que procuram, cidade, forma de pagamento, troca…) aparece aqui, por cliente, e a IA usa nas próximas conversas." />;

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      <div className="space-y-2">
        <input className="field" placeholder="Buscar cliente" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="max-h-[560px] divide-y divide-line overflow-y-auto rounded-xl border border-line bg-ink-900">
          {leads.map((l) => (
            <li key={l.id}><button onClick={() => { setSel(l.id); setSummary(null); }} className={cn("w-full px-3 py-2 text-left text-sm hover:bg-ink-800", sel === l.id && "bg-ink-800")}>
              <span className="block truncate text-slate-100">{l.name}</span>
              <span className="text-xs text-slate-500">{l.count} informaç{l.count === 1 ? "ão" : "ões"} · {relativeTime(l.last)}</span>
            </button></li>
          ))}
        </ul>
      </div>
      <div className="space-y-4 rounded-xl border border-line bg-ink-900 p-4">
        {!cur ? <p className="text-sm text-slate-400">Escolha um cliente para ver o que a IA sabe dele.</p> : (
          <>
            <h3 className="font-semibold text-white">{cur.name}</h3>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Resumo da negociação</p>
              <textarea className="field min-h-[90px] text-sm" value={summary ?? cur.summary ?? ""} onChange={(e) => setSummary(e.target.value)} placeholder="A IA escreve conforme a conversa avança." maxLength={4000} />
              {summary !== null && <Button size="sm" className="mt-1" onClick={() => void saveSummary()}>Salvar resumo</Button>}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">O que a IA sabe</p>
              <ul className="space-y-1">
                {facts.map((f) => (
                  <li key={f.id} className="group flex items-start gap-2 rounded-md px-2 py-1 text-sm text-slate-200 hover:bg-ink-800">
                    <span className="mt-0.5 text-xs">{f.source === "ai" ? "🤖" : "👤"}</span>
                    <span className="flex-1">{f.fact}</span>
                    <span className="text-[11px] text-slate-500">{relativeTime(f.created_at)}</span>
                    <button onClick={() => void remove(f.id)} className="text-slate-600 opacity-0 hover:text-red-300 group-hover:opacity-100" aria-label="Apagar"><Trash2 className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                <input className="field flex-1" maxLength={500} placeholder="Adicionar informação (ex.: prefere falar à noite)" value={fact} onChange={(e) => setFact(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
                <Button variant="secondary" onClick={() => void add()} disabled={!fact.trim()}>Adicionar</Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Atividade
// ------------------------------------------------------------------------------------------------

interface Run { id: number; status: string; reply: string | null; tools: { name: string; args: Record<string, unknown> }[]; error: string | null; ms: number | null; model: string; created_at: string; leads: { name: string } | null }

function ActivityTab() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  useEffect(() => {
    void supabaseBrowser().from("ai_runs").select("id, status, reply, tools, error, ms, model, created_at, leads(name)").order("created_at", { ascending: false }).limit(60)
      .then(({ data }) => setRuns((data ?? []) as unknown as Run[]));
  }, []);
  if (!runs) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (!runs.length) return <Soon title="Atividade" text="Cada resposta que o agente der no WhatsApp aparece aqui: o que respondeu, o que fez (tags, memória, transferência) e qualquer erro." />;
  return (
    <ul className="space-y-2">
      {runs.map((r) => (
        <li key={r.id} className="rounded-xl border border-line bg-ink-900 p-3 text-sm">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className={cn("rounded-full px-2 py-0.5", r.status === "ok" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300")}>{r.status === "ok" ? "respondeu" : "erro"}</span>
            <b className="text-slate-200">{r.leads?.name ?? "—"}</b>
            <span className="ml-auto">{r.model} · {r.ms ? `${(r.ms / 1000).toFixed(1)}s` : ""} · {relativeTime(r.created_at)}</span>
          </div>
          {r.reply && <p className="mt-1.5 whitespace-pre-wrap text-slate-200">{r.reply}</p>}
          {r.tools?.length > 0 && <p className="mt-1 text-xs text-emerald-200/80">{r.tools.map((t) => t.name.replace(/_/g, " ")).join(" · ")}</p>}
          {r.error && <p className="mt-1 text-xs text-red-300">{r.error}</p>}
        </li>
      ))}
    </ul>
  );
}
