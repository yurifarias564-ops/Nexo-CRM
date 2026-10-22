"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, History, Plus, QrCode, ShieldCheck, Smartphone, Trash2, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Empty, Field, Modal, Spinner } from "@/components/ui/misc";
import { Section } from "./section";
import { cn, formatPhone, relativeTime } from "@/lib/utils";
import type { Channel } from "@/lib/types";

export function WhatsAppTab() {
  const ws = useWorkspace();
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [adding, setAdding] = useState<null | "choose" | "meta" | "evolution">(null);
  const [qrFor, setQrFor] = useState<string | null>(null);
  const [importing, setImporting] = useState<{ id: string; done: number; total: number; msgs: number } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from("whatsapp_channels").select("*").order("created_at");
    setChannels((data ?? []) as Channel[]);
  }, []);

  useEffect(() => {
    void load();
    const sb = supabaseBrowser();
    const ch = sb.channel(`channels:${ws.orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_channels", filter: `organization_id=eq.${ws.orgId}` }, () => void load())
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [load, ws.orgId]);

  async function remove(c: Channel) {
    if (!confirm(`Desconectar e remover "${c.name}"? As conversas desse número também serão removidas do sistema.`)) return;
    const res = await fetch(`/api/channels/${c.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error);
    toast.success("Número removido");
    void load();
  }

  async function importHistory(c: Channel) {
    setImporting({ id: c.id, done: 0, total: 0, msgs: 0 });
    let cursor = 0;
    let msgs = 0;
    try {
      for (let guard = 0; guard < 5000; guard++) {
        const res = await fetch(`/api/channels/${c.id}/history`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cursor }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (data.mode === "async") { toast.success(data.message); break; }
        msgs += data.imported;
        cursor = data.next;
        setImporting({ id: c.id, done: data.next, total: data.total, msgs });
        if (data.done) { toast.success(`Histórico importado: ${msgs.toLocaleString("pt-BR")} mensagens`); break; }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao importar. Você pode tentar de novo — nada é duplicado.");
    } finally {
      setImporting(null);
      void load();
    }
  }

  if (!ws.canManage) {
    return <Section title="WhatsApp" text="Apenas administradores podem conectar números."><ChannelList channels={channels} /></Section>;
  }

  return (
    <Section title="WhatsApp" text="Conecte quantos números precisar. Ao conectar, o histórico das conversas é importado automaticamente."
      action={<Button size="sm" onClick={() => setAdding("choose")}><Plus className="h-3.5 w-3.5" /> Conectar número</Button>}>
      <ChannelList channels={channels}
        actions={(c) => (
          <>
            {c.provider === "evolution" && c.status !== "connected" && (
              <Button size="sm" variant="outline" onClick={() => setQrFor(c.id)}><QrCode className="h-3.5 w-3.5" /> Ler QR Code</Button>
            )}
            {c.status === "connected" && (
              importing?.id === c.id ? (
                <div className="flex min-w-[180px] items-center gap-2 text-xs text-slate-400">
                  <Spinner className="h-4 w-4" />
                  {importing.total ? `${importing.done}/${importing.total} conversas · ${importing.msgs.toLocaleString("pt-BR")} msgs` : "Preparando…"}
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => importHistory(c)} disabled={!!importing}>
                  <History className="h-3.5 w-3.5" /> {c.history_imported_at ? "Reimportar histórico" : "Importar histórico"}
                </Button>
              )
            )}
            <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-red-300" onClick={() => remove(c)} aria-label="Remover"><Trash2 className="h-3.5 w-3.5" /></Button>
          </>
        )}
        onEmpty={<Button size="sm" onClick={() => setAdding("choose")}><Plus className="h-3.5 w-3.5" /> Conectar primeiro número</Button>}
      />

      <Modal open={adding === "choose"} onClose={() => setAdding(null)} title="Como deseja conectar?" wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <button onClick={() => setAdding("meta")} className="card p-5 text-left transition hover:border-brand-400/50 hover:bg-ink-800">
            <ShieldCheck className="h-6 w-6 text-emerald-300" />
            <p className="mt-3 font-medium text-white">API oficial (Meta)</p>
            <p className="mt-1 text-sm text-slate-400">Sem risco de banimento e mais estável. Com coexistência, importa até ~6 meses de histórico do app.</p>
          </button>
          <button onClick={() => setAdding("evolution")} className="card p-5 text-left transition hover:border-brand-400/50 hover:bg-ink-800">
            <QrCode className="h-6 w-6 text-brand-300" />
            <p className="mt-3 font-medium text-white">QR Code</p>
            <p className="mt-1 text-sm text-slate-400">Conecta em segundos lendo o QR pelo celular e importa todo o histórico. Uso não oficial: há risco de bloqueio pela Meta.</p>
          </button>
        </div>
      </Modal>

      <MetaForm open={adding === "meta"} onClose={() => setAdding(null)} onDone={() => { setAdding(null); void load(); }} />
      <EvolutionForm open={adding === "evolution"} onClose={() => setAdding(null)} onCreated={(id) => { setAdding(null); void load(); setQrFor(id); }} />
      <QrModal channelId={qrFor} onClose={() => setQrFor(null)} onConnected={(id) => {
        setQrFor(null);
        void load();
        toast.success("WhatsApp conectado! O histórico está sendo importado em segundo plano.");
        const c = channels?.find((x) => x.id === id);
        if (c) void importHistory({ ...c, status: "connected" });
      }} />
    </Section>
  );
}

function ChannelList({ channels, actions, onEmpty }: { channels: Channel[] | null; actions?: (c: Channel) => React.ReactNode; onEmpty?: React.ReactNode }) {
  if (!channels) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (!channels.length) return <div className="card"><Empty icon={<Smartphone className="h-5 w-5" />} title="Nenhum número conectado" text="Conecte o WhatsApp da empresa para receber e responder mensagens aqui." action={onEmpty} /></div>;
  return (
    <ul className="space-y-2">
      {channels.map((c) => (
        <li key={c.id} className="card flex flex-wrap items-center gap-3 p-4">
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", c.status === "connected" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300")}>
            {c.status === "connected" ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-white">{c.name}</p>
            <p className="text-xs text-slate-500">
              {c.provider === "meta" ? "API oficial" : "QR Code"} · {c.phone_number ? formatPhone(c.phone_number) : "número ainda não identificado"}
              {" · "}
              <span className={c.status === "connected" ? "text-emerald-300" : "text-amber-300"}>
                {c.status === "connected" ? "Conectado" : c.status === "connecting" ? "Aguardando leitura do QR" : c.status === "error" ? "Erro" : "Desconectado"}
              </span>
              {c.history_imported_at && <> · histórico importado {relativeTime(c.history_imported_at)}</>}
            </p>
            {c.last_error && <p className="mt-1 text-xs text-red-300">{c.last_error}</p>}
          </div>
          <div className="flex items-center gap-2">{actions?.(c)}</div>
        </li>
      ))}
    </ul>
  );
}

