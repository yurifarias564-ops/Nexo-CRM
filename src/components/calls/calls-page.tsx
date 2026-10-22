"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, MessageCircle, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, Play, Search, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { LeadDrawer } from "@/components/lead/lead-drawer";
import { cn, formatPhone } from "@/lib/utils";
import { ANSWERED, CALL_COLUMNS, CALL_STATUS_LABEL, NOT_ANSWERED, periodStart, type CallPeriod } from "@/lib/calls-shared";
import { fmtDuration } from "./webrtc";

interface Row {
  id: string; direction: "out" | "in"; status: string; wa_id: string; contact_name: string | null; lead_id: string | null; conversation_id: string | null;
  started_by: string | null; answered_by: string | null; duration_s: number | null; recording_path: string | null; backup_path: string | null;
  recording_mode: string; created_at: string; started_at: string | null; ended_at: string | null; error: string | null;
}
const PAGE = 50;

/** Todas as ligações da empresa, com gravação — guardadas para sempre. */
export function CallsPage() {
  const ws = useWorkspace();
  const [period, setPeriod] = useState<CallPeriod>("30d");
  const [dir, setDir] = useState<"" | "out" | "in">("");
  const [st, setSt] = useState<"" | "answered" | "not">("");
  const [who, setWho] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [stats, setStats] = useState<{ total: number; answered: number; seconds: number } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [lead, setLead] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 350); return () => clearTimeout(t); }, [q]);

  const build = useCallback((cols: string) => {
    let s = supabaseBrowser().from("wa_calls").select(cols).eq("organization_id", ws.orgId);
    const from = periodStart(period);
    if (from) s = s.gte("created_at", from);
    if (dir) s = s.eq("direction", dir);
    if (st === "answered") s = s.in("status", ANSWERED);
    if (st === "not") s = s.in("status", NOT_ANSWERED);
    if (who) s = s.or(`started_by.eq.${who},answered_by.eq.${who}`);
    if (query) {
      const digits = query.replace(/\D/g, "");
      const safe = query.replace(/[%,()*]/g, " ").trim();
      s = s.or([safe && `contact_name.ilike.%${safe}%`, digits.length >= 4 && `wa_id.ilike.%${digits}%`].filter(Boolean).join(","));
    }
    return s;
  }, [ws.orgId, period, dir, st, who, query]);

  const load = useCallback(async (append = false, offset = 0) => {
    const { data, error } = await build(CALL_COLUMNS).order("created_at", { ascending: false }).range(offset, offset + PAGE - 1);
    if (error) return toast.error("Não foi possível carregar as ligações");
    const list = (data ?? []) as unknown as Row[];
    setRows((cur) => (append ? [...(cur ?? []), ...list] : list));
    setHasMore(list.length === PAGE);
  }, [build]);

  const loadStats = useCallback(async () => {
    const { data } = await build("status, duration_s").limit(10000);
    const list = (data ?? []) as unknown as { status: string; duration_s: number | null }[];
    setStats({ total: list.length, answered: list.filter((r) => ANSWERED.includes(r.status)).length, seconds: list.reduce((a, r) => a + (r.duration_s ?? 0), 0) });
  }, [build]);

  useEffect(() => {
    const t = setTimeout(() => { void load(); void loadStats(); }, 0);
    return () => clearTimeout(t);
  }, [load, loadStats]);

  // Ligação nova ou encerrada aparece sozinha
  useEffect(() => {
    const sb = supabaseBrowser();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ch = sb.channel(`calls-page-${ws.orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_calls", filter: `organization_id=eq.${ws.orgId}` }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => { void load(); void loadStats(); }, 800);
      }).subscribe();
    return () => { clearTimeout(timer); void sb.removeChannel(ch); };
  }, [ws.orgId, load, loadStats]);

  const member = useMemo(() => new Map(ws.members.map((m) => [m.user_id, m.full_name || m.email || "—"])), [ws.members]);
  const exportUrl = `/api/calls/export?${new URLSearchParams({ period, dir, st, who, q: query }).toString()}`;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white"><PhoneCall className="h-5 w-5 text-brand-300" /> Ligações</h2>
            <p className="mt-1 text-sm text-slate-400">Todas as ligações pelo WhatsApp, gravadas e guardadas para sempre.</p>
          </div>
          <a href={exportUrl} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-slate-200 hover:border-brand-400/40 hover:bg-ink-800"><Download className="h-4 w-4" /> Excel</a>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Ligações", stats ? stats.total.toLocaleString("pt-BR") : null],
            ["Atendidas", stats ? `${stats.answered.toLocaleString("pt-BR")}${stats.total ? ` · ${Math.round((100 * stats.answered) / stats.total)}%` : ""}` : null],
            ["Tempo falado", stats ? (stats.seconds >= 3600 ? `${Math.floor(stats.seconds / 3600)}h ${Math.round((stats.seconds % 3600) / 60)}min` : `${Math.round(stats.seconds / 60)} min`) : null],
            ["Duração média", stats ? (stats.answered ? fmtDuration(Math.round(stats.seconds / stats.answered)) : "—") : null],
          ].map(([l, v]) => (
            <div key={l} className="card p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{l}</p>
              <div className="mt-1.5 h-8 text-2xl font-semibold tabular-nums text-white">{v ?? <Spinner className="h-5 w-5" />}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input className="field pl-9" placeholder="Buscar cliente ou número" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="field w-auto" value={period} onChange={(e) => setPeriod(e.target.value as CallPeriod)} aria-label="Período">
            <option value="hoje">Hoje</option><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option><option value="mes">Este mês</option><option value="tudo">Todo o histórico</option>
          </select>
          <select className="field w-auto" value={dir} onChange={(e) => setDir(e.target.value as typeof dir)} aria-label="Direção">
            <option value="">Feitas e recebidas</option><option value="out">Feitas</option><option value="in">Recebidas</option>
          </select>
          <select className="field w-auto" value={st} onChange={(e) => setSt(e.target.value as typeof st)} aria-label="Situação">
            <option value="">Todas</option><option value="answered">Atendidas</option><option value="not">Não atendidas</option>
          </select>
          <select className="field w-auto" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Atendente">
            <option value="">Toda a equipe</option>{ws.members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>)}
          </select>
        </div>

        <div className="card overflow-hidden">
          {rows === null ? <div className="flex h-40 items-center justify-center"><Spinner /></div>
            : !rows.length ? (
              <div className="px-6 py-14 text-center">
                <PhoneCall className="mx-auto h-8 w-8 text-slate-600" />
                <p className="mt-3 font-medium text-slate-200">Nenhuma ligação {period === "tudo" ? "ainda" : "neste período"}</p>
                <p className="mt-1 text-sm text-slate-500">Use o botão “Ligar” dentro de uma conversa do WhatsApp oficial.</p>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((r) => {
                  const answered = ANSWERED.includes(r.status);
                  const live = ["starting", "ringing", "accepting", "connected"].includes(r.status);
                  const Icon = !answered && !live ? PhoneMissed : r.direction === "in" ? PhoneIncoming : PhoneOutgoing;
                  const name = r.contact_name || formatPhone(r.wa_id);
                  const person = r.direction === "out" ? r.started_by : r.answered_by;
                  const hasRec = !!(r.recording_path || r.backup_path);
                  const d = new Date(r.created_at);
                  return (
                    <li key={r.id} className="px-4 py-3 sm:px-5">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", answered ? "bg-emerald-500/15 text-emerald-300" : live ? "bg-brand-500/15 text-brand-200" : "bg-red-500/10 text-red-300")}><Icon className="h-4 w-4" /></span>
                        <div className="min-w-0 basis-[calc(100%-3rem)] sm:flex-1 sm:basis-auto">
                          <p className="truncate font-medium text-slate-100">{name}</p>
                          <p className="truncate text-xs text-slate-500">
                            {formatPhone(r.wa_id)} · {r.direction === "out" ? "feita" : "recebida"}{person ? ` por ${member.get(person) ?? "—"}` : ""}
                          </p>
                        </div>
                        <div className="ml-12 text-left sm:ml-0 sm:w-28 sm:text-right">
                          <p className="font-mono text-sm text-white">{r.duration_s ? fmtDuration(r.duration_s) : "—"}</p>
                          <p className={cn("text-[11px]", answered ? "text-emerald-300" : live ? "text-brand-200" : "text-red-300")}>{CALL_STATUS_LABEL[r.status] ?? r.status}</p>
                        </div>
                        <div className="text-xs text-slate-400 sm:w-24 sm:text-right">
                          <p>{d.toLocaleDateString("pt-BR")}</p><p>{d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
                        </div>
                        <div className="ml-auto flex items-center gap-1">
                          <button type="button" disabled={!hasRec} onClick={() => setPlaying(playing === r.id ? null : r.id)} title={hasRec ? "Ouvir gravação" : answered ? "Gravação chegando…" : "Sem gravação (não atendida)"}
                            className={cn("rounded-lg p-2 transition disabled:opacity-30", playing === r.id ? "bg-brand-500/20 text-brand-100" : "text-slate-300 hover:bg-ink-700")} aria-label="Ouvir gravação"><Play className="h-4 w-4" /></button>
                          {hasRec && <a href={`/api/calls/${r.id}/recording?download=1`} className="rounded-lg p-2 text-slate-300 hover:bg-ink-700" title="Baixar gravação" aria-label="Baixar gravação"><Download className="h-4 w-4" /></a>}
                          {r.conversation_id && <Link href={`/inbox?c=${r.conversation_id}`} className="rounded-lg p-2 text-slate-300 hover:bg-ink-700" title="Abrir conversa" aria-label="Abrir conversa"><MessageCircle className="h-4 w-4" /></Link>}
                          {r.lead_id && <button type="button" onClick={() => setLead(r.lead_id)} className="rounded-lg p-2 text-slate-300 hover:bg-ink-700" title="Abrir lead" aria-label="Abrir lead"><UserRound className="h-4 w-4" /></button>}
                        </div>
                      </div>
                      {playing === r.id && hasRec && (
                        <div className="mt-3 flex flex-wrap items-center gap-3 sm:pl-12">
                          <audio controls autoPlay src={`/api/calls/${r.id}/recording`} className="h-10 min-w-0 flex-1" />
                          {r.recording_path && r.backup_path && <a href={`/api/calls/${r.id}/recording?copia=1`} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-400 hover:text-slate-200">cópia do navegador</a>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          {hasMore && <div className="border-t border-line p-3 text-center"><Button variant="secondary" size="sm" onClick={() => void load(true, rows?.length ?? 0)}>Carregar mais</Button></div>}
        </div>
      </div>
      {lead && <LeadDrawer leadId={lead} onClose={() => setLead(null)} />}
    </div>
  );
}

