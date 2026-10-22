"use client";
import { useState } from "react";
import Link from "next/link";
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/misc";
import { formatPhone } from "@/lib/utils";
import type { Provider } from "@/lib/types";
import { useCalls } from "./call-provider";
import { fmtDuration } from "./webrtc";

interface Permission { status: "no_permission" | "temporary" | "permanent"; expiresAt: string | null; canCall: boolean; canRequest: boolean; callLimitUntil: string | null; windowOpen: boolean; recording: string }

/** Botão de ligar no topo da conversa (igual ao WhatsApp). */
export function CallButton({ conversationId, name, phone, provider }: { conversationId: string; name: string; phone: string; provider: Provider | null }) {
  const calls = useCalls();
  const [checking, setChecking] = useState(false);
  const [modal, setModal] = useState<null | { kind: "permission"; p: Permission } | { kind: "qr" } | { kind: "error"; msg: string; settings?: boolean }>(null);
  const [text, setText] = useState("Olá! Podemos te ligar aqui pelo WhatsApp para continuar o atendimento?");
  const [sending, setSending] = useState(false);

  async function click() {
    if (!provider) return;
    if (provider !== "meta") return setModal({ kind: "qr" });
    setChecking(true);
    try {
      const res = await fetch(`/api/calls/permission?conversationId=${conversationId}`);
      const body = await res.json();
      if (!res.ok) return setModal({ kind: "error", msg: body.error ?? "Erro", settings: /Configurações/.test(body.error ?? "") });
      const p = body as Permission;
      if (p.canCall && p.status !== "no_permission") return void calls.start({ conversationId, name, phone });
      setModal({ kind: "permission", p });
    } finally {
      setChecking(false);
    }
  }

  async function requestPermission() {
    setSending(true);
    const res = await fetch("/api/calls/permission", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, text }) });
    const body = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) return toast.error(body.error ?? "Não foi possível enviar");
    toast.success("Pedido enviado. Quando o cliente tocar em “Permitir”, é só ligar.");
    setModal(null);
  }

  const p = modal?.kind === "permission" ? modal.p : null;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => void click()} loading={checking} disabled={calls.busy} title="Ligar pelo WhatsApp" aria-label="Ligar pelo WhatsApp">
        {!checking && <Phone className="h-3.5 w-3.5" />} <span className="hidden sm:inline">Ligar</span>
      </Button>

      <Modal open={modal?.kind === "qr"} onClose={() => setModal(null)} title="Ligar para o cliente">
        <div className="space-y-3 text-sm text-slate-300">
          <p>Este número está conectado por <b>QR Code</b>. Por essa conexão o WhatsApp não permite ligações de voz pelo sistema.</p>
          <p>Para ligar pelo CRM com gravação, conecte o número pela <b>API oficial</b> em Configurações → WhatsApp e ative as ligações.</p>
          <a href={`tel:+${phone}`} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-slate-100 hover:bg-ink-800"><Smartphone className="h-4 w-4" /> Ligar pelo celular · {formatPhone(phone)}</a>
          <p className="text-xs text-slate-500">Depois, use “Registrar ligação” no lead para contar no relatório.</p>
        </div>
      </Modal>

      <Modal open={modal?.kind === "error"} onClose={() => setModal(null)} title="Não dá para ligar agora">
        <p className="text-sm text-slate-300">{modal?.kind === "error" ? modal.msg : ""}</p>
        {modal?.kind === "error" && modal.settings && <Link href="/settings?tab=whatsapp" className="mt-3 inline-block text-sm font-medium text-brand-300 hover:text-brand-200">Abrir Configurações → WhatsApp →</Link>}
      </Modal>

      <Modal open={!!p} onClose={() => setModal(null)} title="O cliente precisa permitir a ligação"
        footer={p && <><Button variant="ghost" onClick={() => setModal(null)}>Fechar</Button>
          <Button onClick={() => void requestPermission()} loading={sending} disabled={!p.windowOpen || !p.canRequest}>Pedir permissão</Button></>}>
        {p && (
          <div className="space-y-3 text-sm text-slate-300">
            <p>Pela regra do WhatsApp, a empresa só liga depois que o cliente toca em <b>“Permitir”</b> num pedido enviado na conversa. A permissão vale <b>7 dias</b> (ou para sempre, se ele escolher).</p>
            {p.callLimitUntil && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-200">Limite de ligações para este cliente atingido até {new Date(p.callLimitUntil).toLocaleString("pt-BR")}.</p>}
            {!p.windowOpen ? (
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-200">O pedido só pode ser enviado até 24h depois da última mensagem do cliente. Envie um modelo aprovado para ele responder e tente de novo.</p>
            ) : !p.canRequest ? (
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-200">Limite de pedidos atingido (1 por dia e 2 por semana). Tente amanhã.</p>
            ) : (
              <label className="block"><span className="label">Mensagem do pedido</span>
                <textarea className="field min-h-[80px]" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} /></label>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

export interface ChatCall { id: string; direction: "out" | "in"; status: string; duration_s: number | null; recording_path: string | null; backup_path?: string | null; created_at: string; error: string | null }

const LABEL: Record<string, string> = {
  completed: "Ligação", failed: "Ligação falhou", rejected: "Ligação recusada", missed: "Ligação não atendida", canceled: "Ligação cancelada",
  starting: "Ligando…", ringing: "Chamando…", accepting: "Conectando…", connected: "Em ligação",
};

/** Linha da ligação no meio da conversa (com a gravação para ouvir). */
export function CallEntry({ c }: { c: ChatCall }) {
  const missed = ["missed", "rejected", "failed", "canceled"].includes(c.status);
  const Icon = missed ? PhoneMissed : c.direction === "in" ? PhoneIncoming : PhoneOutgoing;
  const time = new Date(c.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="flex justify-center">
      <div className="w-full max-w-sm rounded-xl border border-line bg-ink-850/90 px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <Icon className={missed ? "h-4 w-4 text-red-300" : "h-4 w-4 text-emerald-300"} />
          <span className="font-medium text-slate-100">{LABEL[c.status] ?? "Ligação"}{c.direction === "in" ? " recebida" : ""}</span>
          {c.duration_s ? <span className="font-mono text-xs text-slate-400">{fmtDuration(c.duration_s)}</span> : null}
          <span className="ml-auto text-[10px] text-slate-500">{time}</span>
        </div>
        {(c.recording_path || c.backup_path) && <audio controls preload="none" src={`/api/calls/${c.id}/recording`} className="mt-2 h-9 w-full" />}
        {!c.recording_path && !c.backup_path && c.status === "completed" && c.duration_s ? <p className="mt-1 text-[11px] text-slate-500">A gravação aparece aqui em alguns instantes, se estiver ativada.</p> : null}
      </div>
    </div>
  );
}
