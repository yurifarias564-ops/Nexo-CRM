"use client";
/* eslint-disable @next/next/no-img-element -- miniaturas vêm do CDN do Meta (URLs assinadas e temporárias) */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, ExternalLink, KeyRound, MessageCircle, RefreshCw, Settings2, Trophy, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Modal, Spinner } from "@/components/ui/misc";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn, formatBRL, relativeTime } from "@/lib/utils";
import { loadSdk } from "@/components/settings/embedded-signup";
import { META_ADS_CONFIG_ID } from "@/lib/meta-public";

interface Conn { ad_account_id: string | null; ad_account_name: string | null; currency: string; pixel_id: string | null; page_id: string | null; send_purchase: boolean; send_lead: boolean; last_sync_at: string | null; last_error: string | null }
interface ConnState { conn: Conn | null; hasCred: boolean; credHint: string | null; waba: boolean }
interface AdRow { ad_id: string; name: string; status: string | null; campaign: string | null; adset: string | null; thumbnail: string | null; spend: number; impressions: number; reach: number; clicks: number; link_clicks: number; conversations: number; leads: number; sales: number; revenue: number }
interface Totals { spend: number; impressions: number; clicks: number; conversations: number; leads: number; sales: number; revenue: number }
interface AdLead { id: string; name: string; phone: string | null; value: number; stage: string | null; won: boolean; created_at: string; conversation_id: string | null; last_message_preview: string | null }
interface MetaEvent { id: number; event_name: string; value: number | null; status: string; mode: string | null; error: string | null; created_at: string; sent_at: string | null; leads: { name: string } | null }

