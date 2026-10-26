"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, FlaskConical, History, KeyRound, Scale, ShieldCheck, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Spinner } from "@/components/ui/misc";
import { cn, relativeTime } from "@/lib/utils";
import { BANKS, installment, isCpf, PROVIDERS, STATUS_LABEL, type BankResult, type CreditProvider, type CreditSettings } from "@/lib/credit/shared";

interface Check {
  id: number; source: "ia" | "teste"; cpf_masked: string; income: number | null; vehicle_value: number | null; down_payment: number | null; months: number | null;
  installment: number | null; provider: string; status: "aprovado" | "analise" | "reprovado" | "erro"; score: number | null; score_band: string | null;
  payment_capacity: string | null; reasons: string[]; banks: BankResult[]; error: string | null; created_at: string; leads: { id: string; name: string } | null;
}
interface TestResult { status: "aprovado" | "analise" | "reprovado"; score: number | null; band: string | null; installment: number; incomePct: number | null; reasons: string[]; reused: boolean; banks: BankResult[]; pending: boolean }

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
        <p className="mt-1">A <b>IA faz a análise de crédito</b> do começo ao fim: oferece, pede a <b>autorização</b> do cliente, coleta CPF, renda, valor do veículo, entrada e parcelas,
          consulta a ferramenta escolhida abaixo, aplica a <b>regra da sua loja</b> e dá o resultado ao cliente (nunca o score). Se não aprovar, ela mesma negocia outra entrada ou prazo e refaz.
          O <b>vendedor recebe o resultado pronto</b> no WhatsApp e no histórico do lead — e, com o crédito pré-aprovado, entra só para fechar a venda.</p>
      </div>

      <Section icon={CreditCard} title="Análise de crédito pela IA">
        <label className="flex items-center gap-3 text-sm text-slate-200">
          <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Ligar: a IA faz a pré-análise de crédito no WhatsApp
        </label>
      </Section>

      <Section icon={Workflow} title="Ferramenta de crédito" hint="De onde vem a resposta da análise.">
        <div className="grid gap-2">
          {(Object.keys(PROVIDERS) as CreditProvider[]).map((id) => (
            <button key={id} type="button" onClick={() => set({ provider: id })}
              className={cn("rounded-lg border p-3 text-left transition", s.provider === id ? "border-brand-500 bg-brand-500/10" : "border-line hover:border-slate-500")}>
              <p className="text-sm font-medium text-white">{PROVIDERS[id].label}</p>
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
        {s.provider !== "manual" && (
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

      <Section icon={Scale} title="Regra de aprovação da loja" hint="O CRM decide o resultado com base nisto (quando a ferramenta não decide sozinha).">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Pré-aprovado com score a partir de">
            <input type="number" min={0} max={1000} className="field" value={s.min_score} onChange={(e) => set({ min_score: Math.round(Number(e.target.value) || 0) })} />
          </Field>
          <Field label="Em análise com score a partir de" hint="Abaixo disso: não aprovado (o cliente nunca ouve isso).">
            <input type="number" min={0} max={1000} className="field" value={s.review_score} onChange={(e) => set({ review_score: Math.round(Number(e.target.value) || 0) })} />
          </Field>
          <Field label="Parcela pode comprometer até (% da renda)">
            <input type="number" min={5} max={100} className="field" value={s.max_income_pct} onChange={(e) => set({ max_income_pct: Number(e.target.value) || 30 })} />
          </Field>
          <Field label="Taxa estimada (% ao mês) para calcular a parcela">
            <input type="number" min={0} max={15} step={0.1} className="field" value={s.monthly_rate} onChange={(e) => set({ monthly_rate: Number(e.target.value) || 0 })} />
          </Field>
          <Field label="Máximo de consultas por dia">
            <input type="number" min={1} max={5000} className="field" value={s.max_per_day} onChange={(e) => set({ max_per_day: Math.round(Number(e.target.value) || 1) })} />
          </Field>
        </div>
        <Field label="WhatsApp do vendedor / equipe que recebe o resultado" hint="A cada análise concluída, a IA manda o resultado (bancos, parcela, score, link da conversa) para este número. DDI + DDD + número, ex.: 5585999990000.">
          <input className="field" inputMode="numeric" value={s.notify_phone ?? ""} placeholder="5585999990000" onChange={(e) => set({ notify_phone: e.target.value.replace(/\D/g, "") || null })} />
        </Field>
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
                    <td className="px-2 py-2 font-mono text-xs text-slate-400">{c.cpf_masked}</td>
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
  const [f, setF] = useState({ cpf: "", income: "", vehicle: "", down: "", months: "48" });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<TestResult | null>(null);
  const preview = installment(Math.max(0, money(f.vehicle) - money(f.down)), settings.monthly_rate, Number(f.months) || 48);
  const cpfOk = isCpf(f.cpf);

  async function run() {
    setBusy(true); setRes(null);
    const r = await fetch("/api/credit/test", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        consent,
        input: { cpf: f.cpf, income: money(f.income), vehicle_value: money(f.vehicle), down_payment: money(f.down), months: Number(f.months) || 48 },
      }),
    });
    const body = await r.json();
    setBusy(false);
    if (!r.ok) { toast.error(body.error); onDone(); return; }
    setRes(body.result); onDone();
  }

  return (
    <Section icon={FlaskConical} title="Testar com um CPF" hint={settings.provider === "directd" ? "Consulta de verdade na Direct Data (conta no saldo). Use o seu CPF ou de alguém que autorizou." : "Roda a mesma análise que a IA faz, com a configuração acima."}>
      <div className="grid gap-3 sm:grid-cols-5">
        <Field label="CPF"><input className={cn("field", f.cpf && !cpfOk && "border-red-500/60")} inputMode="numeric" name="credito-cpf" autoComplete="off" value={f.cpf} onChange={(e) => setF({ ...f, cpf: e.target.value })} placeholder="000.000.000-00" /></Field>
        <Field label="Renda mensal (R$)"><input className="field" inputMode="decimal" value={f.income} onChange={(e) => setF({ ...f, income: e.target.value })} placeholder="5.000" /></Field>
        <Field label="Valor do veículo (R$)"><input className="field" inputMode="decimal" value={f.vehicle} onChange={(e) => setF({ ...f, vehicle: e.target.value })} placeholder="33.990" /></Field>
        <Field label="Entrada (R$)"><input className="field" inputMode="decimal" value={f.down} onChange={(e) => setF({ ...f, down: e.target.value })} placeholder="5.000" /></Field>
        <Field label="Parcelas"><input type="number" min={1} max={120} className="field" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} /></Field>
      </div>
      {preview > 0 && <p className="text-xs text-slate-500">Parcela estimada: {Number(f.months) || 48}x de {brl(preview)} ({settings.monthly_rate}% a.m.)</p>}
      <label className="flex items-start gap-2 text-xs text-slate-300">
        <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span><ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-brand-300" />O dono deste CPF autorizou a consulta de crédito (LGPD).</span>
      </label>
      <div className="flex justify-end">
        {dirty && <span className="mr-2 self-center text-xs text-amber-300">Salve a configuração antes de testar</span>}
        <Button onClick={() => void run()} disabled={busy || dirty || !consent || !cpfOk || !money(f.vehicle)}>{busy ? <Spinner /> : null} Consultar</Button>
      </div>
      {res && (
        <div className="rounded-lg border border-line bg-ink-800 p-3 text-sm">
          <p><span className={cn("rounded-full px-2 py-0.5 text-xs", STATUS_COLOR[res.status])}>{STATUS_LABEL[res.status]}</span>
            {res.score != null && <span className="ml-2 text-slate-300">score {res.score}{res.band ? ` (${res.band})` : ""}</span>}
            {res.reused && <span className="ml-2 text-xs text-slate-500">reaproveitada</span>}</p>
          <p className="mt-1 text-xs text-slate-400">Parcela estimada {brl(res.installment)}{res.incomePct != null ? ` · ${res.incomePct}% da renda` : ""}</p>
          {res.reasons.length > 0 && <p className="mt-1 text-xs text-slate-500">{res.reasons.join(" · ")}</p>}
          <BankList banks={res.banks} />
          {res.pending && <p className="mt-1 text-xs text-amber-300">Aguardando a resposta dos outros bancos — aparece no histórico abaixo quando chegar.</p>}
        </div>
      )}
    </Section>
  );
}
