"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, FlaskConical, History, KeyRound, Link2, Plus, Scale, ShieldCheck, Sun, Trash2, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Spinner } from "@/components/ui/misc";
import { cn, relativeTime } from "@/lib/utils";
import { BANKS, installment, isCpf, PROVIDERS, STATUS_LABEL, type BankResult, type CreditProvider, type CreditSettings } from "@/lib/credit/shared";

interface Check {
  id: number; source: "ia" | "teste"; cpf_masked: string | null; income: number | null; vehicle_value: number | null; down_payment: number | null; months: number | null;
  installment: number | null; provider: string; status: "aprovado" | "analise" | "reprovado" | "erro"; score: number | null; score_band: string | null;
  payment_capacity: string | null; reasons: string[]; banks: BankResult[]; error: string | null; created_at: string; leads: { id: string; name: string } | null;
}
interface TestResult { status: "aprovado" | "analise" | "reprovado"; score: number | null; band: string | null; installment: number; incomePct: number | null; reasons: string[]; reused: boolean; banks: BankResult[]; pending: boolean; suggestedDown?: number | null; suggestedParcel?: number | null }

function BankList({ banks }: { banks: BankResult[] }) {
  if (!banks.length) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {banks.map((b) => (
        <li key={b.banco} className="text-[11px] text-slate-400">
          <span className={b.status === "aprovado" ? "text-emerald-300" : b.status === "reprovado" ? "text-red-300" : "text-amber-300"}>●</span> {b.banco}: {STATUS_LABEL[b.status]}
          {b.parcela ? ` · ${b.prazo ? `${b.prazo}x ` : ""}${brl(b.parcela)}` : ""}{b.taxa ? ` · ${b.taxa}% a.m.` : ""}{b.mensagem ? ` — ${b.mensagem}` : ""}
        </li>
      ))}
    </ul>
  );
}

const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const STATUS_COLOR: Record<Check["status"], string> = {
  aprovado: "bg-emerald-500/15 text-emerald-300", analise: "bg-amber-500/15 text-amber-300", reprovado: "bg-red-500/15 text-red-300", erro: "bg-slate-500/15 text-slate-300",
};