const PERIODS = [{ d: 0, l: "Hoje" }, { d: 7, l: "7 dias" }, { d: 30, l: "30 dias" }, { d: 90, l: "90 dias" }] as const;
const STATUS: Record<string, { l: string; c: string }> = {
  ACTIVE: { l: "Ativo", c: "bg-emerald-500/15 text-emerald-300" }, PAUSED: { l: "Pausado", c: "bg-slate-500/20 text-slate-300" },
  CAMPAIGN_PAUSED: { l: "Campanha pausada", c: "bg-slate-500/20 text-slate-300" }, ADSET_PAUSED: { l: "Conjunto pausado", c: "bg-slate-500/20 text-slate-300" },
  IN_PROCESS: { l: "Em análise", c: "bg-amber-500/15 text-amber-300" }, PENDING_REVIEW: { l: "Em análise", c: "bg-amber-500/15 text-amber-300" },
  DISAPPROVED: { l: "Reprovado", c: "bg-red-500/15 text-red-300" }, WITH_ISSUES: { l: "Com problema", c: "bg-red-500/15 text-red-300" },
  ARCHIVED: { l: "Arquivado", c: "bg-slate-600/20 text-slate-500" }, DELETED: { l: "Excluído", c: "bg-slate-600/20 text-slate-500" },
};
const div = (a: number, b: number) => (b ? a / b : 0);
const money = (v: number) => (v ? formatBRL(v) : "—");
const roas = (r: { revenue: number; spend: number }) => (r.spend ? `${(r.revenue / r.spend).toFixed(2).replace(".", ",")}x` : "—");
const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function MetaTab() {
  const [st, setSt] = useState<ConnState | null>(null);
  const [settings, setSettings] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch("/api/meta/connection");
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    setSt(data);
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  if (!st) return <div className="flex justify-center py-16"><Spinner /></div>;
  const connected = Boolean(st.conn?.ad_account_id && st.hasCred);
  if (!connected) return <QuickConnect st={st} onDone={() => void load()} />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-[#1877F2]/15 px-3 py-1 text-xs font-medium text-[#8ab4ff]">Meta Ads · {st.conn!.ad_account_name ?? st.conn!.ad_account_id}</span>
        {st.conn!.pixel_id && st.conn!.send_purchase ? <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300"><Zap className="mr-1 inline h-3 w-3" />Vendas indo para o pixel automaticamente</span> : <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs text-amber-300">Envio de vendas ao pixel desligado</span>}
        {st.conn!.last_error && <span className="rounded-full bg-red-500/15 px-3 py-1 text-xs text-red-300" title={st.conn!.last_error}>Erro na última atualização</span>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSettings(true)}><Settings2 className="h-4 w-4" /> Conexão</Button>
      </div>
      <AdsBoard lastSync={st.conn!.last_sync_at} onSynced={() => void load()} />
      <EventsLog />
      {settings && (
        <Modal open onClose={() => setSettings(false)} title="Conexão com o Meta" wide>
          <ChooseAssets st={st} onSaved={() => { setSettings(false); void load(); }} />
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------

/** Aviso na tela do WhatsApp: depois de conectar o número, liga os anúncios em 1 clique. */
export function AdsConnectBanner() {
  const [st, setSt] = useState<ConnState | null>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/meta/connection");
    if (r.ok) setSt(await r.json());
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  if (!st) return null;
  if (st.conn?.ad_account_id && st.hasCred) {
    return (
      <a href="/campanhas" className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-500/10">
        <Zap className="h-4 w-4" /> Anúncios ligados: {st.conn.ad_account_name ?? st.conn.ad_account_id}{st.conn.pixel_id && st.conn.send_purchase ? " · vendas indo para o pixel" : ""} <span className="ml-auto text-xs">Ver métricas →</span>
      </a>
    );
  }
  return <div className="mt-3"><QuickConnect st={st} onDone={() => void load()} compact /></div>;
}

/** Botão único: entra com o Facebook e o CRM descobre conta de anúncios, pixel e página sozinho. */
function QuickConnect({ st, onDone, compact }: { st: ConnState; onDone: () => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(!META_ADS_CONFIG_ID);

  async function connect() {
    setBusy(true);
    try {
      const FB = await loadSdk();
      const code = await new Promise<string>((resolve, reject) => {
        FB.login((r) => (r.authResponse?.code ? resolve(r.authResponse.code) : reject(new Error("Conexão cancelada."))),
          { config_id: META_ADS_CONFIG_ID, response_type: "code", override_default_response_type: true });
      });
      const res = await fetch("/api/meta/oauth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const s = data.synced as { ads?: number; error?: string };
      toast.success(`Conectado à conta “${data.account.name}”`, {
        description: [data.pixel ? `Pixel: ${data.pixel.name} — vendas indo automaticamente` : "Nenhum pixel encontrado nessa conta", s?.ads !== undefined ? `${s.ads} anúncios carregados` : s?.error].filter(Boolean).join(" · "),
        duration: 8000,
      });
      onDone();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#1877F2]/40 bg-gradient-to-br from-[#1877F2]/15 to-transparent p-6">
        <h3 className="text-lg font-semibold text-white">{compact ? "Agora ligue seus anúncios a este número" : "Ligue seus anúncios em 1 clique"}</h3>
        <p className="mt-1 max-w-2xl text-sm text-slate-300">Entre com o Facebook da empresa e pronto: o CRM encontra sozinho a conta de anúncios, o pixel e a página, puxa investimento, cliques e conversas de cada anúncio, cruza com os leads e as vendas — e passa a enviar cada venda ao pixel para o Meta trazer mais compradores com esse perfil.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {META_ADS_CONFIG_ID
            ? <Button onClick={() => void connect()} loading={busy} className="bg-[#1877F2] hover:bg-[#2d86f5]">Conectar com o Facebook</Button>
            : <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">O botão de 1 clique ainda não foi ativado no servidor (falta o ID da configuração de anúncios do app da Meta). Enquanto isso, use a conexão manual abaixo.</p>}
          <button onClick={() => setManual((v) => !v)} className="text-xs text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline">{manual ? "Esconder conexão manual" : "Prefiro colar uma chave de acesso"}</button>
        </div>
        <ul className="mt-4 grid gap-1 text-xs text-slate-400 sm:grid-cols-3">
          <li>✓ Sem copiar IDs nem chaves</li><li>✓ Atualiza sozinho a cada hora</li><li>✓ Vendas vão para o pixel automaticamente</li>
        </ul>
      </div>
      {manual && !compact && <ConnectForm st={st} onSaved={onDone} />}
      {manual && compact && <a href="/campanhas" className="text-xs text-brand-300">Abrir a conexão manual em Campanhas →</a>}
    </div>
  );
}

/** Depois de conectado: trocar conta de anúncios, pixel, página e o que enviar. */
function ChooseAssets({ st, onSaved }: { st: ConnState; onSaved: () => void }) {
  const c = st.conn!;
  const [assets, setAssets] = useState<{ accounts: { id: string; name: string; status: number; pixels: { id: string; name: string }[] }[]; pages: { id: string; name: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ ad_account_id: c.ad_account_id ?? "", pixel_id: c.pixel_id ?? "", page_id: c.page_id ?? "", send_purchase: c.send_purchase, send_lead: c.send_lead });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void fetch("/api/meta/assets").then(async (r) => { const d = await r.json(); if (r.ok) setAssets(d); else setErr(d.error); });
  }, []);
  const acc = assets?.accounts.find((a) => a.id === f.ad_account_id);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/meta/connection", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Conexão atualizada"); onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function disconnect() {
    if (!confirm("Desconectar o Meta? Para de enviar vendas ao pixel e de atualizar os anúncios. Os números já carregados continuam.")) return;
    const res = await fetch("/api/meta/connection", { method: "DELETE" });
    if (res.ok) { toast.success("Desconectado"); onSaved(); }
  }

  if (err) return <div className="space-y-3 text-sm"><p className="text-red-300">{err}</p><ConnectForm st={st} embedded onSaved={onSaved} /></div>;
  if (!assets) return <div className="flex justify-center py-8"><Spinner /></div>;
  return (
    <div className="space-y-3 text-sm" data-modal-body>
      <Field label="Conta de anúncios">
        <select className="field" value={f.ad_account_id} onChange={(e) => { const a = assets.accounts.find((x) => x.id === e.target.value); setF({ ...f, ad_account_id: e.target.value, pixel_id: a?.pixels[0]?.id ?? "" }); }}>
          {assets.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.status !== 1 ? " (inativa)" : ""}</option>)}
        </select>
      </Field>
      <Field label="Pixel que recebe as vendas">
        <select className="field" value={f.pixel_id} onChange={(e) => setF({ ...f, pixel_id: e.target.value })}>
          <option value="">Nenhum (não enviar eventos)</option>
          {(acc?.pixels ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <Field label="Página do Facebook (anúncios de clique para o WhatsApp)">
        <select className="field" value={f.page_id} onChange={(e) => setF({ ...f, page_id: e.target.value })}>
          <option value="">Nenhuma</option>
          {assets.pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <label className="flex items-center gap-2 text-slate-200"><input type="checkbox" checked={f.send_purchase} onChange={(e) => setF({ ...f, send_purchase: e.target.checked })} /> Enviar cada venda ao pixel (Compra)</label>
      <label className="flex items-center gap-2 text-slate-200"><input type="checkbox" checked={f.send_lead} onChange={(e) => setF({ ...f, send_lead: e.target.checked })} /> Enviar cada lead de anúncio (Lead)</label>
      <div className="flex flex-wrap gap-2 pt-2">
        <Button onClick={() => void save()} loading={busy}>Salvar</Button>
        <Button variant="danger" onClick={() => void disconnect()}>Desconectar</Button>
      </div>
    </div>
  );
}

function ConnectForm({ st, onSaved, embedded }: { st: ConnState; onSaved: () => void; embedded?: boolean }) {
  const c = st.conn;
  const [f, setF] = useState({ ad_account_id: c?.ad_account_id?.replace("act_", "") ?? "", pixel_id: c?.pixel_id ?? "", page_id: c?.page_id ?? "", send_purchase: c?.send_purchase ?? true, send_lead: c?.send_lead ?? true, credential: "" });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/meta/connection", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const s = data.synced as { ads?: number; error?: string } | null;
      toast.success(`Conectado${data.info?.account ? ` à conta “${data.info.account.name}”` : ""}`, { description: s?.error ? `Anúncios: ${s.error}` : s?.ads !== undefined ? `${s.ads} anúncios carregados` : undefined });
      onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function disconnect() {
    if (!confirm("Desconectar o Meta? Para de enviar vendas ao pixel e de atualizar os anúncios. Os números já carregados continuam.")) return;
    const res = await fetch("/api/meta/connection", { method: "DELETE" });
    if (res.ok) { toast.success("Desconectado"); onSaved(); }
  }

  return (
    <div className={cn("space-y-4", !embedded && "rounded-xl border border-line bg-ink-900 p-5")}>
      {!embedded && (
        <div>
          <h3 className="text-lg font-semibold text-white">Conecte o Meta Ads</h3>
          <p className="mt-1 text-sm text-slate-400">Veja os anúncios rodando com investimento, cliques, conversas, leads e vendas de cada um — e envie cada venda para o pixel, para o Meta buscar mais clientes com o perfil de quem compra.</p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ID da conta de anúncios" hint="Gerenciador de Anúncios → menu da conta (só os números).">
          <input className="field" name="meta_ad_account" autoComplete="off" inputMode="numeric" placeholder="123456789012345" value={f.ad_account_id} onChange={(e) => setF({ ...f, ad_account_id: e.target.value })} />
        </Field>
        <Field label="ID do pixel (conjunto de dados)" hint="Gerenciador de Eventos → seu pixel → ID.">
          <input className="field" name="meta_pixel" autoComplete="off" inputMode="numeric" placeholder="987654321098765" value={f.pixel_id} onChange={(e) => setF({ ...f, pixel_id: e.target.value })} />
        </Field>
        <Field label="ID da página do Facebook (opcional)" hint="Melhora o envio das vendas que vieram de anúncio de clique para o WhatsApp.">
          <input className="field" name="meta_page" autoComplete="off" inputMode="numeric" placeholder="Opcional" value={f.page_id} onChange={(e) => setF({ ...f, page_id: e.target.value })} />
        </Field>
        <Field label="Chave de acesso do Business Manager" hint={st.hasCred ? `Já cadastrada (${st.credHint}). Cole outra só para trocar.` : "Usuário do sistema com acesso à conta de anúncios e ao pixel."}>
          <input className="field" type="password" name="meta_business_key" autoComplete="new-password" data-lpignore="true" data-1p-ignore placeholder={st.hasCred ? "••••••••" : "Cole a chave aqui"} value={f.credential} onChange={(e) => setF({ ...f, credential: e.target.value })} />
        </Field>
      </div>
      <div className="space-y-2 rounded-lg border border-line bg-ink-850 p-3 text-sm">
        <label className="flex items-start gap-2 text-slate-200"><input type="checkbox" className="mt-1" checked={f.send_purchase} onChange={(e) => setF({ ...f, send_purchase: e.target.checked })} />
          <span><b>Enviar cada venda ao pixel (Compra)</b> <span className="block text-xs text-slate-500">Quando o lead vai para a etapa de ganho com valor, o CRM envia o evento Compra com o valor, o telefone e o nome (criptografados). O Meta usa isso para achar mais compradores parecidos.</span></span></label>
        <label className="flex items-start gap-2 text-slate-200"><input type="checkbox" className="mt-1" checked={f.send_lead} onChange={(e) => setF({ ...f, send_lead: e.target.checked })} />
          <span><b>Enviar cada lead de anúncio (Lead)</b> <span className="block text-xs text-slate-500">Quando um cliente chega por anúncio ou link rastreado.</span></span></label>
        {!st.waba && <p className="text-xs text-slate-500">Dica: com o número na API oficial do WhatsApp, as vendas de anúncios de clique para o WhatsApp são ligadas ao anúncio exato.</p>}
      </div>
      <details className="rounded-lg border border-line p-3 text-sm text-slate-300">
        <summary className="cursor-pointer font-medium text-slate-200">Como gerar a chave de acesso (5 minutos)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-400">
          <li>Abra <a className="text-brand-300" href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener noreferrer">Business Manager → Usuários do sistema</a> e crie um usuário (função Administrador).</li>
          <li>Em <b>Atribuir ativos</b>, dê acesso total à <b>conta de anúncios</b> e ao <b>pixel</b>.</li>
          <li>Clique em <b>Gerar novo token</b>, escolha o app, validade <b>Nunca</b> e marque <code>ads_read</code>, <code>ads_management</code> e <code>business_management</code>.</li>
          <li>Copie a chave e cole no campo acima. Ela fica guardada só no servidor e nunca aparece de novo.</li>
        </ol>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} loading={busy} disabled={!f.ad_account_id.trim() || (!st.hasCred && !f.credential.trim())}>{st.hasCred ? "Salvar" : "Conectar"}</Button>
        {embedded && st.hasCred && <Button variant="danger" onClick={() => void disconnect()}>Desconectar</Button>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------

function AdsBoard({ lastSync, onSynced }: { lastSync: string | null; onSynced: () => void }) {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<{ rows: AdRow[]; totals: Totals } | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [onlyActive, setOnlyActive] = useState(false);
  const [sort, setSort] = useState<"revenue" | "roas" | "spend" | "leads" | "cpl">("revenue");
  const [open, setOpen] = useState<AdRow | null>(null);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    const now = new Date();
    const from = new Date(now); from.setHours(0, 0, 0, 0); if (d) from.setDate(from.getDate() - d + 1);
    const qs = new URLSearchParams({ from: from.toISOString(), to: new Date(now.getTime() + 60_000).toISOString(), fromDay: ymdLocal(from), toDay: ymdLocal(now) });
    const res = await fetch(`/api/meta/ads?${qs}`);
    const body = await res.json();
    setLoading(false);
    if (!res.ok) { toast.error(body.error); return; }
    setData(body);
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(days), 0); return () => clearTimeout(t); }, [load, days]);

  async function sync() {
    setSyncing(true);
    try {
      const res = await fetch(`/api/meta/sync?days=${Math.max(days, 1)}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      toast.success(`Atualizado: ${body.ads} anúncios`);
      onSynced(); await load(days);
    } catch (e) { toast.error((e as Error).message); } finally { setSyncing(false); }
  }

  const rows = useMemo(() => {
    const list = (data?.rows ?? []).filter((r) => !onlyActive || r.status === "ACTIVE");
    const key = (r: AdRow) => sort === "roas" ? div(r.revenue, r.spend) : sort === "cpl" ? (r.leads ? -div(r.spend, r.leads) : -1e12) : r[sort];
    return [...list].sort((a, b) => key(b) - key(a));
  }, [data, onlyActive, sort]);
  const t = data?.totals;
  const best = useMemo(() => {
    const list = data?.rows ?? [];
    const top = (f: (r: AdRow) => number, ok: (r: AdRow) => boolean) => list.filter(ok).sort((a, b) => f(b) - f(a))[0] ?? null;
    return {
      roas: top((r) => div(r.revenue, r.spend), (r) => r.spend > 0 && r.revenue > 0),
      sales: top((r) => r.sales * 1e9 + r.revenue, (r) => r.sales > 0),
      cpl: top((r) => -div(r.spend, r.leads), (r) => r.leads > 0 && r.spend > 0),
    };
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5">
        {PERIODS.map((p) => (
          <button key={p.d} onClick={() => setDays(p.d)} className={cn("rounded-full border px-3 py-1 text-xs", days === p.d ? "border-brand-400/50 bg-brand-500/15 text-brand-100" : "border-line text-slate-400 hover:text-slate-200")}>{p.l}</button>
        ))}
        {loading && <Spinner className="ml-2 h-4 w-4" />}
        <span className="ml-auto text-xs text-slate-500">{lastSync ? `Atualizado ${relativeTime(lastSync)}` : "Ainda não atualizado"}</span>
        <Button size="sm" variant="outline" onClick={() => void sync()} loading={syncing}><RefreshCw className="h-3.5 w-3.5" /> Atualizar do Meta</Button>
      </div>

      {!data ? <div className="flex justify-center py-16"><Spinner /></div> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <K label="Investimento" v={formatBRL(t!.spend)} />
            <K label="Cliques no link" v={t!.clicks.toLocaleString("pt-BR")} s={`CPC ${money(div(t!.spend, t!.clicks))}`} />
            <K label="Conversas iniciadas" v={t!.conversations.toLocaleString("pt-BR")} s={`custo ${money(div(t!.spend, t!.conversations))}`} />
            <K label="Leads no CRM" v={t!.leads.toLocaleString("pt-BR")} s={`CPL ${money(div(t!.spend, t!.leads))}`} />
            <K label="Vendas" v={t!.sales.toLocaleString("pt-BR")} s={`custo/venda ${money(div(t!.spend, t!.sales))}`} />
            <K label="Faturamento" v={formatBRL(t!.revenue)} />
            <K label="ROAS" v={roas(t!)} s="faturamento ÷ investimento" hi />
            <K label="Ticket médio" v={money(div(t!.revenue, t!.sales))} />
            <K label="Conversão lead → venda" v={t!.leads ? `${((t!.sales / t!.leads) * 100).toFixed(1).replace(".", ",")}%` : "—"} />
            <K label="Impressões" v={t!.impressions.toLocaleString("pt-BR")} />
          </div>

          {(best.roas || best.sales || best.cpl) && (
            <div className="grid gap-3 md:grid-cols-3">
              {best.roas && <Best icon={Crown} title="Melhor ROAS" ad={best.roas} metric={roas(best.roas)} onOpen={setOpen} />}
              {best.sales && <Best icon={Trophy} title="Mais vendas" ad={best.sales} metric={`${best.sales.sales} vendas · ${formatBRL(best.sales.revenue)}`} onOpen={setOpen} />}
              {best.cpl && <Best icon={Zap} title="Menor custo por lead" ad={best.cpl} metric={money(div(best.cpl.spend, best.cpl.leads))} onOpen={setOpen} />}
            </div>
          )}

          <section className="rounded-xl border border-line bg-ink-900">
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 text-xs">
              <h3 className="mr-auto text-sm font-semibold text-white">Anúncios</h3>
              <label className="flex items-center gap-1.5 text-slate-300"><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> Só os que estão rodando</label>
              <select className="field h-8 w-auto py-0 text-xs" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                <option value="revenue">Ordenar: faturamento</option><option value="roas">ROAS</option><option value="spend">Investimento</option><option value="leads">Leads</option><option value="cpl">Menor custo por lead</option>
              </select>
            </div>
            {!rows.length ? <p className="p-6 text-center text-sm text-slate-500">Nenhum anúncio com números no período. Toque em “Atualizar do Meta”.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Anúncio</th><th className="px-3 py-2 text-right font-medium">Investido</th><th className="px-3 py-2 text-right font-medium">Cliques</th>
                      <th className="px-3 py-2 text-right font-medium">Conversas</th><th className="px-3 py-2 text-right font-medium">Leads</th><th className="px-3 py-2 text-right font-medium">CPL</th>
                      <th className="px-3 py-2 text-right font-medium">Vendas</th><th className="px-3 py-2 text-right font-medium">Faturamento</th><th className="px-3 py-2 text-right font-medium">ROAS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((r) => (
                      <tr key={r.ad_id} onClick={() => setOpen(r)} className="cursor-pointer text-slate-300 hover:bg-ink-850">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2.5">
                            {r.thumbnail ? <img src={r.thumbnail} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" referrerPolicy="no-referrer" /> : <span className="h-10 w-10 shrink-0 rounded-md bg-ink-700" />}
                            <div className="min-w-0">
                              <p className="max-w-[280px] truncate font-medium text-slate-100" title={r.name}>{r.name}</p>
                              <p className="max-w-[280px] truncate text-[11px] text-slate-500">{[r.campaign, r.adset].filter(Boolean).join(" › ")}</p>
                              {r.status && <span className={cn("mt-0.5 inline-block rounded px-1.5 py-px text-[10px]", STATUS[r.status]?.c ?? "bg-ink-700 text-slate-400")}>{STATUS[r.status]?.l ?? r.status}</span>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">{money(r.spend)}</td>
                        <td className="px-3 py-2 text-right">{r.link_clicks || "—"}</td>
                        <td className="px-3 py-2 text-right">{r.conversations || "—"}</td>
                        <td className="px-3 py-2 text-right text-slate-100">{r.leads || "—"}</td>
                        <td className="px-3 py-2 text-right">{money(div(r.spend, r.leads))}</td>
                        <td className="px-3 py-2 text-right text-emerald-300">{r.sales || "—"}</td>
                        <td className="px-3 py-2 text-right font-medium text-white">{money(r.revenue)}</td>
                        <td className={cn("px-3 py-2 text-right font-semibold", r.spend && r.revenue / r.spend >= 1 ? "text-emerald-300" : "text-slate-400")}>{roas(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {open && <AdLeads ad={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function K({ label, v, s, hi }: { label: string; v: string; s?: string; hi?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-ink-900 p-3", hi ? "border-emerald-500/40" : "border-line")}>
      <p className="text-xs text-slate-400">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tracking-tight", hi ? "text-emerald-300" : "text-white")}>{v}</p>
      {s && <p className="text-[11px] text-slate-500">{s}</p>}
    </div>
  );
}

function Best({ icon: I, title, ad, metric, onOpen }: { icon: typeof Crown; title: string; ad: AdRow; metric: string; onOpen: (a: AdRow) => void }) {
  return (
    <button onClick={() => onOpen(ad)} className="flex items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-500/5 p-3 text-left hover:bg-amber-500/10">
      {ad.thumbnail ? <img src={ad.thumbnail} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" referrerPolicy="no-referrer" /> : <I className="h-8 w-8 shrink-0 text-amber-300" />}
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-amber-300"><I className="h-3 w-3" /> {title}</span>
        <span className="block truncate text-sm font-medium text-white">{ad.name}</span>
        <span className="block text-xs text-slate-300">{metric}</span>
      </span>
    </button>
  );
}

function AdLeads({ ad, onClose }: { ad: AdRow; onClose: () => void }) {
  const [leads, setLeads] = useState<AdLead[] | null>(null);
  useEffect(() => {
    void fetch(`/api/meta/ads/${ad.ad_id}/leads`).then(async (r) => {
      const d = await r.json();
      if (!r.ok) { toast.error(d.error); setLeads([]); return; }
      setLeads(d.leads);
    });
  }, [ad.ad_id]);
  return (
    <Modal open onClose={onClose} title={ad.name} wide>
      <div className="space-y-4 text-sm" data-modal-body>
        <div className="flex gap-3">
          {ad.thumbnail && <img src={ad.thumbnail} alt="" className="h-16 w-16 rounded-lg object-cover" referrerPolicy="no-referrer" />}
          <div className="grid flex-1 grid-cols-3 gap-2 sm:grid-cols-6">
            {[["Investido", money(ad.spend)], ["Cliques", String(ad.link_clicks)], ["Conversas", String(ad.conversations)], ["Leads", String(ad.leads)], ["Vendas", String(ad.sales)], ["ROAS", roas(ad)]].map(([l, v]) => (
              <div key={l} className="rounded-lg bg-ink-850 p-2"><p className="text-[10px] uppercase text-slate-500">{l}</p><p className="font-semibold text-white">{v}</p></div>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-500">{[ad.campaign, ad.adset].filter(Boolean).join(" › ")}</p>
        <h4 className="font-semibold text-white">Leads que vieram deste anúncio</h4>
        {leads === null ? <div className="flex justify-center py-6"><Spinner /></div> : !leads.length ? <p className="text-slate-500">Nenhum lead ligado a este anúncio ainda.</p> : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {leads.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-slate-100">{l.name}{l.won && <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">venda {l.value ? formatBRL(l.value) : ""}</span>}</p>
                  <p className="truncate text-xs text-slate-500">{l.stage ?? "—"} · chegou {relativeTime(l.created_at)}{l.last_message_preview ? ` · “${l.last_message_preview}”` : ""}</p>
                </div>
                {l.conversation_id && <a href={`/inbox?c=${l.conversation_id}`} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs text-slate-200 hover:border-brand-400/50"><MessageCircle className="h-3.5 w-3.5" /> Ver conversa</a>}
              </li>
            ))}
          </ul>
        )}
        <a href={`https://www.facebook.com/adsmanager/manage/ads?selected_ad_ids=${ad.ad_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-300 hover:text-brand-200">Abrir no Gerenciador de Anúncios <ExternalLink className="h-3 w-3" /></a>
      </div>
    </Modal>
  );
}

function EventsLog() {
  const [ev, setEv] = useState<MetaEvent[] | null>(null);
  useEffect(() => {
    void supabaseBrowser().from("meta_events").select("id, event_name, value, status, mode, error, created_at, sent_at, leads(name)").order("created_at", { ascending: false }).limit(30)
      .then(({ data }) => setEv((data ?? []) as unknown as MetaEvent[]));
  }, []);
  if (!ev) return null;
  return (
    <section className="rounded-xl border border-line bg-ink-900">
      <h3 className="flex items-center gap-2 border-b border-line p-3 text-sm font-semibold text-white"><KeyRound className="h-4 w-4 text-brand-300" /> Eventos enviados ao pixel</h3>
      {!ev.length ? <p className="p-4 text-sm text-slate-500">Nenhum evento ainda. Quando um lead for para a etapa de ganho com valor, a Compra aparece aqui.</p> : (
        <ul className="divide-y divide-line text-sm">
          {ev.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2">
              <span className={cn("rounded-full px-2 py-0.5 text-[11px]", e.event_name === "Purchase" ? "bg-emerald-500/15 text-emerald-300" : "bg-brand-500/15 text-brand-200")}>{e.event_name === "Purchase" ? "Compra" : "Lead"}</span>
              <span className="min-w-0 flex-1 truncate text-slate-200">{e.leads?.name ?? "—"}{e.value ? ` · ${formatBRL(e.value)}` : ""}</span>
              <span className={cn("text-xs", e.status === "sent" ? "text-emerald-300" : e.status === "pending" ? "text-amber-300" : "text-red-300")} title={e.error ?? undefined}>
                {e.status === "sent" ? `✓ enviado${e.mode === "pixel" ? "" : " (WhatsApp)"}` : e.status === "pending" ? "na fila" : e.status === "skipped" ? "não enviado" : "falhou"}
              </span>
              <span className="w-20 text-right text-[11px] text-slate-500">{relativeTime(e.sent_at ?? e.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
