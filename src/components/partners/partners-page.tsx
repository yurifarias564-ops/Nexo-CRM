"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandingEditor } from "@/components/branding/branding-editor";
import { PixRevenue } from "./pix-revenue";
import { AlertTriangle, Palette, CalendarDays, CheckCircle2, CreditCard, ExternalLink, Handshake, LogIn, MessageCircle, Receipt, Search, Send, Settings2, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Modal, Spinner } from "@/components/ui/misc";
import { cn, formatBRL, relativeTime } from "@/lib/utils";

interface Partner {
  id: string; name: string; created_at: string; owner_name: string | null; owner_email: string | null;
  status: "pending" | "active" | "past_due" | "canceled" | null; current_period_end: string | null; next_due_date: string | null; value_cents: number | null;
  billing_type: string | null; card_brand: string | null; card_last4: string | null; asaas_subscription_id: string | null;
  members: number; leads: number; leads_30d: number; won_30d: number; channels_connected: number; last_activity: string | null;
  billing_group_id: string | null; billing_group_name: string | null; notes: string | null; mine: boolean;
}
interface Channel { id: string; name: string; phone_number: string | null; provider: string; status: string }
interface Data { partners: Partner[]; settings: { billing_channel_id: string | null; billing_hour: number }; channels: Channel[]; supporting: string[] }

type Situ = "ativo" | "vence" | "atrasado" | "bloqueado" | "aguardando" | "cortesia" | "cancelado";
const SITU: Record<Situ, { l: string; c: string }> = {
  ativo: { l: "Ativo", c: "bg-emerald-500/15 text-emerald-300" },
  vence: { l: "Vence em breve", c: "bg-amber-500/15 text-amber-300" },
  atrasado: { l: "Em atraso", c: "bg-red-500/15 text-red-300" },
  bloqueado: { l: "Bloqueado", c: "bg-red-500/20 text-red-200" },
  aguardando: { l: "Aguardando 1º pagamento", c: "bg-slate-500/20 text-slate-300" },
  cortesia: { l: "Cortesia", c: "bg-brand-500/15 text-brand-200" },
  cancelado: { l: "Cancelado", c: "bg-slate-600/20 text-slate-500" },
};

const DAY = 86_400_000;
function dueOf(p: Partner): string | null {
  if (p.next_due_date) return p.next_due_date;
  if (!p.current_period_end) return null;
  const d = new Date(new Date(p.current_period_end).getTime() - 3 * DAY);
  return d.toISOString().slice(0, 10);
}
function situation(p: Partner): Situ {
  if (p.status === "canceled") return "cancelado";
  if (p.status === "pending" || !p.status) return "aguardando";
  if (p.status === "past_due") return "bloqueado";
  if (!p.current_period_end) return "cortesia";
  if (new Date(p.current_period_end).getTime() < Date.now()) return "bloqueado";
  const due = dueOf(p);
  if (due) {
    const days = Math.ceil((new Date(`${due}T23:59:00`).getTime() - Date.now()) / DAY);
    if (days < 0) return "atrasado";
    if (days <= 5) return "vence";
  }
  return "ativo";
}
const dmy = (d: string) => d.split("-").reverse().join("/");
function dueLabel(d: string | null) {
  if (!d) return "—";
  const days = Math.ceil((new Date(`${d}T23:59:00`).getTime() - Date.now()) / DAY);
  return `${dmy(d)} · ${days === 0 ? "hoje" : days > 0 ? `em ${days} dia${days > 1 ? "s" : ""}` : `há ${-days} dia${days < -1 ? "s" : ""}`}`;
}
function payLabel(p: Partner) {
  if (p.billing_type === "CREDIT_CARD") return { l: `Cartão${p.card_last4 ? ` •••• ${p.card_last4}` : ""}`, auto: true };
  if (p.billing_type === "BOLETO") return { l: "Boleto", auto: false };
  if (p.billing_type === "PIX") return { l: "Pix", auto: false };
  return { l: p.asaas_subscription_id ? "Boleto / Pix" : "—", auto: false };
}