function MetaForm({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", phoneNumberId: "", wabaId: "", accessToken: "" });
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "meta", ...f }) });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return toast.error(data.error);
    toast.success("Número oficial conectado! Se for coexistência, o histórico chega em alguns minutos.");
    setF({ name: "", phoneNumberId: "", wabaId: "", accessToken: "" });
    onDone();
  }
  return (
    <Modal open={open} onClose={onClose} title="Conectar API oficial" wide>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nome de identificação"><input className="field" required maxLength={60} placeholder="Comercial" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone Number ID"><input className="field font-mono" required inputMode="numeric" value={f.phoneNumberId} onChange={(e) => setF({ ...f, phoneNumberId: e.target.value.trim() })} /></Field>
          <Field label="WhatsApp Business Account ID"><input className="field font-mono" required inputMode="numeric" value={f.wabaId} onChange={(e) => setF({ ...f, wabaId: e.target.value.trim() })} /></Field>
        </div>
        <Field label="Token de acesso permanente" hint="Token de usuário do sistema com permissões whatsapp_business_messaging e whatsapp_business_management. Fica guardado apenas no servidor.">
          <input className="field font-mono" required type="password" autoComplete="off" value={f.accessToken} onChange={(e) => setF({ ...f, accessToken: e.target.value.trim() })} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy}>Conectar</Button>
        </div>
      </form>
    </Modal>
  );
}

function EvolutionForm({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "evolution", name }) });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return toast.error(data.error);
    setName("");
    onCreated(data.id);
  }
  return (
    <Modal open={open} onClose={onClose} title="Conectar por QR Code">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nome de identificação"><input className="field" required maxLength={60} placeholder="Vendas — Maria" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
          Conexão não oficial (WhatsApp Web). Evite disparos em massa para reduzir o risco de bloqueio do número.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy}>Gerar QR Code</Button>
        </div>
      </form>
    </Modal>
  );
}

function QrModal({ channelId, onClose, onConnected }: { channelId: string | null; onClose: () => void; onConnected: (id: string) => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [pairing, setPairing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const connectedRef = useRef(onConnected);
  connectedRef.current = onConnected;

  useEffect(() => {
    if (!channelId) return;
    let alive = true;
    setQr(null); setErr(null); setPairing(null);
    const poll = async () => {
      try {
        const res = await fetch(`/api/channels/${channelId}/qr`, { cache: "no-store" });
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(data.error);
        if (data.status === "connected") { alive = false; connectedRef.current(channelId); return; }
        if (data.qr) setQr(data.qr.startsWith("data:") ? data.qr : `data:image/png;base64,${data.qr}`);
        if (data.pairingCode) setPairing(data.pairingCode);
        setErr(null);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "Falha ao obter QR Code");
      }
    };
    void poll();
    const t = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [channelId]);

  return (
    <Modal open={!!channelId} onClose={onClose} title="Escaneie o QR Code">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-64 w-64 items-center justify-center rounded-xl bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr ? <img src={qr} alt="QR Code do WhatsApp" className="h-full w-full" /> : <Spinner className="border-slate-300 border-t-slate-700" />}
        </div>
        {pairing && <p className="text-sm text-slate-300">Ou use o código: <code className="rounded bg-ink-950 px-2 py-1 text-brand-300">{pairing}</code></p>}
        {err && <p className="text-sm text-red-300">{err}</p>}
        <ol className="space-y-1 text-left text-sm text-slate-400">
          <li>1. Abra o WhatsApp no celular</li>
          <li>2. Toque em <b className="text-slate-200">Aparelhos conectados → Conectar aparelho</b></li>
          <li>3. Aponte a câmera para este QR Code</li>
        </ol>
        <p className="flex items-center gap-2 text-xs text-slate-500"><CheckCircle2 className="h-3.5 w-3.5" /> O QR é renovado automaticamente</p>
      </div>
    </Modal>
  );
}
