"use client";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Headphones, Phone, Plus, Unplug, X } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Field, Modal, Spinner } from "@/components/ui/misc";
import { useVoip } from "@/components/calls/voip-provider";

interface Settings { domain: string | null; connected_at: string }
interface Ext { user_id: string; ramal: string }

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Erro");
  return data;
}

/** Telefonia VoIP (Api4Com): ligação comum para o celular do lead, gravada. */
export function TelephonyCard() {
  const ws = useWorkspace();
  const voip = useVoip();
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [exts, setExts] = useState<Ext[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [token, setToken] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [link, setLink] = useState({ ramal: "", pass: "" });

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [{ data: s }, { data: e }] = await Promise.all([
      sb.from("voip_settings").select("domain, connected_at").eq("organization_id", ws.orgId).maybeSingle(),
      sb.from("voip_extensions").select("user_id, ramal").eq("organization_id", ws.orgId),
    ]);
    setSettings((s as Settings | null) ?? null);
    setExts((e ?? []) as Ext[]);
  }, [ws.orgId]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  async function connect() {
    setBusy("connect");
    try {
      await send("/api/voip", "PUT", { token: token.trim(), domain: domain.trim() || null });
      toast.success("Central conectada! Agora dê um ramal para cada pessoa que vai ligar.");
      setConnectOpen(false); setToken("");
      await load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }
  async function disconnect() {
    if (!confirm("Desconectar a telefonia? As ligações gravadas continuam salvas no CRM.")) return;
    setBusy("disconnect");
    try { await send("/api/voip", "DELETE"); toast.success("Telefonia desconectada"); await load(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }
  async function createExt(userId: string) {
    setBusy(userId);
    try { const r = await send("/api/voip/extensions", "POST", { userId }); toast.success(`Ramal ${r.ramal} criado. A pessoa recarrega a página e o botão Ligar aparece.`); await load(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }
  async function linkExt() {
    if (!linkFor) return;
    setBusy("link");
    try { await send("/api/voip/extensions", "POST", { userId: linkFor, ramal: link.ramal.trim(), sipPass: link.pass }); toast.success("Ramal vinculado"); setLinkFor(null); setLink({ ramal: "", pass: "" }); await load(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }
  async function removeExt(userId: string) {
    if (!confirm("Tirar o ramal desta pessoa no CRM? (Na central ele continua existindo.)")) return;
    setBusy(userId);
    try { await send(`/api/voip/extensions?userId=${userId}`, "DELETE"); await load(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  const myExt = exts.find((e) => e.user_id === ws.userId);

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-ink-800 text-emerald-300"><Headphones className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-white">Telefonia (ligações gravadas)</p>
          {settings === undefined ? <p className="mt-1 text-sm text-slate-500">Verificando…</p> : settings ? (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-emerald-300">
              <CheckCircle2 className="h-4 w-4" /> Central Api4Com conectada{settings.domain ? ` · ${settings.domain}` : ""}
              {myExt && <span className="text-slate-400">· seu ramal {myExt.ramal} {voip.online ? "online" : "offline"}</span>}
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-400">Botão <b>Ligar</b> no lead e na conversa: liga para o celular do cliente pelo navegador, com gravação salva para sempre em Ligações. Funciona com qualquer WhatsApp (coexistência ou QR Code).</p>
          )}
        </div>
        {settings === undefined ? <Spinner /> : ws.canManage && (settings ? (
          <Button variant="outline" onClick={disconnect} loading={busy === "disconnect"}><Unplug className="h-4 w-4" /> Desconectar</Button>
        ) : (
          <Button onClick={() => setConnectOpen(true)}><Phone className="h-4 w-4" /> Conectar central</Button>
        ))}
      </div>

      {settings && (
        <div className="mt-4 divide-y divide-line rounded-lg border border-line">
          {ws.members.map((m) => {
            const e = exts.find((x) => x.user_id === m.user_id);
            return (
              <div key={m.user_id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-slate-200">{m.full_name || m.email}</span>
                {e ? (
                  <>
                    <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200">Ramal {e.ramal}</span>
                    {ws.canManage && <button onClick={() => void removeExt(m.user_id)} disabled={busy === m.user_id} className="text-slate-500 hover:text-red-300" aria-label="Remover ramal"><X className="h-4 w-4" /></button>}
                  </>
                ) : ws.canManage ? (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void createExt(m.user_id)} loading={busy === m.user_id}><Plus className="h-3.5 w-3.5" /> Criar ramal</Button>
                    <Button size="sm" variant="ghost" onClick={() => setLinkFor(m.user_id)}>Já tenho ramal</Button>
                  </div>
                ) : <span className="text-xs text-slate-500">sem ramal</span>}
              </div>
            );
          })}
        </div>
      )}

      <Modal open={connectOpen} onClose={() => setConnectOpen(false)} title="Conectar a central Api4Com"
        footer={<><Button variant="ghost" onClick={() => setConnectOpen(false)}>Cancelar</Button><Button onClick={connect} loading={busy === "connect"} disabled={token.trim().length < 8}>Conectar</Button></>}>
        <div className="space-y-3 text-sm">
          <ol className="list-decimal space-y-1 pl-5 text-slate-300">
            <li>Crie a conta em <a href="https://www.api4com.com" target="_blank" rel="noreferrer" className="text-brand-300">api4com.com</a> e coloque créditos (paga por minuto).</li>
            <li>No portal, gere um <b>token de API</b> (sem validade) e copie.</li>
            <li>Cole aqui. O CRM cadastra sozinho o aviso de fim de ligação com a gravação.</li>
          </ol>
          <Field label="Token da API"><input className="field font-mono" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} /></Field>
          <Field label="Domínio SIP (opcional)" hint="Ex.: suaempresa.api4com.com — aparece no portal. Se deixar vazio, o CRM pega ao criar o primeiro ramal.">
            <input className="field" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="suaempresa.api4com.com" />
          </Field>
        </div>
      </Modal>

      <Modal open={Boolean(linkFor)} onClose={() => setLinkFor(null)} title="Vincular ramal existente"
        footer={<><Button variant="ghost" onClick={() => setLinkFor(null)}>Cancelar</Button><Button onClick={linkExt} loading={busy === "link"} disabled={!link.ramal || link.pass.length < 4}>Vincular</Button></>}>
        <div className="space-y-3 text-sm">
          <Field label="Ramal"><input className="field" inputMode="numeric" value={link.ramal} onChange={(e) => setLink({ ...link, ramal: e.target.value })} /></Field>
          <Field label="Senha SIP do ramal"><input className="field" type="password" autoComplete="new-password" value={link.pass} onChange={(e) => setLink({ ...link, pass: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
