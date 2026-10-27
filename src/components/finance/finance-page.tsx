"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, BadgeCheck, Banknote, Clock, ExternalLink, HeartHandshake, KeyRound, Landmark, Lock, MessageSquareHeart, Play, QrCode, RefreshCw, Unlock, Wallet, XCircle, Zap } from "lucide-react";
import { PixDemo } from "./pix-demo";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Modal, Spinner } from "@/components/ui/misc";
import { cn, formatBRL, relativeTime } from "@/lib/utils";

type Status = "awaiting_docs" | "in_review" | "approved" | "rejected";
interface Offer { addonCents: number; firstCents: number; afterCents: number; firstDays: number }
interface Account {
  status: Status; enabled: boolean; name: string; doc: string; personType: "PF" | "PJ"; onboardingUrl: string | null; addonCents: number;
  payoutKeyType: string | null; payoutKey: string | null; keyUnlocksAt: string | null; autoPayout: boolean;
  postSaleEnabled: boolean; postSaleMessage: string; moveToWon: boolean;
}
interface Data { isOwner: boolean; offer: Offer; account: Account | null; balance?: number | null; month?: { sales: number; value: number }; pendingCharges?: number }
interface Sale { id: string; value: number; description: string | null; payer_name: string | null; status: string; created_at: string; paid_at: string | null }
interface Payout { id: string; value: number; key_display: string; status: string; fail_reason: string | null; auto: boolean; created_at: string }
interface Tx { id: string; value: number; type: string; date: string | null; description: string }

const c2 = (cents: number) => formatBRL(cents / 100);
const json = async (r: Response) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? "Erro"); return j; };

