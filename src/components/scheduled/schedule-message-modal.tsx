"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Info } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/workspace";
import { fillTemplate } from "@/components/inbox/quick-replies";
import { Button } from "@/components/ui/button";
import { Field, Modal, Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const isPast = (ms: number) => Number.isNaN(ms) || ms < Date.now() - 60_000;
const userTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "America/Sao_Paulo"; } };

type Target = { provider: "meta" | "evolution"; channelId: string; windowOpenUntil: string | null } | null;
type Template = { name: string; language: string; category: string; body: string; params: number };

export interface EditingScheduled { id: string; body: string | null; send_at: string }

/** Agendar (ou editar) uma mensagem de WhatsApp para dia e hora escolhidos. */
export function ScheduleMessageModal({
  open, onClose, leadId, conversationId, contactName, editing, onDone,
}: {
  open: boolean; onClose: () => void; leadId?: string | null; conversationId?: string | null; contactName: string;
  editing?: EditingScheduled | null; onDone?: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={editing ? "Editar mensagem agendada" : `Agendar mensagem para ${contactName}`} wide>
      {open && (
        <Form key={editing?.id ?? `${leadId}-${conversationId}`} leadId={leadId ?? null} conversationId={conversationId ?? null}
          contactName={contactName} editing={editing ?? null} onClose={onClose} onDone={onDone} />
      )}
    </Modal>
  );
}

