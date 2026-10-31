"use client";
/* eslint-disable @next/next/no-img-element -- ícone do canal (arquivo da plataforma) */
import { useCallback, useEffect, useState } from "react";
import { Car, CheckCircle2, Copy, Globe, Link2, MessageCircle, RefreshCw, ShoppingBag, Unplug, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { relativeTime } from "@/lib/utils";

interface Data {
  inbound: { olx: string; webmotors: string; site: string; lastUsedAt: string | null; received: number };
  olx: { available: boolean; connected: boolean; webhookOk: boolean; error: string | null; connectedAt: string | null };
  instagram: {
    available: boolean;
    accounts: { id: string; name: string; ig_username: string | null; status: string; last_error: string | null }[];
    request: { username: string; status: "pending" | "invited" | "connected"; requested_at: string; invited_at: string | null } | null;
    queue: { orgId: string; org: string; username: string; status: "pending" | "invited"; requestedAt: string }[];
  };
  setup: { igWebhook: string; igVerifyToken: string; igRedirect: string; olxRedirect: string } | null;
}

const IG_MSG: Record<string, [ "success" | "error" | "message", string ]> = {
  ok: ["success", "Instagram conectado! As mensagens do Direct vão chegar em Conversas."],
  "sem-webhook": ["error", "Conta conectada, mas o Instagram não liberou o recebimento de mensagens. Confira se o app tem a permissão de mensagens aprovada."],
  "em-uso": ["error", "Esta conta do Instagram já está conectada em outra empresa."],
  "outra-conta": ["error", "O login voltou para outro usuário. Tente de novo."],
  cancelado: ["message", "Conexão com o Instagram cancelada."],
  erro: ["error", "Não foi possível conectar o Instagram."],
};
const OLX_MSG: Record<string, [ "success" | "error" | "message", string ]> = {
  ok: ["success", "OLX conectada! Os chats dos anúncios vão virar leads no funil."],
  "sem-webhook": ["error", "OLX conectada, mas ela recusou o cadastro do chat. Confira se a conta é profissional e tem a integração de chat liberada."],
  "outra-conta": ["error", "O login voltou para outro usuário. Tente de novo."],
  cancelado: ["message", "Conexão com a OLX cancelada."],
  erro: ["error", "Não foi possível conectar a OLX."],
};

const IG_ROLES_URL = "https://developers.facebook.com/apps/1145128041279591/roles/roles/";
const IG_INVITES_URL = "https://www.instagram.com/accounts/manage_access/";

/** Sem o acesso avançado da Meta, a loja pede a liberação pelo @ e aceita o convite antes de conectar. */
function IgSteps({ req, handle, setHandle, onRequest }: {
  req: Data["instagram"]["request"]; handle: string; setHandle: (v: string) => void; onRequest: () => void;
}) {
  const step = !req ? 1 : req.status === "pending" ? 2 : 3;
  return (
    <ol className="space-y-3 rounded-lg border border-line bg-ink-900 p-3 text-sm">
      <li className="space-y-2">
        <p className={step === 1 ? "font-medium text-white" : "text-slate-400"}>1. Informe o @ da conta do Instagram da loja</p>
        {(step === 1 || step === 2) && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (handle.trim()) onRequest(); }}>
            <input className="field flex-1" placeholder={req ? `@${req.username}` : "@sualoja"} value={handle} onChange={(e) => setHandle(e.target.value)} />
            <Button type="submit" disabled={!handle.trim()}>{req ? "Trocar @" : "Pedir liberação"}</Button>
          </form>
        )}
      </li>
      <li className={step === 2 ? "font-medium text-amber-200" : "text-slate-400"}>
        2. {step === 2 ? `Pedido recebido para @${req!.username}. Liberamos em até 24h e o status muda aqui.` : "A plataforma libera a conta (até 24h)."}
      </li>
      <li className="space-y-2">
        <p className={step === 3 ? "font-medium text-white" : "text-slate-400"}>3. Aceite o convite no Instagram e conecte</p>
        {step === 3 && (
          <div className="flex flex-wrap gap-2">
            <a href={IG_INVITES_URL} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm text-slate-200 hover:bg-ink-800">Abrir convites → aceitar “NEXO CRM-IG”</a>
            <a href="/api/instagram/connect" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-400"><MessageCircle className="h-4 w-4" /> Conectar Instagram</a>
          </div>
        )}
        {step === 3 && <p className="text-xs text-slate-500">No celular: Instagram → Configurações → Apps e sites → Convites de teste → Aceitar. Depois toque em Conectar Instagram.</p>}
      </li>
    </ol>
  );
}