export function PartnersPage() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"todos" | Situ>("todos");
  const [open, setOpen] = useState<Partner | null>(null);
  const [settings, setSettings] = useState(false);
  const [entering, setEntering] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/platform/partners");
    const body = await res.json();
    if (!res.ok) { toast.error(body.error); return; }
    setData(body);
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (data?.partners ?? []).filter((p) => !p.mine)
      .filter((p) => !n || [p.name, p.owner_name, p.owner_email].some((x) => x?.toLowerCase().includes(n)))
      .filter((p) => filter === "todos" || situation(p) === filter);
  }, [data, q, filter]);

  const kpi = useMemo(() => {
    const all = (data?.partners ?? []).filter((p) => !p.mine);
    const s = all.map(situation);
    const paying = all.filter((p, i) => ["ativo", "vence", "atrasado"].includes(s[i]!));
    return {
      total: all.length,
      ativos: s.filter((x) => x === "ativo" || x === "vence" || x === "cortesia").length,
      vence: s.filter((x) => x === "vence").length,
      atraso: s.filter((x) => x === "atrasado" || x === "bloqueado").length,
      mrr: paying.reduce((t, p) => t + (p.value_cents ?? 0), 0) / 100,
      cartao: all.filter((p) => p.billing_type === "CREDIT_CARD").length,
    };
  }, [data]);

  async function enter(p: Partner) {
    setEntering(p.id);
    const res = await fetch(`/api/platform/partners/${p.id}/access`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) { setEntering(null); return toast.error(body.error); }
    toast.success(`Entrando na conta de ${p.name}…`);
    router.push("/dashboard");
    router.refresh();
  }

  if (!data) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  const billingChannel = data.channels.find((c) => c.id === data.settings.billing_channel_id);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/15 text-brand-200"><Handshake className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-white">Parceiros</h2>
            <p className="text-sm text-slate-400">Todas as empresas que usam o CRM: situação, vencimento, forma de pagamento, uso — e acesso de suporte.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setSettings(true)}><Settings2 className="h-4 w-4" /> Cobrança no WhatsApp</Button>
        </div>

        {!billingChannel && (
          <button onClick={() => setSettings(true)} className="flex w-full items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-left text-sm text-amber-100">
            <AlertTriangle className="h-4 w-4 shrink-0" /> Escolha o número de WhatsApp que envia os boletos nos grupos dos clientes para ligar a cobrança automática.
          </button>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <K icon={Users} l="Parceiros" v={String(kpi.total)} />
          <K icon={CheckCircle2} l="Ativos" v={String(kpi.ativos)} c="text-emerald-300" />
          <K icon={CalendarDays} l="Vencem em 5 dias" v={String(kpi.vence)} c="text-amber-300" />
          <K icon={AlertTriangle} l="Em atraso / bloqueados" v={String(kpi.atraso)} c="text-red-300" />
          <K icon={Wallet} l="Receita mensal" v={formatBRL(kpi.mrr)} />
          <K icon={CreditCard} l="No cartão (débito automático)" v={String(kpi.cartao)} />
        </div>

        <PixRevenue />

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input className="field pl-9" placeholder="Buscar empresa, dono ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {(["todos", "ativo", "vence", "atrasado", "bloqueado", "aguardando", "cortesia"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cn("rounded-full border px-3 py-1 text-xs", filter === f ? "border-brand-400/50 bg-brand-500/15 text-brand-100" : "border-line text-slate-400 hover:text-slate-200")}>
              {f === "todos" ? "Todos" : SITU[f].l}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-xl border border-line bg-ink-900">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2.5 font-medium">Empresa</th><th className="px-3 py-2.5 font-medium">Situação</th><th className="px-3 py-2.5 font-medium">Vencimento</th>
                <th className="px-3 py-2.5 font-medium">Pagamento</th><th className="px-3 py-2.5 text-right font-medium">Valor</th><th className="px-3 py-2.5 text-right font-medium">Uso (30 dias)</th>
                <th className="px-3 py-2.5 font-medium">Grupo de cobrança</th><th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {!list.length && <tr><td colSpan={8} className="p-8 text-center text-slate-500">Nenhuma empresa {filter !== "todos" ? "nesse filtro" : "ainda"}.</td></tr>}
              {list.map((p) => {
                const s = situation(p);
                const pay = payLabel(p);
                return (
                  <tr key={p.id} className="text-slate-300 hover:bg-ink-850">
                    <td className="px-3 py-2.5">
                      <button onClick={() => setOpen(p)} className="text-left">
                        <p className="font-medium text-slate-100 hover:text-brand-200">{p.name}</p>
                        <p className="text-xs text-slate-500">{p.owner_name ?? "—"}{p.owner_email ? ` · ${p.owner_email}` : ""}</p>
                        <p className="text-[11px] text-slate-600">cliente desde {new Date(p.created_at).toLocaleDateString("pt-BR")}</p>
                      </button>
                    </td>
                    <td className="px-3 py-2.5"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", SITU[s].c)}>{SITU[s].l}</span></td>
                    <td className="px-3 py-2.5 text-xs">{s === "cortesia" ? "sem vencimento" : dueLabel(dueOf(p))}</td>
                    <td className="px-3 py-2.5 text-xs">{pay.l}{pay.auto && <span className="ml-1 rounded bg-emerald-500/10 px-1 text-[10px] text-emerald-300">débito automático</span>}</td>
                    <td className="px-3 py-2.5 text-right">{p.value_cents ? formatBRL(p.value_cents / 100) : "—"}</td>
                    <td className="px-3 py-2.5 text-right text-xs">
                      <span title="Leads novos">{p.leads_30d} leads</span> · <span className="text-emerald-300" title="Vendas">{p.won_30d} vendas</span>
                      <p className="text-[11px] text-slate-500">{p.members} usuário{p.members === 1 ? "" : "s"} · {p.channels_connected ? `${p.channels_connected} WhatsApp` : <span className="text-amber-300">WhatsApp desconectado</span>}{p.last_activity ? ` · ativo ${relativeTime(p.last_activity)}` : ""}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs">{p.billing_group_name ? <span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3 text-emerald-300" />{p.billing_group_name}</span> : <button onClick={() => setOpen(p)} className="text-amber-300 hover:underline">escolher grupo</button>}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => setOpen(p)}>Gerenciar</Button>
                        <Button size="sm" onClick={() => void enter(p)} loading={entering === p.id}><LogIn className="h-3.5 w-3.5" /> Acessar</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {open && <PartnerModal p={open} canBill={Boolean(billingChannel)} onClose={() => setOpen(null)} onChanged={() => void load()} onEnter={() => void enter(open)} />}
      {settings && <BillingSettings data={data} onClose={() => setSettings(false)} onSaved={() => { setSettings(false); void load(); }} />}
    </div>
  );
}

function K({ icon: I, l, v, c }: { icon: typeof Users; l: string; v: string; c?: string }) {
  return (
    <div className="rounded-xl border border-line bg-ink-900 p-3">
      <p className="flex items-center gap-1.5 text-xs text-slate-400"><I className="h-3.5 w-3.5" /> {l}</p>
      <p className={cn("mt-1 text-xl font-semibold tracking-tight text-white", c)}>{v}</p>
    </div>
  );
}

interface Payment { id: string; status: string; billingType: string; value: number; dueDate: string; invoiceUrl?: string; paymentDate?: string | null }
const PSTATUS: Record<string, { l: string; c: string }> = {
  PENDING: { l: "Em aberto", c: "text-amber-300" }, OVERDUE: { l: "Vencida", c: "text-red-300" }, RECEIVED: { l: "Paga", c: "text-emerald-300" },
  CONFIRMED: { l: "Paga", c: "text-emerald-300" }, RECEIVED_IN_CASH: { l: "Paga (dinheiro)", c: "text-emerald-300" }, REFUNDED: { l: "Estornada", c: "text-slate-400" },
};
const BT: Record<string, string> = { CREDIT_CARD: "Cartão", BOLETO: "Boleto", PIX: "Pix", UNDEFINED: "Boleto/Pix/Cartão" };

function PartnerModal({ p, canBill, onClose, onChanged, onEnter }: { p: Partner; canBill: boolean; onClose: () => void; onChanged: () => void; onEnter: () => void }) {
  const [detail, setDetail] = useState<{ payments: Payment[]; asaasError: string | null; asaas: { billingType: string; nextDueDate: string; value: number; status: string } | null; log: { action: string; details: Record<string, unknown>; created_at: string }[] } | null>(null);
  const [date, setDate] = useState(dueOf(p) ?? "");
  const [value, setValue] = useState(p.value_cents ? String(p.value_cents / 100).replace(".", ",") : "");
  const [notes, setNotes] = useState(p.notes ?? "");
  const [groups, setGroups] = useState<{ id: string; subject: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [branding, setBranding] = useState(false);

  const loadDetail = useCallback(async () => {
    const r = await fetch(`/api/platform/partners/${p.id}`);
    const d = await r.json();
    if (r.ok) setDetail(d); else toast.error(d.error);
  }, [p.id]);
  useEffect(() => { const t = setTimeout(() => void loadDetail(), 0); return () => clearTimeout(t); }, [loadDetail]);

  async function patch(body: Record<string, unknown>, msg: string, key: string) {
    setBusy(key);
    try {
      const r = await fetch(`/api/platform/partners/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      toast.success(msg); onChanged(); void loadDetail();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }
  async function loadGroups() {
    setBusy("groups");
    const r = await fetch("/api/platform/billing");
    const d = await r.json();
    setBusy(null);
    if (!r.ok) return toast.error(d.error);
    setGroups(d.groups);
  }
  async function billNow() {
    setBusy("bill");
    const r = await fetch(`/api/platform/partners/${p.id}/bill`, { method: "POST" });
    const d = await r.json();
    setBusy(null);
    if (!r.ok) return toast.error(d.error);
    toast.success(`Cobrança de ${formatBRL(d.value)} (vence ${dmy(d.dueDate)}) enviada no grupo`);
  }

  const s = situation(p);
  return (
    <Modal open onClose={onClose} title={p.name} wide>
      <div className="space-y-5 text-sm" data-modal-body>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", SITU[s].c)}>{SITU[s].l}</span>
          <span className="text-slate-400">{p.owner_name ?? "—"} · {p.owner_email ?? "—"}</span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setBranding(true)}><Palette className="h-3.5 w-3.5" /> Marca e domínio</Button>
          <Button size="sm" onClick={onEnter}><LogIn className="h-3.5 w-3.5" /> Acessar conta</Button>
        </div>

        <section className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2">
          <Field label="Vencimento" hint={p.asaas_subscription_id ? "Muda no Asaas também (e a cobrança em aberto)." : "Cliente sem assinatura no Asaas: muda só o acesso."}>
            <div className="flex gap-2">
              <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
              <Button variant="secondary" onClick={() => void patch({ action: "due_date", date }, "Vencimento alterado", "date")} loading={busy === "date"} disabled={!date}>Salvar</Button>
            </div>
          </Field>
          <Field label="Valor mensal (R$)">
            <div className="flex gap-2">
              <input className="field" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d,.]/g, ""))} />
              <Button variant="secondary" loading={busy === "value"} disabled={!value}
                onClick={() => void patch({ action: "value", value_cents: Math.round(Number(value.replace(/\./g, "").replace(",", ".")) * 100) }, "Valor alterado", "value")}>Salvar</Button>
            </div>
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button size="sm" variant="outline" onClick={() => void patch({ action: "status", status: "active" }, "Acesso liberado", "st")}>Liberar acesso</Button>
            <Button size="sm" variant="outline" onClick={() => void patch({ action: "status", status: "courtesy" }, "Cortesia: sem vencimento", "st")}>Cortesia (sem vencimento)</Button>
            <Button size="sm" variant="danger" onClick={() => { if (confirm(`Bloquear o acesso de ${p.name} agora?`)) void patch({ action: "status", status: "blocked" }, "Acesso bloqueado", "st"); }}>Bloquear acesso</Button>
          </div>
        </section>

        <section className="space-y-2 rounded-xl border border-line p-3">
          <h4 className="flex items-center gap-2 font-semibold text-white"><Receipt className="h-4 w-4 text-brand-300" /> Cobrança</h4>
          <p className="text-xs text-slate-400">
            {p.billing_type === "CREDIT_CARD"
              ? `Débito automático no cartão${p.card_last4 ? ` •••• ${p.card_last4}` : ""} no dia do vencimento. Se o cartão falhar, o boleto vai no grupo 2 dias depois.`
              : "Não paga no cartão: no dia do vencimento o boleto + Pix vai sozinho no grupo abaixo; 2 dias depois, se não pagou, vai um lembrete."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-300">Grupo: <b className="text-white">{p.billing_group_name ?? "nenhum"}</b></span>
            <Button size="sm" variant="outline" onClick={() => void loadGroups()} loading={busy === "groups"} disabled={!canBill}>Escolher grupo</Button>
            <Button size="sm" variant="outline" onClick={() => void billNow()} loading={busy === "bill"} disabled={!canBill || !p.billing_group_id || !p.asaas_subscription_id}><Send className="h-3.5 w-3.5" /> Enviar cobrança agora</Button>
            {!canBill && <span className="text-xs text-amber-300">Configure o número de cobrança primeiro.</span>}
          </div>
          {groups && (
            <select className="field" defaultValue="" onChange={(e) => { const g = groups.find((x) => x.id === e.target.value); if (g) void patch({ action: "group", group_id: g.id, group_name: g.subject }, `Grupo “${g.subject}” definido`, "grp"); }}>
              <option value="" disabled>Escolha o grupo do cliente ({groups.length})</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.subject}</option>)}
            </select>
          )}
          {!detail ? <div className="flex justify-center py-4"><Spinner /></div> : detail.asaasError ? <p className="text-xs text-red-300">Asaas: {detail.asaasError}</p> : detail.payments.length ? (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
              {detail.payments.map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <span className="w-20 text-slate-300">{dmy(x.dueDate)}</span>
                  <span className="w-24 text-white">{formatBRL(x.value)}</span>
                  <span className="w-28 text-slate-400">{BT[x.billingType] ?? x.billingType}</span>
                  <span className={cn("flex-1", PSTATUS[x.status]?.c ?? "text-slate-400")}>{PSTATUS[x.status]?.l ?? x.status}{x.paymentDate ? ` em ${dmy(x.paymentDate)}` : ""}</span>
                  {x.invoiceUrl && <a href={x.invoiceUrl} target="_blank" rel="noopener noreferrer" className="text-brand-300 hover:text-brand-200"><ExternalLink className="h-3.5 w-3.5" /></a>}
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-slate-500">{p.asaas_subscription_id ? "Nenhuma cobrança ainda." : "Sem assinatura no Asaas (acesso controlado só pela data)."}</p>}
        </section>

        <section className="space-y-2">
          <Field label="Anotações sobre o cliente">
            <textarea className="field min-h-[70px]" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Button size="sm" variant="secondary" disabled={notes === (p.notes ?? "")} loading={busy === "notes"} onClick={() => void patch({ action: "notes", notes }, "Anotação salva", "notes")}>Salvar anotação</Button>
        </section>

        <section className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {[["Leads (total)", p.leads], ["Leads 30 dias", p.leads_30d], ["Vendas 30 dias", p.won_30d], ["Usuários", p.members]].map(([l, v]) => (
            <div key={String(l)} className="rounded-lg bg-ink-850 p-2"><p className="text-slate-500">{l}</p><p className="text-base font-semibold text-white">{v}</p></div>
          ))}
        </section>

        {branding && (
          <Modal open onClose={() => setBranding(false)} title={`Marca e domínio — ${p.name}`} wide>
            <div data-modal-body><BrandingEditor orgId={p.id} /></div>
          </Modal>
        )}

        {detail?.log.length ? (
          <section>
            <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Histórico</h4>
            <ul className="space-y-0.5 text-xs text-slate-400">{detail.log.map((l, i) => <li key={i}>{new Date(l.created_at).toLocaleString("pt-BR")} — {l.action}</li>)}</ul>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

function BillingSettings({ data, onClose, onSaved }: { data: Data; onClose: () => void; onSaved: () => void }) {
  const [ch, setCh] = useState(data.settings.billing_channel_id ?? "");
  const [hour, setHour] = useState(data.settings.billing_hour);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const r = await fetch("/api/platform/billing", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ billing_channel_id: ch || null, billing_hour: hour }) });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) return toast.error(d.error);
    toast.success("Cobrança no WhatsApp configurada"); onSaved();
  }
  return (
    <Modal open onClose={onClose} title="Cobrança no WhatsApp" footer={<Button onClick={() => void save()} loading={busy}>Salvar</Button>}>
      <div className="space-y-3 text-sm" data-modal-body>
        <p className="text-slate-400">Quem paga no <b className="text-slate-200">cartão</b> é debitado sozinho pelo Asaas no dia do vencimento. Para os demais, o CRM manda no <b className="text-slate-200">grupo do cliente</b> o boleto (linha digitável), o Pix copia e cola e o link de pagamento — no dia do vencimento e, se não pagar, 2 dias depois.</p>
        <Field label="Número que envia (precisa estar nos grupos dos clientes)">
          <select className="field" value={ch} onChange={(e) => setCh(e.target.value)}>
            <option value="">Nenhum (cobrança no grupo desligada)</option>
            {data.channels.map((c) => <option key={c.id} value={c.id} disabled={c.provider === "meta"}>{c.name}{c.phone_number ? ` · ${c.phone_number}` : ""}{c.provider === "meta" ? " (API oficial não envia para grupos)" : c.status !== "connected" ? " (desconectado)" : ""}</option>)}
          </select>
        </Field>
        <Field label="A partir de que horas enviar">
          <select className="field" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
            {Array.from({ length: 15 }, (_, i) => i + 6).map((h) => <option key={h} value={h}>{h}h</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
