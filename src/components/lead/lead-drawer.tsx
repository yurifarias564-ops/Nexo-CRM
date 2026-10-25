"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, PhoneCall, CalendarPlus, CalendarX, Clock, ExternalLink, MessageCircle, Plus, Send, StickyNote, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Avatar, Field, Portal, Spinner, TagPill } from "@/components/ui/misc";
import { formatPhone, normalizePhone, relativeTime } from "@/lib/utils";
import { useLatest } from "@/lib/hooks";
import { TemplateModal } from "@/components/inbox/template-modal";
import { ScheduleModal } from "./schedule-modal";
import { CallModal } from "./call-modal";
import { VoipCallButton } from "@/components/calls/voip-provider";
import { callOutcomeLabel } from "@/lib/constants";
import { ScheduleMessageModal } from "@/components/scheduled/schedule-message-modal";
import { LeadOrigin } from "./lead-origin";
import { ScheduledList } from "@/components/scheduled/scheduled-list";
import { formatWhen } from "@/lib/time";
import type { Lead } from "@/lib/types";

type Appointment = { id: string; title: string; starts_at: string; ends_at: string; time_zone: string; status: "scheduled" | "canceled"; google_link: string | null; user_id: string | null };
type Activity = { id: number; type: string; payload: Record<string, unknown>; created_at: string; actor_id: string | null };