async function copy(t: string) {
  try { await navigator.clipboard.writeText(t); toast.success("Copiado"); } catch { toast.message(t); }
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-400">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-ink-800 px-2 py-1.5 text-xs text-slate-300">{value}</code>
        <Button size="sm" variant="outline" onClick={() => void copy(value)}><Copy className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

/** Instagram Direct, OLX e Webmotors (e qualquer portal/site) na aba Integrações. */
export function PortalsCard() {
  const [d, setD] = useState<Data | null>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/integrations/portals");
    const j = await r.json();
    if (r.ok) setD(j); else toast.error(j.error);
  }, []);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ig = q.get("ig"), olx = q.get("olx");
    const t = setTimeout(() => {
      void load();
      const m = ig ? IG_MSG[ig] : olx ? OLX_MSG[olx] : null;
      const detail = q.get("igmsg");
      if (m) { toast[m[0]](m[1], { duration: 12000, description: detail ?? undefined }); window.history.replaceState(null, "", "/settings?tab=integrations"); }
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const [handle, setHandle] = useState("");
  async function act(action: string, channelId?: string, confirmText?: string, extra?: Record<string, string>) {
    if (confirmText && !confirm(confirmText)) return false;
    const r = await fetch("/api/integrations/portals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, channelId, ...extra }) });
    const j = await r.json();
    if (!r.ok) { toast.error(j.error); return false; }
    void load();
    return true;
  }

  if (!d) return <div className="card flex justify-center p-6"><Spinner /></div>;
  return (
    <div className="space-y-4">
      {/* Instagram */}
      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <img src="/channels/instagram.png" alt="" className="h-11 w-11 rounded-xl bg-white object-contain p-1.5" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-white">Instagram Direct</p>
            <p className="text-sm text-slate-400">As mensagens do Direct chegam em Conversas, viram lead (origem Instagram) e podem ser respondidas pelo CRM, pela IA e pelas automações.</p>
          </div>
          {d.instagram.available && (d.setup || d.instagram.accounts.length || d.instagram.request?.status === "invited" || d.instagram.request?.status === "connected") ? (
            <a href="/api/instagram/connect" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-400">
              <MessageCircle className="h-4 w-4" /> {d.instagram.accounts.length ? "Conectar outra conta" : "Conectar Instagram"}
            </a>
          ) : !d.instagram.available ? <span className="rounded-full bg-ink-800 px-3 py-1 text-xs text-slate-400">Em ativação pela plataforma</span> : null}
        </div>
        {d.instagram.available && !d.instagram.accounts.some((a) => a.status === "connected") && !d.setup && (
          <IgSteps req={d.instagram.request} handle={handle} setHandle={setHandle}
            onRequest={async () => { if (await act("ig_request", undefined, undefined, { username: handle })) { setHandle(""); toast.success("Pedido enviado! Avisamos aqui quando o convite chegar no seu Instagram."); } }} />
        )}
        {d.instagram.accounts.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-ink-900 px-3 py-2 text-sm">
            {a.status === "connected" && !a.last_error ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <XCircle className="h-4 w-4 text-amber-300" />}
            <span className="flex-1 text-slate-200">@{a.ig_username ?? a.name}{a.status !== "connected" ? " — desconectada" : ""}</span>
            {a.last_error && <span className="w-full text-xs text-amber-300">{a.last_error}</span>}
            {a.status === "connected" && <Button size="sm" variant="ghost" onClick={() => void act("ig_disconnect", a.id, `Desconectar @${a.ig_username}? As conversas ficam guardadas.`)}><Unplug className="h-3.5 w-3.5" /> Desconectar</Button>}
          </div>
        ))}
        <p className="text-xs text-slate-500">Precisa ser conta profissional (Empresa ou Criador). Pela regra do Instagram, você responde até 24h depois da última mensagem do cliente.</p>
      </section>

      {/* OLX */}
      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-ink-800 text-violet-300"><ShoppingBag className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-white">OLX</p>
            <p className="text-sm text-slate-400">Cada chat dos seus anúncios vira lead no funil (origem OLX), com a mensagem e o anúncio. Dá para responder o chat da OLX pelo lead.</p>
          </div>
          {d.olx.connected ? (
            <Button variant="outline" onClick={() => void act("olx_disconnect", undefined, "Desconectar a OLX? Os chats novos param de chegar.")}><Unplug className="h-4 w-4" /> Desconectar</Button>
          ) : d.olx.available ? (
            <a href="/api/olx/connect" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-400"><Link2 className="h-4 w-4" /> Conectar OLX</a>
          ) : <span className="rounded-full bg-ink-800 px-3 py-1 text-xs text-slate-400">Em ativação pela plataforma</span>}
        </div>
        {d.olx.connected && (
          <p className={d.olx.webhookOk ? "text-sm text-emerald-300" : "text-sm text-amber-300"}>
            {d.olx.webhookOk ? `Conectada${d.olx.connectedAt ? ` ${relativeTime(d.olx.connectedAt)}` : ""} — chats chegando no CRM.` : d.olx.error ?? "A OLX não liberou o chat para esta conta."}
          </p>
        )}
      </section>

      {/* Webmotors e outros */}
      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-ink-800 text-red-300"><Car className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-white">Webmotors, site e outros portais</p>
            <p className="text-sm text-slate-400">Endereços que recebem leads e colocam no funil com a origem certa. Funciona com a Webmotors (pelo Cockpit), seu site, Make, Zapier ou qualquer sistema que envie o lead.</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void act("rotate", undefined, "Gerar endereços novos? Os atuais param de funcionar.")} title="Gerar endereços novos"><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
        <CopyRow label="Webmotors" value={d.inbound.webmotors} />
        <CopyRow label="OLX (sem conectar a conta)" value={d.inbound.olx} />
        <CopyRow label="Site / Make / Zapier" value={d.inbound.site} />
        <p className="text-xs text-slate-500">
          {d.inbound.received ? `${d.inbound.received} lead(s) recebido(s) · último ${relativeTime(d.inbound.lastUsedAt)}. ` : "Nenhum lead recebido ainda. "}
          Envie um POST com JSON: <code>nome</code>, <code>telefone</code>, <code>email</code>, <code>mensagem</code>, <code>anuncio</code>. Lead com o mesmo telefone não é duplicado.
        </p>
        <details className="rounded-lg bg-ink-900 p-3 text-xs text-slate-400">
          <summary className="cursor-pointer text-slate-300">Como ligar a Webmotors</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>No Cockpit da Webmotors, peça ao seu consultor a <b>integração de leads com CRM</b> e informe o endereço “Webmotors” acima.</li>
            <li>Se a Webmotors só mandar por e-mail, use um robô de e-mail (Make ou Zapier: “e-mail recebido → enviar webhook”) apontando para o mesmo endereço.</li>
            <li>Cada lead entra no primeiro estágio do funil com origem “Webmotors” e a mensagem no histórico.</li>
          </ol>
        </details>
      </section>

      {d.setup && (
        <section className="card space-y-3 border-amber-500/30 p-5">
          <p className="flex items-center gap-2 font-medium text-amber-200"><Globe className="h-4 w-4" /> Configuração da plataforma (só você vê)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <CopyRow label="Instagram — URL do webhook" value={d.setup.igWebhook} />
            <CopyRow label="Instagram — token de verificação" value={d.setup.igVerifyToken} />
            <CopyRow label="Instagram — URI de redirecionamento" value={d.setup.igRedirect} />
            <CopyRow label="OLX — URI de redirecionamento" value={d.setup.olxRedirect} />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-white">Lojas pedindo o Instagram ({d.instagram.queue.length})</p>
            {d.instagram.queue.length === 0 && <p className="text-xs text-slate-500">Nenhum pedido no momento.</p>}
            {d.instagram.queue.map((q) => (
              <div key={q.orgId} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-ink-900 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 text-slate-200">@{q.username} <span className="text-xs text-slate-500">· {q.org} · {relativeTime(q.requestedAt)}</span></span>
                {q.status === "invited" ? <span className="text-xs text-emerald-300">Convidada — falta a loja aceitar</span> : (
                  <>
                    <Button size="sm" variant="outline" onClick={() => void copy(q.username)}><Copy className="h-3.5 w-3.5" /> Copiar @</Button>
                    <a href={IG_ROLES_URL} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-lg border border-line px-3 text-xs text-slate-200 hover:bg-ink-800">Abrir Meta</a>
                    <Button size="sm" onClick={() => void act("ig_invited", undefined, undefined, { orgId: q.orgId })}>Já convidei</Button>
                  </>
                )}
              </div>
            ))}
            <p className="text-xs text-slate-500">Na Meta: Funções do aplicativo → Funções → Adicionar pessoas → Testador do Instagram → cole o @.</p>
          </div>
          <p className="text-xs text-slate-500">Instagram: {d.instagram.available ? "ativo" : "falta INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET na Vercel"} · OLX: {d.olx.available ? "ativo" : "falta OLX_CLIENT_ID e OLX_CLIENT_SECRET na Vercel"}.</p>
        </section>
      )}
    </div>
  );
}