function Form({ leadId, conversationId, contactName, editing, onClose, onDone }: {
  leadId: string | null; conversationId: string | null; contactName: string; editing: EditingScheduled | null; onClose: () => void; onDone?: () => void;
}) {
  const ws = useWorkspace();
  const [date, setDate] = useState(() => {
    if (editing) return localDate(new Date(editing.send_at));
    const d = new Date(); d.setDate(d.getDate() + 1); return localDate(d);
  });
  const [time, setTime] = useState(() => (editing ? localTime(new Date(editing.send_at)) : "09:00"));
  const [text, setText] = useState(editing?.body ?? "");
  const [target, setTarget] = useState<Target | undefined>(editing ? null : undefined);
  const [useTpl, setUseTpl] = useState(false);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [tplKey, setTplKey] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editing) return;
    const q = new URLSearchParams();
    if (leadId) q.set("leadId", leadId);
    if (conversationId) q.set("conversationId", conversationId);
    fetch(`/api/scheduled-messages/target?${q}`).then((r) => r.json()).then((b) => setTarget(b.target ?? null)).catch(() => setTarget(null));
  }, [leadId, conversationId, editing]);

  useEffect(() => {
    if (!useTpl || !target || templates) return;
    fetch(`/api/channels/${target.channelId}/templates`).then((r) => r.json()).then((b) => setTemplates(b.templates ?? [])).catch(() => setTemplates([]));
  }, [useTpl, target, templates]);

  const sendAtMs = useMemo(() => new Date(`${date}T${time}`).getTime(), [date, time]);
  const metaRisk = target?.provider === "meta" && !useTpl && (!target.windowOpenUntil || new Date(target.windowOpenUntil).getTime() < sendAtMs);
  const tpl = templates?.find((t) => `${t.name}|${t.language}` === tplKey) ?? null;
  const first = contactName.split(" ")[0] ?? "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isPast(sendAtMs)) return toast.error("Escolha um dia e horário no futuro");
    setBusy(true);
    const tz = userTz();
    const res = editing
      ? await fetch(`/api/scheduled-messages/${editing.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sendAt: `${date}T${time}`, timeZone: tz, ...(editing.body !== null ? { body: text } : {}) }),
        })
      : await fetch("/api/scheduled-messages", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId: leadId ?? undefined, conversationId: conversationId ?? undefined, sendAt: `${date}T${time}`, timeZone: tz,
            ...(useTpl && tpl ? { template: { name: tpl.name, language: tpl.language, params } } : { body: text }),
          }),
        });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return toast.error(body.error);
    const when = new Date(`${date}T${time}`).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    toast.success(editing ? "Mensagem agendada atualizada" : "Mensagem agendada", { description: `Será enviada ${when} no WhatsApp de ${contactName}.` });
    onDone?.();
    onClose();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dia"><input type="date" className="field" required value={date} min={localDate(new Date())} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Horário"><input type="time" className="field" required value={time} step={300} onChange={(e) => setTime(e.target.value)} /></Field>
      </div>

      {target?.provider === "meta" && !editing && (
        <div className="flex gap-1 rounded-lg border border-line bg-ink-900 p-1 text-sm" role="tablist">
          {[{ v: false, l: "Texto livre" }, { v: true, l: "Modelo aprovado" }].map((o) => (
            <button key={o.l} type="button" role="tab" aria-selected={useTpl === o.v} onClick={() => setUseTpl(o.v)}
              className={cn("flex-1 rounded-md py-1.5 font-medium transition", useTpl === o.v ? "bg-ink-700 text-white" : "text-slate-400 hover:text-slate-200")}>{o.l}</button>
          ))}
        </div>
      )}

      {useTpl ? (
        !templates ? <div className="flex justify-center py-6"><Spinner /></div> : templates.length ? (
          <div className="space-y-3">
            <Field label="Modelo">
              <select className="field" value={tplKey} onChange={(e) => {
                setTplKey(e.target.value);
                const t = templates.find((x) => `${x.name}|${x.language}` === e.target.value);
                setParams(Array.from({ length: t?.params ?? 0 }, (_, i) => (i === 0 ? first : "")));
              }}>
                <option value="" disabled>Escolha um modelo…</option>
                {templates.map((t) => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} · {t.language}</option>)}
              </select>
            </Field>
            {params.map((p, i) => (
              <Field key={i} label={`Variável {{${i + 1}}}`}><input className="field" value={p} onChange={(e) => setParams((a) => a.map((x, j) => (j === i ? e.target.value : x)))} /></Field>
            ))}
            {tpl && <p className="whitespace-pre-wrap rounded-xl bg-gradient-to-br from-brand-600 to-navy-500 p-3 text-sm text-white">{tpl.body.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => params[Number(n) - 1] || `{{${n}}}`)}</p>}
          </div>
        ) : <p className="rounded-lg border border-line p-4 text-sm text-slate-400">Nenhum modelo aprovado disponível neste número.</p>
      ) : (
        <Field label="Mensagem">
          <textarea className="field h-32 resize-y py-2" required maxLength={4096} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={`E aí, ${first}, tudo certo? Vamos dar continuidade no nosso atendimento.`} />
          {ws.quickReplies.length > 0 && editing?.body !== null && (
            <select className="field mt-2 h-9 text-xs" value="" onChange={(e) => {
              const q = ws.quickReplies.find((x) => x.id === e.target.value);
              if (q) setText(fillTemplate(q.content, { name: contactName, agent: ws.userName }));
            }}>
              <option value="">Usar uma mensagem rápida…</option>
              {ws.quickReplies.map((q) => <option key={q.id} value={q.id}>/{q.shortcut} — {q.title}</option>)}
            </select>
          )}
        </Field>
      )}

      {target === undefined && !editing && <p className="text-xs text-slate-500">Verificando o canal do WhatsApp…</p>}
      {target === null && !editing && (
        <p className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Nenhum WhatsApp conectado para este contato agora. A mensagem fica agendada e será enviada se houver um número conectado no horário.
        </p>
      )}
      {metaRisk && (
        <p className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Este número usa a API oficial: texto livre só é entregue se o cliente tiver falado nas 24h anteriores ao envio. Para retomar contato, prefira um <b>modelo aprovado</b>.
        </p>
      )}
      {target?.provider === "evolution" && (
        <p className="flex gap-2 text-xs text-slate-500"><Info className="h-3.5 w-3.5 shrink-0" /> Será enviada pelo número conectado por QR Code, no horário escolhido.</p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" loading={busy} disabled={useTpl ? !tpl || params.some((p) => !p.trim()) : !text.trim()}>
          <CalendarClock className="h-4 w-4" /> {editing ? "Salvar" : "Agendar envio"}
        </Button>
      </div>
    </form>
  );
}