function Section({ icon: I, title, hint, children }: { icon: typeof CreditCard; title: string; hint?: string; children: React.ReactNode }) {
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

const money = (s: string) => Number(s.replace(/\./g, "").replace(",", ".")) || 0;

export function CreditTab() {
  const [s, setS] = useState<CreditSettings | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [cred, setCred] = useState<{ has: boolean; hint: string | null }>({ has: false, hint: null });
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);
  const [newCred, setNewCred] = useState("");
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<Check[] | null>(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([fetch("/api/credit/settings"), fetch("/api/credit/checks")]);
    const ja = await a.json(); const jb = await b.json();
    if (!a.ok) { toast.error(ja.error); return; }
    setS(ja.settings); setSaved(JSON.stringify(ja.settings)); setCred({ has: ja.hasCred, hint: ja.credHint }); setCallbackUrl(ja.callbackUrl);
    if (b.ok) setChecks(jb.checks);
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const dirty = useMemo(() => Boolean(s) && (JSON.stringify(s) !== saved || newCred.trim().length > 0), [s, saved, newCred]);
  if (!s) return <div className="flex justify-center py-10"><Spinner /></div>;
  const set = (p: Partial<CreditSettings>) => setS({ ...s, ...p });
  const prov = PROVIDERS[s.provider === "manual" ? "directd" : s.provider];

  async function save(extra?: { credential?: null; rotateCallback?: boolean }) {
    setBusy(true);
    const res = await fetch("/api/credit/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: s, ...(extra ?? (newCred.trim() ? { credential: newCred.trim() } : {})) }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return toast.error(body.error);
    setS(body.settings); setSaved(JSON.stringify(body.settings)); setCred({ has: body.hasCred, hint: body.credHint }); setNewCred(""); setCallbackUrl(body.callbackUrl);
    toast.success("Análise de crédito salva");
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-brand-500/30 bg-brand-500/5 p-4 text-sm text-slate-300">
        <p className="font-semibold text-white">Como funciona</p>
        <p className="mt-1">A <b>IA faz a análise de crédito</b> a qualquer hora — inclusive à noite e no fim de semana, quando não tem vendedor. Ela pergunta renda, entrada, parcelas e se o nome está limpo,
          aplica a <b>regra da sua loja</b>, dá o resultado ao cliente e, se não passar, negocia outra entrada ou prazo. No modo grátis, o cliente ainda faz a <b>pré-aprovação oficial do banco</b> pelo link e manda o print, que a IA lê sozinha.</p>
        <p className="mt-2">De manhã o vendedor recebe no WhatsApp o <b>resumo</b>: quem foi pré-aprovado (foco nestes), quem está negociando e quem não passou. No funil, filtre pelas tags <i>Crédito pré-aprovado</i> / <i>em análise</i> / <i>não aprovado</i>.</p>
      </div>

      <Section icon={CreditCard} title="Análise de crédito pela IA">
        <label className="flex items-center gap-3 text-sm text-slate-200">
          <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Ligar: a IA faz a pré-análise de crédito no WhatsApp
        </label>
      </Section>

      <Section icon={Workflow} title="Como a IA analisa" hint="O modo grátis atende a maioria das lojas. A consulta paga é opcional.">
        <div className="grid gap-2">
          {(Object.keys(PROVIDERS) as CreditProvider[]).map((id) => (
            <button key={id} type="button" onClick={() => set({ provider: id })}
              className={cn("rounded-lg border p-3 text-left transition", s.provider === id ? "border-brand-500 bg-brand-500/10" : "border-line hover:border-slate-500")}>
              <p className="text-sm font-medium text-white">{PROVIDERS[id].label}{id === "ia" ? <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">recomendado</span> : <span className="ml-2 rounded-full bg-ink-700 px-2 py-0.5 text-[11px] text-slate-400">pago por consulta</span>}</p>
              <p className="mt-0.5 text-xs text-slate-400">{PROVIDERS[id].text}</p>
            </button>
          ))}
        </div>
        {s.provider === "bancos" && (
          <div className="space-y-2">
            <p className="label">Bancos em que a loja é credenciada</p>
            <div className="flex flex-wrap gap-1.5">
              {BANKS.map((b) => {
                const on = s.banks.includes(b);
                return (
                  <button key={b} type="button" onClick={() => set({ banks: on ? s.banks.filter((x) => x !== b) : [...s.banks, b] })}
                    className={cn("rounded-full border px-3 py-1 text-xs transition", on ? "border-brand-500 bg-brand-500/15 text-white" : "border-line text-slate-400 hover:text-slate-200")}>{b}</button>
                );
              })}
            </div>
            <div className="rounded-lg border border-line bg-ink-800 p-3 text-xs text-slate-400">
              <p className="font-medium text-slate-200">Como ligar os bancos</p>
              <p className="mt-1">Os bancos não liberam API direto para lojas: a ficha passa por uma plataforma multibanco em que a loja já é credenciada.
                A <b>Zinix</b> tem API para CRM com Santander, BV, PAN, Safra, Itaú e Bradesco; a <b>Credere</b> libera API sob consulta. Peça a eles o endereço da API e a chave, ou use um fluxo do n8n no meio.</p>
              <p className="mt-2">Endereço de retorno (os bancos que respondem depois mandam o resultado aqui):</p>
              <code className="mt-1 block select-all break-all rounded bg-ink-900 px-2 py-1 text-[11px] text-slate-300">{callbackUrl ?? "…"}</code>
              <p className="mt-1">Mande em JSON: <code>{`{"consulta_id": 123, "banco": "Santander", "status": "aprovado", "parcela": 1290.5, "taxa": 1.89, "prazo": 48}`}</code> (um banco por vez ou vários em <code>bancos</code>).</p>
              <button type="button" className="mt-2 text-[11px] text-brand-300 hover:text-brand-200" disabled={busy}
                onClick={() => { if (confirm("Gerar um novo endereço de retorno? O endereço atual para de funcionar e precisa ser trocado na plataforma de bancos.")) void save({ rotateCallback: true }); }}>Gerar novo endereço</button>
            </div>
          </div>
        )}
        {prov.needsUrl && (
          <Field label={s.provider === "bancos" ? "Endereço da API da plataforma de bancos (https://)" : "Endereço do sistema (https://)"} hint='O CRM envia POST com cpf, nome, telefone, renda_mensal, valor_veiculo, entrada e parcelas. Responda em JSON, por exemplo: {"status": "aprovado", "score": 720, "motivo": "..."} (status: aprovado, reprovado ou analise). Para bancos: {"bancos": [{"banco": "Santander", "status": "aprovado", "parcela": 1290.5, "taxa": 1.89, "prazo": 48}]}, e quem responder depois manda para o endereço de retorno com o consulta_id.'>
            <input className="field font-mono text-xs" value={s.webhook_url ?? ""} placeholder="https://seu-sistema.com/credito" onChange={(e) => set({ webhook_url: e.target.value.trim() || null })} />
          </Field>
        )}
        {s.provider === "ia" && <BankLinks links={s.bank_links} onChange={(bank_links) => set({ bank_links })} />}
        {s.provider !== "manual" && s.provider !== "ia" && (
          <Field label={s.provider === "directd" ? "Token de acesso da Direct Data" : s.provider === "bancos" ? "Chave de acesso da plataforma de bancos (vai no cabeçalho Authorization: Bearer)" : "Chave de acesso (opcional, vai no cabeçalho Authorization: Bearer)"}
            hint={cred.has ? `Chave salva (${cred.hint}). Cole outra só se quiser trocar.` : "Fica guardada só no servidor e só é usada nesta opção; ninguém da equipe consegue ver depois."}>
            <div className="flex gap-2">
              <input className="field flex-1 font-mono text-xs" type="password" name="credito-chave" autoComplete="new-password" value={newCred}
                placeholder={cred.has ? "••••••••" : "Cole aqui"} onChange={(e) => setNewCred(e.target.value)} />
              {cred.has && <Button variant="ghost" onClick={() => void save({ credential: null })} disabled={busy}>Apagar</Button>}
            </div>
          </Field>
        )}
        {s.provider === "directd" && (
          <p className="flex items-start gap-1.5 text-xs text-slate-500"><KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />Crie a conta em directd.com.br, compre créditos e copie o token no painel. O mesmo CPF consultado nos últimos 30 dias é reaproveitado (não paga de novo).</p>
        )}
      </Section>

      <Section icon={Scale} title="Regra de aprovação da loja" hint="A IA decide o resultado com base nisto.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Entrada mínima (% do valor do veículo)">
            <input type="number" min={0} max={90} className="field" value={s.min_down_pct} onChange={(e) => set({ min_down_pct: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <Field label="Renda mínima (R$)" hint="0 = sem mínimo">
            <input type="number" min={0} className="field" value={s.min_income} onChange={(e) => set({ min_income: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <label className="flex items-center gap-3 self-end pb-2 text-sm text-slate-200 sm:col-span-2">
            <input type="checkbox" checked={s.accept_negative} onChange={(e) => set({ accept_negative: e.target.checked })} />
            A loja aceita cliente com nome negativado (tem banco/financeira que aprova)
          </label>
        </div>
        <div className={cn("grid gap-3 sm:grid-cols-2", s.provider === "ia" && "hidden")}>
          <Field label="Pré-aprovado com score a partir de">
            <input type="number" min={0} max={1000} className="field" value={s.min_score} onChange={(e) => set({ min_score: Math.round(Number(e.target.value) || 0) })} />
          </Field>
          <Field label="Em análise com score a partir de" hint="Abaixo disso: não aprovado (o cliente nunca ouve isso).">
            <input type="number" min={0} max={1000} className="field" value={s.review_score} onChange={(e) => set({ review_score: Math.round(Number(e.target.value) || 0) })} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Parcela pode comprometer até (% da renda)">
            <input type="number" min={5} max={100} className="field" value={s.max_income_pct} onChange={(e) => set({ max_income_pct: Number(e.target.value) || 30 })} />
          </Field>
          <Field label="Taxa estimada (% ao mês) para calcular a parcela">
            <input type="number" min={0} max={15} step={0.1} className="field" value={s.monthly_rate} onChange={(e) => set({ monthly_rate: Number(e.target.value) || 0 })} />
          </Field>
          <Field label="Máximo de consultas pagas por dia">
            <input type="number" min={1} max={5000} className="field" value={s.max_per_day} onChange={(e) => set({ max_per_day: Math.round(Number(e.target.value) || 1) })} />
          </Field>
        </div>
      </Section>

      <Section icon={Sun} title="Vendedor recebe o resultado" hint="O vendedor chega e já sabe em quem focar.">
        <Field label="WhatsApp do vendedor / equipe" hint="DDI + DDD + número, ex.: 5585999990000.">
          <input className="field" inputMode="numeric" value={s.notify_phone ?? ""} placeholder="5585999990000" onChange={(e) => set({ notify_phone: e.target.value.replace(/\D/g, "") || null })} />
        </Field>
        <Field label="Resumo diário das análises" hint="Pré-aprovados primeiro, depois os que estão negociando e os que não passaram — com link de cada conversa.">
          <select className="field" value={s.digest_hour ?? ""} onChange={(e) => set({ digest_hour: e.target.value === "" ? null : Number(e.target.value) })}>
            <option value="">Sem resumo</option>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>Todo dia às {String(h).padStart(2, "0")}:00</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-3 text-sm text-slate-200">
          <input type="checkbox" checked={s.notify_each} onChange={(e) => set({ notify_each: e.target.checked })} />
          Avisar também na hora, a cada análise (além do resumo)
        </label>
        <label className="flex items-center gap-3 text-sm text-slate-200">
          <input type="checkbox" checked={s.handoff} onChange={(e) => set({ handoff: e.target.checked })} />
          Crédito pré-aprovado: passar a conversa para o vendedor fechar a venda
        </label>
      </Section>

      <div className="flex items-center justify-end gap-2">
        {dirty && <span className="text-xs text-amber-300">Alterações não salvas</span>}
        <Button onClick={() => void save()} disabled={busy || !dirty}>{busy ? <Spinner /> : null} Salvar</Button>
      </div>

      <TestBox settings={s} onDone={load} dirty={dirty} />

      <Section icon={History} title="Consultas feitas" hint="Pela IA e pelos testes. O CPF nunca fica guardado inteiro.">
        {!checks ? <Spinner /> : !checks.length ? <p className="text-sm text-slate-500">Nenhuma consulta ainda.</p> : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs text-slate-500"><tr>
                <th className="px-4 py-2 font-medium">Quando</th><th className="px-2 py-2 font-medium">Cliente</th><th className="px-2 py-2 font-medium">CPF</th>
                <th className="px-2 py-2 font-medium">Resultado</th><th className="px-2 py-2 font-medium">Score</th><th className="px-2 py-2 font-medium">Veículo / entrada</th><th className="px-4 py-2 font-medium">Parcela</th>
              </tr></thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.id} className="border-t border-line align-top">
                    <td className="px-4 py-2 text-xs text-slate-400">{relativeTime(c.created_at)}{c.source === "teste" ? <span className="ml-1 rounded bg-ink-700 px-1 text-[10px]">teste</span> : null}</td>
                    <td className="px-2 py-2 text-slate-200">{c.leads?.name ?? "—"}</td>
                    <td className="px-2 py-2 font-mono text-xs text-slate-400">{c.cpf_masked ?? "—"}<span className="block font-sans text-[10px] text-slate-500">{c.provider === "ia" ? "pré-análise da IA" : c.provider === "banco_cliente" ? "print do banco" : c.provider === "directd" ? "Direct Data" : c.provider === "bancos" ? "bancos" : "sistema próprio"}</span></td>
                    <td className="px-2 py-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs", STATUS_COLOR[c.status])}>{STATUS_LABEL[c.status]}</span>
                      {(c.error || c.reasons.length > 0) && <p className="mt-1 max-w-[260px] text-[11px] text-slate-500">{c.error ?? c.reasons.join(" · ")}</p>}
                      <BankList banks={c.banks ?? []} />
                    </td>
                    <td className="px-2 py-2 text-slate-300">{c.score ?? "—"}{c.score_band ? <span className="block text-[11px] text-slate-500">{c.score_band}</span> : null}</td>
                    <td className="px-2 py-2 text-xs text-slate-300">{brl(c.vehicle_value)}<span className="block text-slate-500">entrada {brl(c.down_payment)}</span></td>
                    <td className="px-4 py-2 text-xs text-slate-300">{c.months && c.installment ? `${c.months}x ${brl(c.installment)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function TestBox({ settings, onDone, dirty }: { settings: CreditSettings; onDone: () => void; dirty: boolean }) {
  const [f, setF] = useState({ cpf: "", income: "", vehicle: "", down: "", months: "48", negative: "nao" });
  const free = settings.provider === "ia";
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<TestResult | null>(null);
  const preview = installment(Math.max(0, money(f.vehicle) - money(f.down)), settings.monthly_rate, Number(f.months) || 48);
  const cpfOk = free ? !f.cpf || isCpf(f.cpf) : isCpf(f.cpf);

  async function run() {
    setBusy(true); setRes(null);
    const r = await fetch("/api/credit/test", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        consent: true, negative: f.negative,
        input: { cpf: f.cpf, income: money(f.income), vehicle_value: money(f.vehicle), down_payment: money(f.down), months: Number(f.months) || 48 },
      }),
    });
    const body = await r.json();
    setBusy(false);
    if (!r.ok) { toast.error(body.error); onDone(); return; }
    setRes(body.result); onDone();
  }

  return (
    <Section icon={FlaskConical} title={free ? "Simular uma análise" : "Testar com um CPF"} hint={free ? "Mesma regra que a IA usa no WhatsApp. Sem custo." : settings.provider === "directd" ? "Consulta de verdade na Direct Data (conta no saldo). Use o seu CPF ou de alguém que autorizou." : "Roda a mesma análise que a IA faz, com a configuração acima."}>
      <div className="grid gap-3 sm:grid-cols-5">
        {free ? (
          <Field label="Nome limpo?">
            <select className="field" value={f.negative} onChange={(e) => setF({ ...f, negative: e.target.value })}>
              <option value="nao">Sim, sem restrição</option><option value="sim">Tem restrição</option><option value="nao_sabe">Não sabe</option>
            </select>
          </Field>
        ) : <Field label="CPF"><input className={cn("field", f.cpf && !cpfOk && "border-red-500/60")} inputMode="numeric" name="credito-cpf" autoComplete="off" value={f.cpf} onChange={(e) => setF({ ...f, cpf: e.target.value })} placeholder="000.000.000-00" /></Field>}
        <Field label="Renda mensal (R$)"><input className="field" inputMode="decimal" value={f.income} onChange={(e) => setF({ ...f, income: e.target.value })} placeholder="5.000" /></Field>
        <Field label="Valor do veículo (R$)"><input className="field" inputMode="decimal" value={f.vehicle} onChange={(e) => setF({ ...f, vehicle: e.target.value })} placeholder="33.990" /></Field>
        <Field label="Entrada (R$)"><input className="field" inputMode="decimal" value={f.down} onChange={(e) => setF({ ...f, down: e.target.value })} placeholder="5.000" /></Field>
        <Field label="Parcelas"><input type="number" min={1} max={120} className="field" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} /></Field>
      </div>
      {preview > 0 && <p className="text-xs text-slate-500">Parcela estimada: {Number(f.months) || 48}x de {brl(preview)} ({settings.monthly_rate}% a.m.)</p>}
      {!free && (
        <label className="flex items-start gap-2 text-xs text-slate-300">
          <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span><ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-brand-300" />O dono deste CPF autorizou a consulta de crédito (LGPD).</span>
        </label>
      )}
      <div className="flex justify-end">
        {dirty && <span className="mr-2 self-center text-xs text-amber-300">Salve a configuração antes de testar</span>}
        <Button onClick={() => void run()} disabled={busy || dirty || (!free && !consent) || !cpfOk || !money(f.vehicle)}>{busy ? <Spinner /> : null} {free ? "Simular" : "Consultar"}</Button>
      </div>
      {res && (
        <div className="rounded-lg border border-line bg-ink-800 p-3 text-sm">
          <p><span className={cn("rounded-full px-2 py-0.5 text-xs", STATUS_COLOR[res.status])}>{STATUS_LABEL[res.status]}</span>
            {res.score != null && <span className="ml-2 text-slate-300">score {res.score}{res.band ? ` (${res.band})` : ""}</span>}
            {res.reused && <span className="ml-2 text-xs text-slate-500">reaproveitada</span>}</p>
          <p className="mt-1 text-xs text-slate-400">Parcela estimada {brl(res.installment)}{res.incomePct != null ? ` · ${res.incomePct}% da renda` : ""}</p>
          {res.reasons.length > 0 && <p className="mt-1 text-xs text-slate-500">{res.reasons.join(" · ")}</p>}
          <BankList banks={res.banks} />
          {res.suggestedDown != null && <p className="mt-1 text-xs text-brand-200">A IA proporia: entrada de {brl(res.suggestedDown)} → parcela de {brl(res.suggestedParcel)}</p>}
          {res.pending && <p className="mt-1 text-xs text-amber-300">Aguardando a resposta dos outros bancos — aparece no histórico abaixo quando chegar.</p>}
        </div>
      )}
    </Section>
  );
}

function BankLinks({ links, onChange }: { links: { banco: string; url: string }[]; onChange: (l: { banco: string; url: string }[]) => void }) {
  return (
    <div className="space-y-2 rounded-lg border border-line bg-ink-800 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-slate-200"><Link2 className="h-4 w-4 text-brand-300" /> Links gratuitos de pré-aprovação do banco</p>
      <p className="text-xs text-slate-400">Depois da pré-análise positiva, a IA manda estes links. O cliente faz a pré-aprovação oficial no celular (sem custo para a loja) e envia o print; a IA lê e registra o resultado.</p>
      {links.map((l, i) => (
        <div key={i} className="flex gap-2">
          <input className="field w-40" value={l.banco} placeholder="Banco" onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, banco: e.target.value } : x)))} />
          <input className="field flex-1 font-mono text-xs" value={l.url} placeholder="https://" onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, url: e.target.value.trim() } : x)))} />
          <Button variant="ghost" onClick={() => onChange(links.filter((_, j) => j !== i))} aria-label="Remover link"><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      {links.length < 10 && <Button variant="secondary" size="sm" onClick={() => onChange([...links, { banco: "", url: "https://" }])}><Plus className="h-3.5 w-3.5" /> Adicionar banco</Button>}
    </div>
  );
}