export function LeadDrawer({
  leadId, onClose, onSaved, onTagsChange, onDeleted,
}: {
  leadId: string | null;
  onClose: () => void;
  onSaved?: (l: Lead) => void;
  onTagsChange?: (leadId: string, tagIds: string[]) => void;
  onDeleted?: (id: string) => void;
}) {
  const ws = useWorkspace();
  const [lead, setLead] = useState<Lead | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", value: "", notes: "", assigned_to: "", stage_id: "" });
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [firstMsg, setFirstMsg] = useState("");
  const [tagMenu, setTagMenu] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [tplOpen, setTplOpen] = useState(false);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [scheduling, setScheduling] = useState(false);
  const [now] = useState(() => Date.now());
  const [schedMsgOpen, setSchedMsgOpen] = useState(false);
  const [schedKey, setSchedKey] = useState(0);
  const [callOpen, setCallOpen] = useState(false);
  const closeRef = useLatest(onClose);

  useEffect(() => {
    if (!leadId) return;
    let alive = true;
    const sb = supabaseBrowser();
    (async () => {
      const [{ data: l }, { data: lt }, { data: act }, { data: conv }, { data: ap }] = await Promise.all([
        sb.from("leads").select("*").eq("id", leadId).maybeSingle(),
        sb.from("lead_tags").select("tag_id").eq("lead_id", leadId),
        sb.from("activities").select("id, type, payload, created_at, actor_id").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(30),
        sb.from("conversations").select("id").eq("lead_id", leadId).order("last_message_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
        sb.from("appointments").select("id, title, starts_at, ends_at, time_zone, status, google_link, user_id").eq("lead_id", leadId).order("starts_at", { ascending: false }).limit(20),
      ]);
      if (!alive) return;
      if (!l) { toast.error("Lead não encontrado"); closeRef.current(); return; }
      setLead(l as Lead);
      setForm({
        name: l.name, phone: l.phone ? formatPhone(l.phone) : "", email: l.email ?? "", value: String(l.value ?? 0),
        notes: l.notes ?? "", assigned_to: l.assigned_to ?? "", stage_id: l.stage_id,
      });
      setTagIds((lt ?? []).map((r) => r.tag_id));
      setActivities((act ?? []) as Activity[]);
      setConversationId(conv?.id ?? null);
      setAppts((ap ?? []) as Appointment[]);
    })();
    return () => { alive = false; };
  }, [leadId, closeRef]);

  useEffect(() => {
    if (!leadId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leadId, closeRef]);

  const stageOptions = useMemo(() => {
    if (!lead) return [];
    return ws.stages.filter((s) => s.pipeline_id === lead.pipeline_id).sort((a, b) => a.position - b.position);
  }, [ws.stages, lead]);

  if (!leadId) return null;

  async function save() {
    if (!lead) return;
    const phone = form.phone.trim() ? normalizePhone(form.phone) : null;
    if (form.phone.trim() && !phone) return toast.error("Telefone inválido");
    const value = Number(String(form.value).replace(",", "."));
    if (!Number.isFinite(value) || value < 0) return toast.error("Valor inválido");
    setSaving(true);
    const patch = {
      name: form.name.trim() || lead.name, phone, email: form.email.trim() || null, value,
      notes: form.notes.trim() || null, assigned_to: form.assigned_to || null, stage_id: form.stage_id,
    };
    const { data, error } = await supabaseBrowser().from("leads").update(patch).eq("id", lead.id).select("*").single();
    setSaving(false);
    if (error) return toast.error(error.code === "23505" ? "Já existe outro lead com este telefone" : error.message);
    setLead(data as Lead);
    onSaved?.(data as Lead);
    toast.success("Lead atualizado");
  }

  async function toggleTag(tagId: string) {
    if (!lead) return;
    const sb = supabaseBrowser();
    const has = tagIds.includes(tagId);
    const next = has ? tagIds.filter((t) => t !== tagId) : [...tagIds, tagId];
    setTagIds(next);
    onTagsChange?.(lead.id, next);
    const { error } = has
      ? await sb.from("lead_tags").delete().eq("lead_id", lead.id).eq("tag_id", tagId)
      : await sb.from("lead_tags").insert({ lead_id: lead.id, tag_id: tagId, organization_id: ws.orgId });
    if (error && error.code !== "23505") {
      setTagIds(tagIds);
      onTagsChange?.(lead.id, tagIds);
      toast.error("Não foi possível atualizar a tag");
    }
  }

  async function createTag() {
    const name = newTag.trim();
    if (!name) return;
    const { data, error } = await supabaseBrowser().from("tags").insert({ organization_id: ws.orgId, name: name.slice(0, 40) }).select("*").single();
    if (error) return toast.error(error.code === "23505" ? "Essa tag já existe" : error.message);
    ws.setTags((t) => [...t, data].sort((a, b) => a.name.localeCompare(b.name)));
    setNewTag("");
    await toggleTag(data.id);
  }

  async function addNote() {
    if (!lead || !note.trim()) return;
    const { data, error } = await supabaseBrowser().from("activities")
      .insert({ organization_id: ws.orgId, lead_id: lead.id, actor_id: ws.userId, type: "note", payload: { text: note.trim() } })
      .select("id, type, payload, created_at, actor_id").single();
    if (error) return toast.error(error.message);
    setActivities((a) => [data as Activity, ...a]);
    setNote("");
  }

  async function startConversation() {
    if (!lead || !firstMsg.trim()) return;
    const res = await fetch("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: lead.id, text: firstMsg.trim() }) });
    const body = await res.json();
    if (!res.ok) {
      if (body.code === "window_closed") {
        toast.message("Este número usa a API oficial: o primeiro contato precisa ser um modelo aprovado.");
        setTplOpen(true);
        return;
      }
      return toast.error(body.error);
    }
    setFirstMsg("");
    toast.success("Mensagem enviada");
    const { data: conv } = await supabaseBrowser().from("conversations").select("id").eq("lead_id", lead.id).limit(1).maybeSingle();
    setConversationId(conv?.id ?? null);
  }

  async function remove() {
    if (!lead || !confirm(`Excluir "${lead.name}" permanentemente?`)) return;
    const { error } = await supabaseBrowser().from("leads").delete().eq("id", lead.id);
    if (error) return toast.error(error.message);
    onDeleted?.(lead.id);
    toast.success("Lead excluído");
    onClose();
  }

  async function reloadSide() {
    if (!lead) return;
    const sb = supabaseBrowser();
    const [{ data: ap }, { data: act }, { data: l }] = await Promise.all([
      sb.from("appointments").select("id, title, starts_at, ends_at, time_zone, status, google_link, user_id").eq("lead_id", lead.id).order("starts_at", { ascending: false }).limit(20),
      sb.from("activities").select("id, type, payload, created_at, actor_id").eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(30),
      sb.from("leads").select("*").eq("id", lead.id).maybeSingle(),
    ]);
    setAppts((ap ?? []) as Appointment[]);
    setActivities((act ?? []) as Activity[]);
    if (l) { setLead(l as Lead); setForm((f) => ({ ...f, stage_id: l.stage_id })); onSaved?.(l as Lead); }
  }

  async function cancelAppt(a: Appointment) {
    if (!confirm(`Cancelar "${a.title}"? O evento também sai do Google Agenda.`)) return;
    const res = await fetch(`/api/appointments/${a.id}`, { method: "DELETE" });
    const body = await res.json();
    if (!res.ok) return toast.error(body.error);
    toast.success(body.google === "error" ? "Cancelado no CRM (não consegui remover do Google Agenda)" : "Agendamento cancelado");
    void reloadSide();
  }

  const describeActivity = (a: Activity) => {
    const who = a.actor_id ? ws.memberById.get(a.actor_id)?.full_name ?? "Alguém" : "Sistema";
    if (a.type === "stage_changed") {
      const from = ws.stageById.get(String(a.payload.from))?.name ?? "—";
      const to = ws.stageById.get(String(a.payload.to))?.name ?? "—";
      return <>{who} moveu de <b className="text-slate-300">{from}</b> <ArrowRight className="inline h-3 w-3" /> <b className="text-slate-300">{to}</b></>;
    }
    if (a.type === "lead_created") return <>{who} criou o lead</>;
    if (a.type === "ai_handoff") return <>🤖 A IA passou o atendimento {a.payload.seller ? <>para <b className="text-slate-300">{String(a.payload.seller)}</b></> : "para a equipe"}{a.payload.reason ? <span className="text-slate-300"> — {String(a.payload.reason)}</span> : null}</>;
    if (a.type === "appointment_created") return <>{who} agendou <b className="text-slate-300">{String(a.payload.title ?? "")}</b> para {formatWhen(String(a.payload.starts_at), Intl.DateTimeFormat().resolvedOptions().timeZone)}</>;
    if (a.type === "appointment_canceled") return <>{who} cancelou <b className="text-slate-300">{String(a.payload.title ?? "")}</b></>;
    if (a.type === "message_scheduled") return <>{who} agendou mensagem para {formatWhen(String(a.payload.send_at), Intl.DateTimeFormat().resolvedOptions().timeZone)}: <span className="text-slate-300">“{String(a.payload.preview ?? "")}”</span></>;
    if (a.type === "scheduled_sent") return <>Mensagem agendada enviada automaticamente</>;
    if (a.type === "scheduled_failed") return <span className="text-amber-300">Mensagem agendada não foi enviada: {String(a.payload.error ?? "")}</span>;
    if (a.type === "call") {
      const d = Number(a.payload.duration_min);
      const viaWa = a.payload.via === "whatsapp";
      const rec = viaWa && a.payload.call_id ? <> · <a href={`/api/calls/${String(a.payload.call_id)}/recording`} target="_blank" rel="noopener noreferrer" className="text-brand-300 hover:text-brand-200">ouvir gravação</a></> : null;
      return <>{a.payload.direction === "in" ? `${who} atendeu ligação do cliente` : `${who} ligou`}{a.payload.via === "voz" ? " (voz)" : viaWa ? " pelo WhatsApp" : ""}: <b className={a.payload.outcome === "atendeu" ? "text-emerald-300" : "text-slate-300"}>{callOutcomeLabel(a.payload.outcome)}</b>{d > 0 ? ` · ${d} min` : ""}{a.payload.notes ? <span className="text-slate-300"> — {String(a.payload.notes)}</span> : null}{rec}</>;
    }
    if (a.type === "note") return <><span className="text-slate-300">{String(a.payload.text ?? "")}</span> <span className="text-slate-600">— {who}{a.payload.via === "voz" ? " (voz)" : ""}</span></>;
    return a.type;
  };

  return (
    <Portal>
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal aria-label="Detalhes do lead">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-lg animate-fadeIn flex-col border-l border-line bg-ink-900 shadow-2xl">
        {!lead || lead.id !== leadId ? (
          <div className="flex flex-1 items-center justify-center"><Spinner /></div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-line px-5 py-4">
              <Avatar name={lead.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-white">{lead.name}</p>
                <p className="text-xs text-slate-500">Criado {relativeTime(lead.created_at)} · {lead.source ?? "Manual"}</p>
              </div>
              {ws.canManage && (
                <button onClick={remove} className="rounded-md p-2 text-slate-500 hover:bg-red-500/10 hover:text-red-300" aria-label="Excluir lead"><Trash2 className="h-4 w-4" /></button>
              )}
              <button onClick={onClose} className="rounded-md p-2 text-slate-400 hover:bg-ink-700 hover:text-white" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </header>

            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
              {conversationId ? (
                <Link href={`/inbox?c=${conversationId}`} className="flex items-center justify-center gap-2 rounded-lg border border-brand-400/30 bg-brand-500/10 py-2.5 text-sm font-medium text-brand-200 hover:bg-brand-500/20">
                  <MessageCircle className="h-4 w-4" /> Abrir conversa no WhatsApp
                </Link>
              ) : lead.phone ? (
                <div className="flex gap-2">
                  <input className="field" placeholder="Iniciar conversa no WhatsApp…" value={firstMsg} onChange={(e) => setFirstMsg(e.target.value)} onKeyDown={(e) => e.key === "Enter" && startConversation()} />
                  <Button size="icon" onClick={startConversation} disabled={!firstMsg.trim()} aria-label="Enviar"><Send className="h-4 w-4" /></Button>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2"><Field label="Nome"><input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={160} /></Field></div>
                <Field label="Telefone"><input className="field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" /></Field>
                <Field label="Valor (R$)"><input className="field" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} inputMode="decimal" /></Field>
                <div className="col-span-2"><Field label="E-mail"><input className="field" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field></div>
                <Field label="Etapa">
                  <select className="field" value={form.stage_id} onChange={(e) => setForm({ ...form, stage_id: e.target.value })}>
                    {stageOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label="Responsável">
                  <select className="field" value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
                    <option value="">Ninguém</option>
                    {ws.members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name ?? m.email}</option>)}
                  </select>
                </Field>
                <div className="col-span-2"><Field label="Observações"><textarea className="field h-20 resize-none py-2" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={5000} /></Field></div>
              </div>
              <Button onClick={save} loading={saving} className="w-full">Salvar alterações</Button>

              <LeadOrigin leadId={lead.id} />

              <div>
                <span className="label">Tags</span>
                <div className="relative flex flex-wrap items-center gap-1.5">
                  {tagIds.map((id) => {
                    const t = ws.tagById.get(id);
                    return t ? <TagPill key={id} name={t.name} color={t.color} onRemove={() => toggleTag(id)} /> : null;
                  })}
                  <button onClick={() => setTagMenu((v) => !v)} className="inline-flex items-center gap-1 rounded-md border border-dashed border-line px-2 py-0.5 text-xs text-slate-400 hover:border-brand-400/50 hover:text-brand-200">
                    <Plus className="h-3 w-3" /> Tag
                  </button>
                  {tagMenu && (
                    <div className="absolute left-0 top-8 z-10 w-64 animate-fadeIn rounded-lg border border-line bg-ink-800 p-2 shadow-card">
                      <div className="max-h-48 space-y-0.5 overflow-y-auto">
                        {ws.tags.map((t) => (
                          <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-ink-700">
                            <input type="checkbox" className="accent-blue-500" checked={tagIds.includes(t.id)} onChange={() => toggleTag(t.id)} />
                            <span className="h-2 w-2 rounded-full" style={{ background: t.color }} /> {t.name}
                          </label>
                        ))}
                      </div>
                      <div className="mt-2 flex gap-1 border-t border-line pt-2">
                        <input className="field h-8 text-xs" placeholder="Nova tag" value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createTag()} maxLength={40} />
                        <Button size="sm" onClick={createTag} disabled={!newTag.trim()}>Criar</Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="label mb-0">Agendamentos</span>
                  <Button size="sm" variant="outline" onClick={() => setScheduling(true)}><CalendarPlus className="h-3.5 w-3.5" /> Agendar</Button>
                </div>
                {appts.length ? (
                  <ul className="space-y-1.5">
                    {appts.map((a) => {
                      const past = new Date(a.ends_at).getTime() < now;
                      return (
                        <li key={a.id} className={`flex items-center gap-3 rounded-lg border border-line bg-ink-850 px-3 py-2 text-sm ${a.status === "canceled" || past ? "opacity-60" : ""}`}>
                          <div className="min-w-0 flex-1">
                            <p className={`truncate font-medium text-slate-100 ${a.status === "canceled" ? "line-through" : ""}`}>{a.title}</p>
                            <p className="text-xs text-slate-400">{formatWhen(a.starts_at, a.time_zone)}{a.status === "canceled" ? " · cancelado" : past ? " · realizado" : ""}</p>
                          </div>
                          {a.google_link && a.status === "scheduled" && (
                            <a href={a.google_link} target="_blank" rel="noopener noreferrer" className="rounded p-1.5 text-slate-400 hover:bg-ink-700 hover:text-brand-200" title="Abrir no Google Agenda" aria-label="Abrir no Google Agenda"><ExternalLink className="h-3.5 w-3.5" /></a>
                          )}
                          {a.status === "scheduled" && !past && (a.user_id === ws.userId || ws.canManage) && (
                            <button onClick={() => cancelAppt(a)} className="rounded p-1.5 text-slate-400 hover:bg-red-500/10 hover:text-red-300" title="Cancelar" aria-label="Cancelar agendamento"><CalendarX className="h-3.5 w-3.5" /></button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="text-sm text-slate-600">Nenhum agendamento.</p>}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="label mb-0">Mensagens agendadas</span>
                  <Button size="sm" variant="outline" onClick={() => setSchedMsgOpen(true)}><CalendarClock className="h-3.5 w-3.5" /> Agendar mensagem</Button>
                </div>
                <ScheduledList leadId={lead.id} statuses={["pending", "sending", "failed", "sent"]} compact refreshKey={schedKey} emptyText="Nenhuma mensagem agendada." />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="label mb-0">Histórico</span>
                  <VoipCallButton leadId={lead.id} name={lead.name} phone={lead.phone} />
                  <Button size="sm" variant="outline" onClick={() => setCallOpen(true)}><PhoneCall className="h-3.5 w-3.5" /> Registrar ligação</Button>
                </div>
                <div className="mb-3 flex gap-2">
                  <input className="field" placeholder="Adicionar anotação…" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} maxLength={2000} />
                  <Button size="icon" variant="secondary" onClick={addNote} disabled={!note.trim()} aria-label="Salvar anotação"><StickyNote className="h-4 w-4" /></Button>
                </div>
                <ol className="space-y-3 border-l border-line pl-4">
                  {activities.map((a) => (
                    <li key={a.id} className="relative text-sm text-slate-400">
                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-400/70 ring-4 ring-ink-900" />
                      <p>{describeActivity(a)}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-600"><Clock className="h-3 w-3" /> {new Date(a.created_at).toLocaleString("pt-BR")}</p>
                    </li>
                  ))}
                  {!activities.length && <li className="text-sm text-slate-600">Sem atividades ainda.</li>}
                </ol>
              </div>
            </div>
          </>
        )}
      </aside>
      {lead && (
        <ScheduleMessageModal open={schedMsgOpen} onClose={() => setSchedMsgOpen(false)} leadId={lead.id} conversationId={conversationId} contactName={lead.name}
          onDone={() => { setSchedKey((k) => k + 1); void reloadSide(); }} />
      )}
      {lead && (
        <CallModal open={callOpen} onClose={() => setCallOpen(false)} leadId={lead.id} leadName={lead.name} onDone={(a) => setActivities((x) => [a as Activity, ...x])} />
      )}
      {lead && (
        <ScheduleModal open={scheduling} onClose={() => setScheduling(false)} leadId={lead.id} leadName={lead.name} moveToScheduleStage onDone={() => void reloadSide()} />
      )}
      {lead && (
        <TemplateModal open={tplOpen} onClose={() => setTplOpen(false)} target={{ leadId: lead.id }}
          defaultFirstParam={lead.name.split(" ")[0]}
          onSent={async () => {
            const { data: conv } = await supabaseBrowser().from("conversations").select("id").eq("lead_id", lead.id).limit(1).maybeSingle();
            setConversationId(conv?.id ?? null);
          }} />
      )}
    </div>
    </Portal>
  );
}
