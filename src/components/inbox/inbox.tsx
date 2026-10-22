"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarClock, Check, CheckCheck, Clock, FileText, Lock, MapPin, MessageCircle, Paperclip, Search, Send, UserRound, X, Zap, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { LeadDrawer } from "@/components/lead/lead-drawer";
import { Button } from "@/components/ui/button";
import { Avatar, Empty, Spinner, TagPill } from "@/components/ui/misc";
import { QuickReplyMenu, fillTemplate, useQuickReplyMatches } from "./quick-replies";
import { TemplateModal } from "./template-modal";
import { ScheduleMessageModal } from "@/components/scheduled/schedule-message-modal";
import { cn, formatPhone } from "@/lib/utils";
import { CallButton, CallEntry, type ChatCall } from "@/components/calls/call-button";
import { TimeAgo } from "@/components/ui/time-ago";
import { useLatest } from "@/lib/hooks";
import type { Conversation, Lead, Message, MsgType, Provider } from "@/lib/types";

const DAY_MS = 24 * 3600 * 1000;
const MAX_FILE = 16 * 1024 * 1024;

function kindOf(mime: string): MsgType {
  if (/^image\/(jpeg|png)$/.test(mime)) return "image";
  if (/^video\/(mp4|3gpp)$/.test(mime)) return "video";
  if (/^audio\//.test(mime)) return "audio";
  return "document";
}

type ConvRow = Conversation & { leads: Pick<Lead, "id" | "name" | "stage_id"> | null };
const CONV_PAGE = 40;
const MSG_PAGE = 50;

export function Inbox({ initialConversationId }: { initialConversationId: string | null }) {
  const ws = useWorkspace();
  const router = useRouter();
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [hasMoreConvs, setHasMoreConvs] = useState(true);
  const [selected, setSelected] = useState<string | null>(initialConversationId);
  const [search, setSearch] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [drawerLead, setDrawerLead] = useState<string | null>(null);
  const [hasChannel, setHasChannel] = useState<boolean | null>(null);

  const loadConvs = useCallback(async (reset: boolean, from = 0) => {
    const sb = supabaseBrowser();
    let q = sb.from("conversations").select("*, leads(id, name, stage_id)")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .range(from, from + CONV_PAGE - 1);
    if (onlyUnread) q = q.gt("unread_count", 0);
    if (search.trim()) {
      const s = search.trim().replace(/[%_,()]/g, "");
      const digits = s.replace(/\D/g, "");
      q = digits.length >= 4 ? q.ilike("wa_id", `%${digits}%`) : q.ilike("contact_name", `%${s}%`);
    }
    const { data, error } = await q;
    if (error) { toast.error("Falha ao carregar conversas"); return; }
    const rows = (data ?? []) as ConvRow[];
    setConvs((cur) => (reset ? rows : [...cur, ...rows.filter((r) => !cur.some((c) => c.id === r.id))]));
    setHasMoreConvs(rows.length === CONV_PAGE);
    setLoadingConvs(false);
  }, [onlyUnread, search]);

  useEffect(() => {
    const t = setTimeout(() => { setLoadingConvs(true); void loadConvs(true); }, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadConvs, search]);

  useEffect(() => {
    supabaseBrowser().from("whatsapp_channels").select("id", { count: "exact", head: true }).then(({ count }) => setHasChannel((count ?? 0) > 0));
  }, []);

  // Tempo real nas conversas
  useEffect(() => {
    const sb = supabaseBrowser();
    // Cache curto de leads: evita uma consulta por mensagem em contas movimentadas
    const leadCache = new Map<string, { at: number; lead: ConvRow["leads"] }>();
    const ch = sb.channel(`inbox:${ws.orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `organization_id=eq.${ws.orgId}` }, async (p) => {
        if (p.eventType === "DELETE") return setConvs((cur) => cur.filter((c) => c.id !== (p.old as Conversation).id));
        const row = p.new as Conversation;
        let lead: ConvRow["leads"] = null;
        if (row.lead_id) {
          const hit = leadCache.get(row.lead_id);
          if (hit && Date.now() - hit.at < 30_000) lead = hit.lead;
          else {
            const { data } = await sb.from("leads").select("id, name, stage_id").eq("id", row.lead_id).maybeSingle();
            lead = data as ConvRow["leads"];
            leadCache.set(row.lead_id, { at: Date.now(), lead });
          }
        }
        setConvs((cur) => {
          const merged = { ...row, leads: lead } as ConvRow;
          const next = cur.some((c) => c.id === row.id) ? cur.map((c) => (c.id === row.id ? merged : c)) : [merged, ...cur];
          return next.sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""));
        });
      })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [ws.orgId]);

  const current = convs.find((c) => c.id === selected) ?? null;

  function open(id: string) {
    setSelected(id);
    router.replace(`/inbox?c=${id}`, { scroll: false });
  }

  return (
    <div className="flex h-full">
      <section className={cn("flex w-full flex-col border-r border-line bg-ink-900/50 md:w-[340px] md:shrink-0", selected && "hidden md:flex")}>
        <div className="space-y-2 border-b border-line p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input className="field h-9 pl-9" placeholder="Buscar nome ou número" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-1 text-xs">
            {[{ v: false, l: "Todas" }, { v: true, l: "Não lidas" }].map((o) => (
              <button key={o.l} onClick={() => setOnlyUnread(o.v)} className={cn("rounded-full px-3 py-1 font-medium", onlyUnread === o.v ? "bg-brand-500/20 text-brand-200" : "text-slate-400 hover:bg-ink-800")}>{o.l}</button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto" onScroll={(e) => {
          const el = e.currentTarget;
          if (hasMoreConvs && !loadingConvs && el.scrollTop + el.clientHeight > el.scrollHeight - 200) { setLoadingConvs(true); void loadConvs(false, convs.length); }
        }}>
          {convs.map((c) => {
            const name = c.leads?.name ?? c.contact_name ?? formatPhone(c.wa_id);
            const stage = c.leads?.stage_id ? ws.stageById.get(c.leads.stage_id) : null;
            return (
              <button key={c.id} onClick={() => open(c.id)}
                className={cn("flex w-full items-center gap-3 border-b border-line/50 px-3 py-3 text-left transition hover:bg-ink-800/70", selected === c.id && "bg-brand-500/10 shadow-[inset_2px_0_0_0_#3b82f6]")}>
                <Avatar name={name} className="h-10 w-10" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className={cn("flex-1 truncate text-sm", c.unread_count ? "font-semibold text-white" : "font-medium text-slate-200")}>{name}</p>
                    <span className={cn("shrink-0 text-[11px]", c.unread_count ? "text-brand-300" : "text-slate-500")}><TimeAgo iso={c.last_message_at} /></span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <p className="flex-1 truncate text-xs text-slate-400">{c.last_message_preview ?? "—"}</p>
                    {c.unread_count > 0 && <span className="rounded-full bg-brand-500 px-1.5 text-[10px] font-bold leading-4 text-white">{c.unread_count}</span>}
                  </div>
                  {stage && <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-500"><span className="h-1.5 w-1.5 rounded-full" style={{ background: stage.color }} />{stage.name}</span>}
                </div>
              </button>
            );
          })}
          {loadingConvs && <div className="flex justify-center py-6"><Spinner /></div>}
          {!loadingConvs && !convs.length && (
            hasChannel === false
              ? <Empty icon={<MessageCircle className="h-5 w-5" />} title="Conecte seu WhatsApp" text="As conversas aparecem aqui assim que um número for conectado." action={<Button size="sm" onClick={() => router.push("/settings?tab=whatsapp")}>Conectar número</Button>} />
              : <Empty icon={<MessageCircle className="h-5 w-5" />} title="Nenhuma conversa" text={search || onlyUnread ? "Nada encontrado com esse filtro." : "Assim que chegarem mensagens, elas aparecem aqui."} />
          )}
        </div>
      </section>

      <section className={cn("min-w-0 flex-1", !selected && "hidden md:block")}>
        {current ? (
          <Chat key={current.id} conv={current} onBack={() => { setSelected(null); router.replace("/inbox", { scroll: false }); }} onOpenLead={setDrawerLead} />
        ) : selected && loadingConvs ? (
          <div className="flex h-full items-center justify-center"><Spinner /></div>
        ) : (
          <div className="chat-bg flex h-full items-center justify-center">
            <Empty icon={<MessageCircle className="h-5 w-5" />} title="Selecione uma conversa" text="Dica: no campo de mensagem, digite / para usar mensagens rápidas." />
          </div>
        )}
      </section>

      <LeadDrawer leadId={drawerLead} onClose={() => setDrawerLead(null)}
        onSaved={(l) => setConvs((cur) => cur.map((c) => (c.lead_id === l.id ? { ...c, leads: { id: l.id, name: l.name, stage_id: l.stage_id } } : c)))} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Chat({ conv, onBack, onOpenLead }: { conv: ConvRow; onBack: () => void; onOpenLead: (id: string) => void }) {
  const ws = useWorkspace();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrIndex, setQrIndex] = useState(0);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [lastInAt, setLastInAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [file, setFile] = useState<File | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [schedOpen, setSchedOpen] = useState(false);
  const [calls, setCalls] = useState<ChatCall[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const unreadRef = useLatest(conv.unread_count);

  const name = conv.leads?.name ?? conv.contact_name ?? formatPhone(conv.wa_id);
  const slashQuery = text.startsWith("/") && !text.includes(" ") && !text.includes("\n") ? text.slice(1) : null;
  const matches = useQuickReplyMatches(slashQuery ?? "");
  const menuOpen = qrOpen || slashQuery !== null;

  const scrollToBottom = () => requestAnimationFrame(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; });

  useEffect(() => {
    let alive = true;
    const sb = supabaseBrowser();
    (async () => {
      const { data } = await sb.from("messages").select("*").eq("conversation_id", conv.id).order("sent_at", { ascending: false }).limit(MSG_PAGE);
      if (!alive) return;
      setMessages(((data ?? []) as Message[]).reverse());
      setHasMore((data?.length ?? 0) === MSG_PAGE);
      setLoading(false);
      scrollToBottom();
      if (unreadRef.current > 0) await sb.rpc("mark_conversation_read", { conv: conv.id });
    })();
    sb.from("whatsapp_channels").select("provider").eq("id", conv.channel_id).maybeSingle()
      .then(({ data }) => alive && setProvider((data?.provider as Provider | undefined) ?? null));
    sb.from("messages").select("sent_at").eq("conversation_id", conv.id).eq("direction", "in").order("sent_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => alive && setLastInAt(data ? new Date(data.sent_at).getTime() : null));
    if (conv.lead_id) sb.from("lead_tags").select("tag_id").eq("lead_id", conv.lead_id).then(({ data }) => alive && setTagIds((data ?? []).map((r) => r.tag_id)));

    sb.from("wa_calls").select("id, direction, status, duration_s, recording_path, backup_path, created_at, error").eq("conversation_id", conv.id)
      .order("created_at", { ascending: false }).limit(50).then(({ data }) => alive && setCalls((data ?? []) as ChatCall[]));

    const ch = sb.channel(`chat:${conv.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_calls", filter: `conversation_id=eq.${conv.id}` }, (p) => {
        const c = p.new as ChatCall;
        if (!c?.id) return;
        setCalls((cur) => [c, ...cur.filter((x) => x.id !== c.id)]);
        if (stickToBottom.current) scrollToBottom();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conv.id}` }, (p) => {
        if (p.eventType === "INSERT") {
          const m = p.new as Message;
          setMessages((cur) => {
            if (cur.some((x) => x.id === m.id)) return cur;
            const withoutTemp = cur.filter((x) => !(x.id.startsWith("tmp-") && x.body === m.body && m.direction === "out"));
            return [...withoutTemp, m].sort((a, b) => a.sent_at.localeCompare(b.sent_at));
          });
          if (stickToBottom.current) scrollToBottom();
          if (m.direction === "in") {
            setLastInAt((cur) => Math.max(cur ?? 0, new Date(m.sent_at).getTime()));
            setNow(Date.now());
            void sb.rpc("mark_conversation_read", { conv: conv.id });
          }
        } else if (p.eventType === "UPDATE") {
          const m = p.new as Message;
          setMessages((cur) => cur.map((x) => (x.id === m.id ? m : x)));
        }
      })
      .subscribe();
    inputRef.current?.focus();
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => { alive = false; clearInterval(tick); sb.removeChannel(ch); };
  }, [conv.id, conv.lead_id, conv.channel_id, unreadRef]);

  const windowClosed = provider === "meta" && (lastInAt === null || now - lastInAt > DAY_MS);
  const hoursLeft = provider === "meta" && lastInAt !== null && !windowClosed ? Math.max(0, Math.floor((DAY_MS - (now - lastInAt)) / 3600000)) : null;

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_FILE) return toast.error("Arquivo maior que 16 MB");
    setFile(f);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function loadOlder() {
    const first = messages[0];
    if (!first) return;
    const el = scroller.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const { data } = await supabaseBrowser().from("messages").select("*").eq("conversation_id", conv.id).lt("sent_at", first.sent_at).order("sent_at", { ascending: false }).limit(MSG_PAGE);
    const older = ((data ?? []) as Message[]).reverse();
    setHasMore(older.length === MSG_PAGE);
    setMessages((cur) => [...older.filter((o) => !cur.some((c) => c.id === o.id)), ...cur]);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevHeight; });
  }

  function insertQuickReply(content: string) {
    setText(fillTemplate(content, { name, agent: ws.userName }));
    setQrOpen(false);
    setQrIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function sendFile(f: File) {
    if (sending) return;
    setSending(true);
    const caption = text.trim();
    const tempId = `tmp-${Date.now()}`;
    const kind = kindOf(f.type || "");
    const temp: Message = { id: tempId, conversation_id: conv.id, channel_id: conv.channel_id, external_id: tempId, direction: "out", type: kind, body: caption || (kind === "document" ? f.name : `📎 ${f.name}`), media_ref: null, media_mime: f.type, status: "pending", sent_by: ws.userId, sent_at: new Date().toISOString() };
    setMessages((cur) => [...cur, temp]);
    setText("");
    setFile(null);
    stickToBottom.current = true;
    scrollToBottom();
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("conversationId", conv.id);
      fd.append("caption", caption);
      const res = await fetch("/api/messages/media", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { if (data.code === "window_closed") setLastInAt(null); throw new Error(data.error); }
      setMessages((cur) => cur.some((m) => m.id === data.id)
        ? cur.filter((m) => m.id !== tempId)
        : cur.map((m) => (m.id === tempId ? { ...m, id: data.id, external_id: data.externalId, status: "sent", media_ref: "sent" } : m)));
    } catch (e) {
      setMessages((cur) => cur.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m)));
      setFile(f);
      setText(caption);
      toast.error(e instanceof Error ? e.message : "Falha ao enviar arquivo");
    } finally {
      setSending(false);
    }
  }

  async function send() {
    if (file) return sendFile(file);
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const tempId = `tmp-${Date.now()}`;
    const temp: Message = { id: tempId, conversation_id: conv.id, channel_id: conv.channel_id, external_id: tempId, direction: "out", type: "text", body, media_ref: null, media_mime: null, status: "pending", sent_by: ws.userId, sent_at: new Date().toISOString() };
    setMessages((cur) => [...cur, temp]);
    setText("");
    stickToBottom.current = true;
    scrollToBottom();
    try {
      const res = await fetch("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: conv.id, text: body }) });
      const data = await res.json();
      if (!res.ok) { if (data.code === "window_closed") setLastInAt(null); throw new Error(data.error); }
      setMessages((cur) => cur.some((m) => m.id === data.id)
        ? cur.filter((m) => m.id !== tempId)
        : cur.map((m) => (m.id === tempId ? { ...m, id: data.id, external_id: data.externalId, status: "sent" } : m)));
    } catch (e) {
      setMessages((cur) => cur.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m)));
      setText(body);
      toast.error(e instanceof Error ? e.message : "Falha ao enviar");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOpen && matches.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setQrIndex((i) => (i + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setQrIndex((i) => (i - 1 + matches.length) % matches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertQuickReply(matches[Math.min(qrIndex, matches.length - 1)]!.content); return; }
    }
    if (e.key === "Escape" && menuOpen) { setQrOpen(false); if (slashQuery !== null) setText(""); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  // Auto-altura do campo
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);


  const grouped = useMemo(() => {
    type Item = Message | (ChatCall & { kind: "call"; sent_at: string });
    const oldest = messages[0]?.sent_at ?? "";
    const items: Item[] = [...messages, ...calls.filter((c) => !hasMore || c.created_at >= oldest).map((c) => ({ ...c, kind: "call" as const, sent_at: c.created_at }))]
      .sort((a, b) => a.sent_at.localeCompare(b.sent_at));
    const out: { day: string; items: Item[] }[] = [];
    for (const m of items) {
      const d = new Date(m.sent_at);
      const today = new Date();
      const yest = new Date(); yest.setDate(today.getDate() - 1);
      const day = d.toDateString() === today.toDateString() ? "Hoje" : d.toDateString() === yest.toDateString() ? "Ontem" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
      const last = out[out.length - 1];
      if (last?.day === day) last.items.push(m); else out.push({ day, items: [m] });
    }
    return out;
  }, [messages, calls, hasMore]);

  const stage = conv.leads?.stage_id ? ws.stageById.get(conv.leads.stage_id) : null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-ink-900/70 px-4 py-2.5">
        <button onClick={onBack} className="rounded-md p-1.5 text-slate-400 hover:bg-ink-800 md:hidden" aria-label="Voltar"><ArrowLeft className="h-4 w-4" /></button>
        <Avatar name={name} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-white">{name}</p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span>{formatPhone(conv.wa_id)}</span>
            {stage && <span className="flex items-center gap-1">· <span className="h-1.5 w-1.5 rounded-full" style={{ background: stage.color }} />{stage.name}</span>}
            {tagIds.map((id) => { const t = ws.tagById.get(id); return t ? <TagPill key={id} name={t.name} color={t.color} className="text-[10px]" /> : null; })}
          </div>
        </div>
        <CallButton conversationId={conv.id} name={name} phone={conv.wa_id} provider={provider} />
        {conv.lead_id && (
          <Button variant="outline" size="sm" onClick={() => onOpenLead(conv.lead_id!)}><UserRound className="h-3.5 w-3.5" /> Lead</Button>
        )}
      </header>

      <div ref={scroller} className="chat-bg flex-1 overflow-y-auto px-4 py-4 md:px-10"
        onScroll={(e) => { const el = e.currentTarget; stickToBottom.current = el.scrollTop + el.clientHeight > el.scrollHeight - 80; }}>
        {loading ? (
          <div className="flex h-full items-center justify-center"><Spinner /></div>
        ) : (
          <>
            {hasMore && <div className="mb-4 flex justify-center"><Button variant="secondary" size="sm" onClick={loadOlder}>Carregar mensagens anteriores</Button></div>}
            {grouped.map((g) => (
              <div key={g.day}>
                <div className="sticky top-0 z-10 my-3 flex justify-center">
                  <span className="rounded-md border border-line bg-ink-850/95 px-3 py-1 text-[11px] font-medium text-slate-400 backdrop-blur">{g.day}</span>
                </div>
                <div className="space-y-1.5">{g.items.map((m) => ("kind" in m ? <CallEntry key={`call-${m.id}`} c={m} /> : <Bubble key={m.id} m={m} />))}</div>
              </div>
            ))}
            {!messages.length && <p className="mt-10 text-center text-sm text-slate-500">Nenhuma mensagem ainda.</p>}
          </>
        )}
      </div>

      <footer className="border-t border-line bg-ink-900/80 p-3"
        onDragOver={(e) => { if (!windowClosed) e.preventDefault(); }}
        onDrop={(e) => { if (windowClosed) return; e.preventDefault(); pickFile(e.dataTransfer.files[0]); }}>
        {windowClosed ? (
          <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
            <Lock className="h-4 w-4 shrink-0 text-amber-300" />
            <p className="min-w-0 flex-1 text-sm text-amber-100">
              Janela de 24h encerrada. Pela regra da API oficial, só é possível enviar um <b>modelo aprovado</b> até o cliente responder.
            </p>
            <Button size="sm" variant="outline" onClick={() => setSchedOpen(true)}><CalendarClock className="h-3.5 w-3.5" /> Agendar</Button>
            <Button size="sm" onClick={() => setTplOpen(true)}><FileText className="h-3.5 w-3.5" /> Enviar modelo</Button>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl">
            {file && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-brand-400/30 bg-brand-500/10 px-3 py-2 text-sm">
                <Paperclip className="h-4 w-4 text-brand-300" />
                <span className="min-w-0 flex-1 truncate text-slate-100">{file.name}</span>
                <span className="text-xs text-slate-400">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                <button onClick={() => setFile(null)} className="rounded p-0.5 text-slate-400 hover:bg-ink-700 hover:text-white" aria-label="Remover arquivo"><X className="h-4 w-4" /></button>
              </div>
            )}
            {hoursLeft !== null && hoursLeft < 4 && (
              <p className="mb-2 text-xs text-amber-300">A janela de 24h da API oficial fecha em menos de {hoursLeft + 1}h.</p>
            )}
            <div className="relative flex items-end gap-2">
              {menuOpen && !file && (
                <QuickReplyMenu query={slashQuery ?? ""} activeIndex={qrIndex} onHover={setQrIndex} onPick={(q) => insertQuickReply(q.content)} />
              )}
              <button onClick={() => setQrOpen((v) => !v)} className={cn("mb-0.5 rounded-lg p-2.5 transition", menuOpen ? "bg-brand-500/20 text-brand-200" : "text-slate-400 hover:bg-ink-800 hover:text-brand-200")} title="Mensagens rápidas (/)" aria-label="Mensagens rápidas">
                <Zap className="h-5 w-5" />
              </button>
              <button onClick={() => fileInput.current?.click()} className="mb-0.5 rounded-lg p-2.5 text-slate-400 transition hover:bg-ink-800 hover:text-brand-200" title="Anexar foto, vídeo, áudio ou documento" aria-label="Anexar arquivo">
                <Paperclip className="h-5 w-5" />
              </button>
              <button onClick={() => setSchedOpen(true)} className="mb-0.5 rounded-lg p-2.5 text-slate-400 transition hover:bg-ink-800 hover:text-brand-200" title="Agendar mensagem para depois" aria-label="Agendar mensagem">
                <CalendarClock className="h-5 w-5" />
              </button>
              <input ref={fileInput} type="file" className="hidden"
                accept="image/jpeg,image/png,video/mp4,video/3gpp,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
              <textarea
                ref={inputRef}
                rows={1}
                value={text}
                onChange={(e) => { setText(e.target.value); setQrIndex(0); }}
                onKeyDown={onKeyDown}
                onPaste={(e) => { const f = e.clipboardData.files[0]; if (f) { e.preventDefault(); pickFile(f); } }}
                placeholder={file ? "Legenda (opcional)" : "Digite uma mensagem ou / para respostas rápidas"}
                maxLength={file ? 1024 : 4096}
                className="field h-auto min-h-[42px] flex-1 resize-none py-2.5 leading-5"
              />
              <Button size="icon" className="mb-0.5 h-[42px] w-[42px]" onClick={send} disabled={!text.trim() && !file} loading={sending} aria-label="Enviar">
                {!sending && <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}
      </footer>
      <ScheduleMessageModal open={schedOpen} onClose={() => setSchedOpen(false)} conversationId={conv.id} leadId={conv.lead_id} contactName={name} />
      <TemplateModal open={tplOpen} onClose={() => setTplOpen(false)} target={{ conversationId: conv.id }} channelId={conv.channel_id}
        defaultFirstParam={(conv.leads?.name ?? conv.contact_name ?? "").split(" ")[0]} />
    </div>
  );
}

function StatusIcon({ s }: { s: Message["status"] }) {
  if (s === "pending") return <Clock className="h-3 w-3" />;
  if (s === "failed") return <AlertCircle className="h-3 w-3 text-red-300" />;
  if (s === "sent") return <Check className="h-3 w-3" />;
  if (s === "delivered") return <CheckCheck className="h-3 w-3" />;
  if (s === "read") return <CheckCheck className="h-3 w-3 text-sky-300" />;
  return null;
}

function Bubble({ m }: { m: Message }) {
  const out = m.direction === "out";
  const time = new Date(m.sent_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const media = m.media_ref && !m.id.startsWith("tmp-") ? `/api/media/${m.id}` : null;
  return (
    <div className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-card md:max-w-[62%]",
        out ? "rounded-br-md bg-gradient-to-br from-brand-600 to-navy-500 text-white" : "rounded-bl-md border border-line bg-ink-800 text-slate-100")}>
        {media && m.type === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <a href={media} target="_blank" rel="noopener noreferrer"><img src={media} alt="Imagem" loading="lazy" className="mb-1 max-h-72 rounded-lg object-cover" /></a>
        )}
        {media && m.type === "sticker" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media} alt="Figurinha" loading="lazy" className="h-32 w-32 object-contain" />
        )}
        {media && m.type === "audio" && <audio controls preload="none" src={media} className="mb-1 h-10 w-64 max-w-full" />}
        {media && m.type === "video" && <video controls preload="none" src={media} className="mb-1 max-h-72 rounded-lg" />}
        {media && m.type === "document" && (
          <a href={media} target="_blank" rel="noopener noreferrer" className="mb-1 flex items-center gap-2 rounded-lg bg-black/20 p-2 hover:bg-black/30">
            <FileText className="h-5 w-5 shrink-0" /> <span className="truncate">{m.body ?? "Documento"}</span>
          </a>
        )}
        {m.type === "location" && <MapPin className="mb-1 h-4 w-4 opacity-70" />}
        {m.body && !(m.type === "document" && media) && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
        <div className={cn("mt-1 flex items-center justify-end gap-1 text-[10px]", out ? "text-blue-100/70" : "text-slate-500")}>
          {time} {out && <StatusIcon s={m.status} />}
        </div>
      </div>
    </div>
  );
}
