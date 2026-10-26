"use client";
import { useCallback, useEffect, useState } from "react";
import { Coins, Lock, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Modal, Spinner } from "@/components/ui/misc";
import { cn, formatBRL, relativeTime } from "@/lib/utils";

interface Org { orgId: string; name: string; sales: number; feeCents: number; pendingCents: number; salesValue: number; lastAt: string | null; connected: boolean; accountStatus: string | null }
interface Data {
  fees: { firstCents: number; afterCents: number; firstDays: number; addonCents: number };
  addonMonthlyCents: number; totalCents: number; monthCents: number; monthSales: number; pendingCents: number;
  months: { month: string; sales: number; feeCents: number }[]; orgs: Org[];
}
const c2 = (cents: number) => formatBRL(cents / 100);
const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "short", year: "numeric" });

/** Receita do Pix Nexo (split por venda + adicional mensal) — só o dono da plataforma vê. */
export function PixRevenue() {
  const [d, setD] = useState<Data | null>(null);
  const [edit, setEdit] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch("/api/platform/pix-revenue");
    const j = await r.json();
    if (!r.ok) { toast.error(j.error); return; }
    setD(j);
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  if (!d) return <div className="flex justify-center rounded-xl border border-line bg-ink-900 p-6"><Spinner /></div>;
  const max = Math.max(1, ...d.months.map((m) => m.feeCents));
  return (
    <section className="space-y-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Coins className="h-5 w-5 text-emerald-300" />
        <h3 className="font-semibold text-white">Receita do Pix Nexo</h3>
        <span className="flex items-center gap-1 rounded-full bg-ink-800 px-2 py-0.5 text-[11px] text-slate-400"><Lock className="h-3 w-3" /> só você vê</span>
        <span className="ml-auto text-xs text-slate-400">{c2(d.fees.firstCents)} por venda nos primeiros {d.fees.firstDays} dias da loja · depois {c2(d.fees.afterCents)} · adicional {c2(d.fees.addonCents)}/mês</span>
        <Button size="sm" variant="ghost" onClick={() => setEdit(true)}><Settings2 className="h-3.5 w-3.5" /> Taxa</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi l="Este mês" v={c2(d.monthCents)} sub={`${d.monthSales} venda(s)`} c="text-emerald-300" />
        <Kpi l="Total recebido" v={c2(d.totalCents)} />
        <Kpi l="A confirmar (Pix enviados, não pagos)" v={c2(d.pendingCents)} c="text-amber-300" />
        <Kpi l="Lojas com Pix Nexo" v={String(d.orgs.filter((o) => o.connected).length)} sub={`${c2(d.addonMonthlyCents)}/mês em adicionais`} />
      </div>
      {d.months.length > 0 && (
        <div className="flex h-28 items-end gap-2 rounded-lg bg-ink-900 p-3">
          {[...d.months].reverse().map((m) => (
            <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${monthName(m.month)}: ${c2(m.feeCents)} em ${m.sales} venda(s)`}>
              <div className="w-full rounded-t bg-emerald-500/70" style={{ height: `${Math.max(4, (m.feeCents / max) * 70)}px` }} />
              <span className="text-[10px] text-slate-500">{monthName(m.month)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-line bg-ink-900">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-slate-500"><tr>
            <th className="px-3 py-2 font-medium">Empresa</th><th className="px-3 py-2 text-right font-medium">Vendas pagas</th><th className="px-3 py-2 text-right font-medium">Vendido no Pix</th>
            <th className="px-3 py-2 text-right font-medium">Sua receita</th><th className="px-3 py-2 text-right font-medium">A confirmar</th><th className="px-3 py-2 font-medium">Última venda</th>
          </tr></thead>
          <tbody className="divide-y divide-line">
            {!d.orgs.length && <tr><td colSpan={6} className="p-6 text-center text-slate-500">Nenhuma loja com Pix Nexo ainda.</td></tr>}
            {d.orgs.map((o) => (
              <tr key={o.orgId}>
                <td className="px-3 py-2 text-slate-100">{o.name}{!o.connected && <span className="ml-2 text-[11px] text-slate-500">(desligado)</span>}{o.connected && o.accountStatus && o.accountStatus !== "approved" && <span className="ml-2 text-[11px] text-amber-300">(em aprovação)</span>}</td>
                <td className="px-3 py-2 text-right text-slate-300">{o.sales}</td>
                <td className="px-3 py-2 text-right text-slate-300">{formatBRL(o.salesValue)}</td>
                <td className="px-3 py-2 text-right font-medium text-emerald-300">{c2(o.feeCents)}</td>
                <td className="px-3 py-2 text-right text-amber-300">{o.pendingCents ? c2(o.pendingCents) : "—"}</td>
                <td className="px-3 py-2 text-xs text-slate-400">{o.lastAt ? relativeTime(o.lastAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <FeeModal fees={d.fees} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); void load(); }} />}
    </section>
  );
}

function Kpi({ l, v, sub, c }: { l: string; v: string; sub?: string; c?: string }) {
  return (
    <div className="rounded-lg border border-line bg-ink-900 p-3">
      <p className="text-xs text-slate-400">{l}</p>
      <p className={cn("mt-1 text-lg font-semibold text-white", c)}>{v}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

function FeeModal({ fees, onClose, onSaved }: { fees: Data["fees"]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ first: (fees.firstCents / 100).toFixed(2), after: (fees.afterCents / 100).toFixed(2), days: String(fees.firstDays), addon: (fees.addonCents / 100).toFixed(2) });
  const [busy, setBusy] = useState(false);
  const cents = (v: string) => Math.round((Number(v.replace(",", ".")) || 0) * 100);
  async function save() {
    setBusy(true);
    const r = await fetch("/api/platform/pix-revenue", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ firstCents: cents(f.first), afterCents: cents(f.after), firstDays: Math.round(Number(f.days) || 0), addonCents: cents(f.addon) }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return toast.error(j.error);
    toast.success("Preço atualizado (vale para as próximas cobranças e ativações)");
    onSaved();
  }
  return (
    <Modal open onClose={onClose} title="Preço do Pix Nexo">
      <div className="space-y-3" data-modal-body>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="No começo (R$)"><input className="field" inputMode="decimal" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} /></Field>
          <Field label="Por quantos dias"><input className="field" type="number" min={0} max={365} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></Field>
          <Field label="Depois (R$)"><input className="field" inputMode="decimal" value={f.after} onChange={(e) => setF({ ...f, after: e.target.value })} /></Field>
        </div>
        <Field label="Adicional na mensalidade (R$/mês)"><input className="field" inputMode="decimal" value={f.addon} onChange={(e) => setF({ ...f, addon: e.target.value })} /></Field>
        <p className="text-xs text-slate-500">O adicional vale para as próximas ativações. A taxa por venda é contada a partir do cadastro de cada loja. A taxa nunca passa da metade do valor da venda. Cobranças já enviadas não mudam.</p>
        <div className="flex justify-end"><Button onClick={() => void save()} loading={busy}>Salvar</Button></div>
      </div>
    </Modal>
  );
}