export function FinancePage() {
  const [d, setD] = useState<Data | null>(null);
  const [lists, setLists] = useState<{ statement: Tx[]; sales: Sale[]; payouts: Payout[] } | null>(null);
  const load = useCallback(async () => {
    try {
      const j: Data = await json(await fetch("/api/finance"));
      setD(j);
      if (j.account) setLists(await json(await fetch("/api/finance/statement")));
    } catch (e) { toast.error((e as Error).message); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  if (!d) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300"><Wallet className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-white">Finanças</h2>
            <p className="text-sm text-slate-400">Receba Pix com confirmação automática na conversa e saque para o seu banco.</p>
          </div>
        </div>
        {!d.account ? <Locked d={d} onDone={load} /> : <Active d={d as Data & { account: Account }} lists={lists} reload={load} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Bloqueado: oferta do adicional
// ---------------------------------------------------------------------------------------------

function Locked({ d, onDone }: { d: Data; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [demo, setDemo] = useState(false);
  const o = d.offer;
  const unlock = () => { setDemo(false); if (d.isOwner) setOpen(true); else toast.message("Peça ao dono da conta para desbloquear o Pix."); };
  return (
    <section className="overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.08] to-transparent">
      <div className="grid gap-6 p-6 md:grid-cols-[1.4fr_1fr] md:p-8">
        <div className="space-y-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-800 px-2.5 py-1 text-xs text-slate-300"><Lock className="h-3.5 w-3.5" /> Bloqueado</span>
          <h3 className="text-2xl font-semibold tracking-tight text-white">Receba no Pix em segundos — e o pós-venda vai sozinho</h3>
          <p className="text-slate-300">O cliente paga pelo WhatsApp, o CRM confirma na hora, agradece por você e coloca a venda no funil. Sem conferir extrato, sem esperar.</p>
          <ul className="space-y-2 text-sm text-slate-300">
            {[
              [Zap, "Pagamento confirmado em segundos, 24h por dia"],
              [QrCode, "Pix Copia e Cola enviado direto na conversa"],
              [HeartHandshake, "Pós-venda automático assim que o cliente paga"],
              [Landmark, "Saque para o seu banco quando quiser — ou todo dia, automático"],
            ].map(([I, t]) => { const Icon = I as typeof QrCode; return <li key={t as string} className="flex items-start gap-2"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />{t as string}</li>; })}
          </ul>
        </div>
        <div className="flex flex-col justify-center gap-3 rounded-xl border border-line bg-ink-900 p-5">
          <button onClick={() => setDemo(true)} className="group relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-emerald-500/30 bg-gradient-to-br from-emerald-500/20 via-ink-800 to-brand-500/20">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 text-ink-950 shadow-lg transition group-hover:scale-110"><Play className="ml-1 h-6 w-6" /></span>
            <span className="absolute bottom-2 left-3 text-xs text-slate-200">Ver como funciona · 20s</span>
          </button>
          <Button onClick={unlock}><Unlock className="h-4 w-4" /> Desbloquear o Pix · {c2(o.addonCents)}/mês</Button>
          {!d.isOwner && <p className="text-center text-xs text-slate-500">Só o dono da conta pode desbloquear.</p>}
        </div>
      </div>
      <PixDemo open={demo} onClose={() => setDemo(false)} onUnlock={unlock} />
      {open && <ActivateModal offer={o} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onDone(); }} />}
    </section>
  );
}

function ActivateModal({ offer, onClose, onDone }: { offer: Offer; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    personType: "PJ" as "PF" | "PJ", name: "", email: "", doc: "", mobilePhone: "", birthDate: "", companyType: "MEI",
    postalCode: "", address: "", addressNumber: "", complement: "", province: "", incomeValue: "", accept: false,
  });
  const [busy, setBusy] = useState(false);
  const [fees, setFees] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  async function cep() {
    const c = f.postalCode.replace(/\D/g, "");
    if (c.length !== 8) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${c}/json/`);
      const j = await r.json();
      if (!j.erro) setF((p) => ({ ...p, address: p.address || j.logradouro || "", province: p.province || j.bairro || "" }));
    } catch { /* preenche à mão */ }
  }

  async function submit() {
    setBusy(true);
    try {
      await json(await fetch("/api/finance/account", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          personType: f.personType, name: f.name, email: f.email, doc: f.doc, mobilePhone: f.mobilePhone,
          ...(f.personType === "PF" ? { birthDate: f.birthDate } : { companyType: f.companyType }),
          postalCode: f.postalCode, address: f.address, addressNumber: f.addressNumber, complement: f.complement || undefined, province: f.province,
          incomeValue: Number(f.incomeValue.replace(/\./g, "").replace(",", ".")) || 0, accept: f.accept,
        }),
      }));
      toast.success("Conta aberta! Agora falta só enviar os documentos.");
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }

  return (
    <Modal open onClose={onClose} title="Desbloquear o Pix" wide footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={() => void submit()} loading={busy} disabled={!f.accept}>Desbloquear</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-400">Os dados do titular da conta que vai receber os pagamentos. Depois, é só enviar os documentos para a aprovação.</p>
        <div className="flex gap-2">
          {(["PJ", "PF"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setF({ ...f, personType: t })} className={cn("flex-1 rounded-lg border px-3 py-2 text-sm", f.personType === t ? "border-brand-500 bg-brand-500/10 text-white" : "border-line text-slate-400")}>
              {t === "PJ" ? "Empresa (CNPJ)" : "Pessoa física (CPF)"}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={f.personType === "PJ" ? "Razão social" : "Nome completo"}><input className="field" value={f.name} onChange={set("name")} /></Field>
          <Field label={f.personType === "PJ" ? "CNPJ" : "CPF"}><input className="field" inputMode="numeric" value={f.doc} onChange={set("doc")} /></Field>
          {f.personType === "PJ"
            ? <Field label="Tipo da empresa"><select className="field" value={f.companyType} onChange={set("companyType")}><option value="MEI">MEI</option><option value="LIMITED">Limitada (LTDA)</option><option value="INDIVIDUAL">Individual (EI/SLU)</option><option value="ASSOCIATION">Associação</option></select></Field>
            : <Field label="Data de nascimento"><input className="field" type="date" value={f.birthDate} onChange={set("birthDate")} /></Field>}
          <Field label="Faturamento mensal (R$)"><input className="field" inputMode="decimal" value={f.incomeValue} onChange={set("incomeValue")} placeholder="Ex.: 30000" /></Field>
          <Field label="E-mail"><input className="field" type="email" value={f.email} onChange={set("email")} /></Field>
          <Field label="Celular (com DDD)"><input className="field" inputMode="tel" value={f.mobilePhone} onChange={set("mobilePhone")} /></Field>
          <Field label="CEP"><input className="field" inputMode="numeric" value={f.postalCode} onChange={set("postalCode")} onBlur={() => void cep()} /></Field>
          <Field label="Bairro"><input className="field" value={f.province} onChange={set("province")} /></Field>
          <div className="sm:col-span-2"><Field label="Endereço"><input className="field" value={f.address} onChange={set("address")} /></Field></div>
          <Field label="Número"><input className="field" value={f.addressNumber} onChange={set("addressNumber")} /></Field>
          <Field label="Complemento"><input className="field" value={f.complement} onChange={set("complement")} /></Field>
        </div>
        <label className="flex items-start gap-2 rounded-lg border border-line bg-ink-900 p-3 text-sm text-slate-300">
          <input type="checkbox" className="mt-1" checked={f.accept} onChange={set("accept")} />
          <span>Quero desbloquear o Pix por <b>{c2(offer.addonCents)}/mês</b> na mensalidade e concordo com as tarifas por venda recebida. <button type="button" className="underline text-slate-400 hover:text-slate-200" onClick={(e) => { e.preventDefault(); setFees(!fees); }}>Ver tarifas</button></span>
        </label>
        {fees && <p className="rounded-lg bg-ink-800 p-3 text-xs text-slate-400">Por venda paga: {c2(offer.firstCents)} nos primeiros {offer.firstDays} dias de uso, depois {c2(offer.afterCents)}, mais a tarifa da conta de recebimento por Pix recebido (a partir de R$ 0,99). Já sai descontado de cada venda — nada a mais no boleto.</p>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Ativo
// ---------------------------------------------------------------------------------------------

const STATUS: Record<Status, { t: string; c: string; Icon: typeof Clock }> = {
  awaiting_docs: { t: "Falta enviar os documentos", c: "text-amber-300", Icon: Clock },
  in_review: { t: "Documentos em análise", c: "text-sky-300", Icon: Clock },
  approved: { t: "Conta aprovada", c: "text-emerald-300", Icon: BadgeCheck },
  rejected: { t: "Cadastro recusado", c: "text-red-300", Icon: XCircle },
};

function Active({ d, lists, reload }: { d: Data & { account: Account }; lists: { statement: Tx[]; sales: Sale[]; payouts: Payout[] } | null; reload: () => void }) {
  const a = d.account;
  const [checking, setChecking] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [tab, setTab] = useState<"vendas" | "saques" | "extrato">("vendas");
  const S = STATUS[a.status];

  async function refresh() {
    setChecking(true);
    try { await json(await fetch("/api/finance/account/refresh", { method: "POST" })); reload(); } catch (e) { toast.error((e as Error).message); }
    setChecking(false);
  }
  async function patch(body: object, msg: string) {
    try { await json(await fetch("/api/finance/account", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })); toast.success(msg); reload(); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <>
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-ink-900 p-4">
        <S.Icon className={cn("h-5 w-5", S.c)} />
        <div className="min-w-0 flex-1">
          <p className={cn("font-medium", S.c)}>{S.t}{!a.enabled && <span className="ml-2 text-xs font-normal text-slate-500">(Pix Nexo desligado — o saldo continua disponível)</span>}</p>
          <p className="text-xs text-slate-400">{a.name} · {a.doc}</p>
        </div>
        {a.status !== "approved" && a.onboardingUrl && <a href={a.onboardingUrl} target="_blank" rel="noreferrer"><Button size="sm"><ExternalLink className="h-3.5 w-3.5" /> Enviar documentos</Button></a>}
        {a.status !== "approved" && <Button size="sm" variant="outline" onClick={() => void refresh()} loading={checking}><RefreshCw className="h-3.5 w-3.5" /> Atualizar</Button>}
      </section>
      {a.status === "awaiting_docs" && !a.onboardingUrl && (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-100">Enviamos um e-mail para o titular ativar a conta de recebimento e mandar os documentos (foto do documento e selfie). Depois de aprovada, o Pix Nexo libera sozinho.</p>
      )}
      {a.status === "rejected" && <p className="rounded-lg border border-red-500/25 bg-red-500/5 p-3 text-sm text-red-100">O cadastro não foi aprovado. Fale com o suporte para revisar os dados.</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icon={Wallet} l="Saldo disponível" v={d.balance == null ? "—" : formatBRL(d.balance)} c="text-emerald-300" />
        <Kpi icon={Banknote} l="Recebido no mês" v={formatBRL(d.month?.value ?? 0)} sub={`${d.month?.sales ?? 0} venda(s)`} />
        <Kpi icon={Clock} l="Pix aguardando pagamento" v={String(d.pendingCharges ?? 0)} />
        <Kpi icon={KeyRound} l="Saque para" v={a.payoutKey ?? "—"} sub={a.payoutKey ? undefined : "cadastre sua chave Pix"} small />
      </div>

      {a.status === "approved" && d.isOwner && (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-ink-900 p-4">
          <Button onClick={() => setWithdrawOpen(true)} disabled={!a.payoutKey || !d.balance || Boolean(a.keyUnlocksAt)}><ArrowDownToLine className="h-4 w-4" /> Sacar</Button>
          <Button variant="outline" onClick={() => setKeyOpen(true)}><KeyRound className="h-4 w-4" /> {a.payoutKey ? "Trocar chave Pix" : "Cadastrar chave Pix"}</Button>
          <label className="ml-auto flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={a.autoPayout} disabled={!a.payoutKey} onChange={(e) => void patch({ autoPayout: e.target.checked }, e.target.checked ? "Saque automático ligado (todo dia às 18h)" : "Saque automático desligado")} />
            Sacar tudo automaticamente todo dia às 18h
          </label>
          {a.keyUnlocksAt && <p className="w-full text-xs text-amber-300">Chave trocada: por segurança, os saques liberam {relativeTime(a.keyUnlocksAt)}.</p>}
        </section>
      )}

      <section className="rounded-xl border border-line bg-ink-900">
        <div className="flex gap-1 border-b border-line p-2 text-sm">
          {(["vendas", "saques", "extrato"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn("rounded-md px-3 py-1.5 capitalize", tab === t ? "bg-ink-700 text-white" : "text-slate-400 hover:text-white")}>{t}</button>
          ))}
        </div>
        {!lists ? <div className="flex justify-center p-6"><Spinner /></div> : (
          <div className="divide-y divide-line text-sm">
            {tab === "vendas" && (lists.sales.length ? lists.sales.map((s) => (
              <Row key={s.id} title={s.payer_name ?? "Cliente"} sub={`${s.description ?? "Pix"} · ${relativeTime(s.paid_at ?? s.created_at)}`} value={formatBRL(Number(s.value))}
                badge={{ paid: ["Pago", "text-emerald-300"], pending: ["Aguardando", "text-amber-300"], overdue: ["Vencido", "text-slate-400"], refunded: ["Estornado", "text-red-300"], canceled: ["Cancelado", "text-slate-500"] }[s.status] as [string, string]} />
            )) : <EmptyRow t="Nenhuma venda ainda. Na conversa, use o botão Pix → Cobrança Pix Nexo." />)}
            {tab === "saques" && (lists.payouts.length ? lists.payouts.map((p) => (
              <Row key={p.id} title={`Saque${p.auto ? " automático" : ""} para ${p.key_display}`} sub={`${relativeTime(p.created_at)}${p.fail_reason ? ` · ${p.fail_reason}` : ""}`} value={formatBRL(Number(p.value))}
                badge={{ done: ["Concluído", "text-emerald-300"], pending: ["Processando", "text-amber-300"], failed: ["Falhou", "text-red-300"], canceled: ["Cancelado", "text-slate-500"] }[p.status] as [string, string]} />
            )) : <EmptyRow t="Nenhum saque ainda." />)}
            {tab === "extrato" && (lists.statement.length ? lists.statement.map((t) => (
              <Row key={t.id} title={t.description || t.type} sub={t.date ?? ""} value={formatBRL(t.value)} valueClass={t.value < 0 ? "text-red-300" : "text-emerald-300"} />
            )) : <EmptyRow t={a.status === "approved" ? "Sem movimentações." : "O extrato aparece depois da aprovação."} />)}
          </div>
        )}
      </section>

      <PostSale a={a} onSaved={reload} />

      {d.isOwner && (
        <p className="text-xs text-slate-500">
          {a.enabled
            ? <>Pix Nexo ativo · adicional de {c2(a.addonCents)}/mês. <button className="underline hover:text-slate-300" onClick={() => { if (confirm("Desligar o Pix Nexo? O adicional sai da mensalidade e não dá para cobrar Pix pela conversa. O saldo continua disponível para saque.")) void patch({ enabled: false }, "Pix Nexo desligado"); }}>Desligar</button></>
            : <button className="underline hover:text-slate-300" onClick={() => void patch({ enabled: true }, "Pix Nexo ligado de novo")}>Ligar o Pix Nexo de novo ({c2(d.offer.addonCents)}/mês)</button>}
        </p>
      )}

      {withdrawOpen && <WithdrawModal balance={d.balance ?? 0} to={a.payoutKey!} onClose={() => setWithdrawOpen(false)} onDone={() => { setWithdrawOpen(false); reload(); }} />}
      {keyOpen && <KeyModal hasKey={Boolean(a.payoutKey)} onClose={() => setKeyOpen(false)} onDone={() => { setKeyOpen(false); reload(); }} />}
    </>
  );
}

function Kpi({ icon: Icon, l, v, sub, c, small }: { icon: typeof Wallet; l: string; v: string; sub?: string; c?: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-ink-900 p-4">
      <p className="flex items-center gap-1.5 text-xs text-slate-400"><Icon className="h-3.5 w-3.5" />{l}</p>
      <p className={cn("mt-1 truncate font-semibold text-white", small ? "text-sm" : "text-xl", c)}>{v}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}
function Row({ title, sub, value, badge, valueClass }: { title: string; sub: string; value: string; badge?: [string, string]; valueClass?: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1"><p className="truncate text-slate-100">{title}</p><p className="truncate text-xs text-slate-500">{sub}</p></div>
      {badge && <span className={cn("text-xs", badge[1])}>{badge[0]}</span>}
      <span className={cn("w-28 text-right font-medium text-slate-100", valueClass)}>{value}</span>
    </div>
  );
}
const EmptyRow = ({ t }: { t: string }) => <p className="p-6 text-center text-slate-500">{t}</p>;

function WithdrawModal({ balance, to, onClose, onDone }: { balance: number; to: string; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState(balance.toFixed(2).replace(".", ","));
  const [busy, setBusy] = useState(false);
  async function go() {
    const value = Number(v.replace(/\./g, "").replace(",", "."));
    if (!(value > 0)) return toast.error("Valor inválido");
    setBusy(true);
    try { await json(await fetch("/api/finance/withdraw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) })); toast.success("Saque enviado! Cai no seu banco em instantes."); onDone(); }
    catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }
  return (
    <Modal open onClose={onClose} title="Sacar para o seu banco" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={() => void go()} loading={busy}>Confirmar saque</Button></>}>
      <div className="space-y-3">
        <Field label={`Valor (disponível ${formatBRL(balance)})`}><input className="field" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} /></Field>
        <p className="text-sm text-slate-400">Vai para a chave Pix <b className="text-slate-200">{to}</b>.</p>
      </div>
    </Modal>
  );
}

function KeyModal({ hasKey, onClose, onDone }: { hasKey: boolean; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState("cnpj");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await json(await fetch("/api/finance/account", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ payoutKeyType: type, payoutKey: key }) })); toast.success("Chave Pix salva"); onDone(); }
    catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }
  return (
    <Modal open onClose={onClose} title="Chave Pix para saques" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} loading={busy}>Salvar</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-[140px_1fr] gap-2">
          <Field label="Tipo"><select className="field" value={type} onChange={(e) => setType(e.target.value)}><option value="cnpj">CNPJ</option><option value="cpf">CPF</option><option value="phone">Celular</option><option value="email">E-mail</option><option value="random">Aleatória</option></select></Field>
          <Field label="Chave"><input className="field" value={key} onChange={(e) => setKey(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-slate-500">Use uma chave da conta do seu banco no nome do titular.{hasKey && " Por segurança, depois de trocar a chave os saques ficam bloqueados por 24h."}</p>
      </div>
    </Modal>
  );
}

function PostSale({ a, onSaved }: { a: Account; onSaved: () => void }) {
  const [f, setF] = useState({ on: a.postSaleEnabled, msg: a.postSaleMessage, won: a.moveToWon });
  const [busy, setBusy] = useState(false);
  const dirty = f.on !== a.postSaleEnabled || f.msg !== a.postSaleMessage || f.won !== a.moveToWon;
  async function save() {
    setBusy(true);
    try {
      await json(await fetch("/api/finance/account", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ postSaleEnabled: f.on, postSaleMessage: f.msg, moveToWon: f.won }) }));
      toast.success("Pós-venda salvo"); onSaved();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  }
  return (
    <section className="space-y-3 rounded-xl border border-line bg-ink-900 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <MessageSquareHeart className="h-5 w-5 text-pink-300" />
        <h3 className="font-medium text-white">Depois que o cliente paga</h3>
        <span className="text-xs text-slate-500">O CRM confirma o pagamento na conversa na hora e, em seguida:</span>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={f.on} onChange={(e) => setF({ ...f, on: e.target.checked })} /> Enviar a mensagem de pós-venda</label>
      <textarea className="field min-h-[80px]" value={f.msg} disabled={!f.on} maxLength={1000} onChange={(e) => setF({ ...f, msg: e.target.value })} />
      <p className="text-xs text-slate-500">Use {"{nome}"} para o primeiro nome do cliente.</p>
      <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={f.won} onChange={(e) => setF({ ...f, won: e.target.checked })} /> Mover o lead para “Ganho” com o valor da venda</label>
      {dirty && <div className="flex justify-end"><Button size="sm" onClick={() => void save()} loading={busy}>Salvar</Button></div>}
    </section>
  );
}
