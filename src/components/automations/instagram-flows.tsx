"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, AtSign as Instagram, CalendarClock, ExternalLink, MessageCircle, Plus, Trash2, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal, Spinner } from "@/components/ui/misc";
import { cn, relativeTime } from "@/lib/utils";
import { POST_STATUS_LABEL, type IgFlowRow } from "@/lib/ig-flows";
import { InstagramFlowEditor } from "./instagram-flow-editor";

export interface IgChannelInfo { id: string; username: string | null; connected: boolean; canComments: boolean; canPublish: boolean }
type Stat = { started: number; done: number; blocked: number };
type Data = { flows: IgFlowRow[]; stats: Record<string, Stat>; channels: IgChannelInfo[] };
type Run = { id: string; username: string | null; step: number; status: string; follow_blocks: number; error: string | null; updated_at: string };

const CONNECT = "/api/instagram/connect?full=1";
export const fmtDate = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "");

export function InstagramFlows() {
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState<IgFlowRow | "new" | null>(null);
  const [runsOf, setRunsOf] = useState<IgFlowRow | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/ig-flows", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return toast.error(j.error ?? "Não consegui carregar");
    setData(j);
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    const ig = new URLSearchParams(window.location.search).get("ig");
    if (ig === "ok") toast.success("Instagram conectado com as permissões de automação");
    else if (ig) toast.error("Não consegui conectar o Instagram. Tente de novo.");
  }, []);
  // Enquanto houver publicação saindo, atualiza sozinho
  const live = data?.flows.some((f) => f.post_status === "processing" || f.post_status === "scheduled");
  useEffect(() => {
    if (!live || editing) return;
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, [live, editing, load]);

  async function toggle(f: IgFlowRow) {
    const r = await fetch(`/api/ig-flows/${f.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !f.enabled }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return toast.error(j.error ?? "Não deu certo");
    toast.success(!f.enabled ? "Automação ligada" : "Automação desligada");
    void load();
  }
  async function remove(f: IgFlowRow) {
    if (!confirm(`Excluir a automação "${f.name}"?${f.post_status === "scheduled" ? " A publicação agendada não vai sair." : ""}`)) return;
    const r = await fetch(`/api/ig-flows/${f.id}`, { method: "DELETE" });
    if (!r.ok) return toast.error((await r.json().catch(() => ({}))).error ?? "Não deu certo");
    void load();
  }

  if (!data) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (editing) return <InstagramFlowEditor initial={editing === "new" ? null : editing} channels={data.channels} onClose={() => { setEditing(null); void load(); }} />;

  const ok = data.channels.filter((c) => c.connected);
  const missing = ok.filter((c) => !c.canComments || !c.canPublish);
  return (
    <div className="space-y-4">
      {!ok.length ? (
        <div className="rounded-2xl border border-dashed border-line p-8 text-center">
          <Instagram className="mx-auto h-10 w-10 text-brand-300" />
          <p className="mt-3 font-semibold text-white">Conecte seu Instagram</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">Precisa ser conta profissional (comercial ou criador). Na tela do Instagram, deixe todas as permissões marcadas.</p>
          <a href={CONNECT} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-400"><Instagram className="h-4 w-4" /> Conectar Instagram</a>
        </div>
      ) : (
        <>
          {missing.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-300" />
              <p className="min-w-0 flex-1">@{missing[0]!.username} está conectado só para o Direct. Para agendar publicação e responder comentário, libere as permissões de automação (leva 1 minuto).</p>
              <a href={CONNECT} className="inline-flex h-9 items-center rounded-lg bg-amber-400 px-3 text-sm font-semibold text-amber-950 hover:bg-amber-300">Liberar automações</a>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-slate-400">Agende a publicação, escolha a palavra do comentário e monte a conversa de botões que acontece no Direct.</p>
            <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Nova automação do Instagram</Button>
          </div>
          {!data.flows.length ? (
            <div className="rounded-2xl border border-dashed border-line p-10 text-center">
              <MessageCircle className="mx-auto h-10 w-10 text-brand-300" />
              <p className="mt-3 font-semibold text-white">Nenhuma automação do Instagram ainda</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">Exemplo: quem comentar “QUERO” recebe uma mensagem no Direct, toca nos botões e, se estiver te seguindo, recebe o link.</p>
              <Button className="mt-4" onClick={() => setEditing("new")}>Criar a primeira</Button>
            </div>
          ) : (
            <ul className="space-y-3">
              {data.flows.map((f) => {
                const s = data.stats[f.id] ?? { started: 0, done: 0, blocked: 0 };
                const ch = data.channels.find((c) => c.id === f.channel_id);
                return (
                  <li key={f.id} className="rounded-xl border border-line bg-ink-900 p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <button role="switch" aria-checked={f.enabled} onClick={() => void toggle(f)} title={f.enabled ? "Desligar" : "Ligar"}
                        className={cn("h-5 w-9 shrink-0 rounded-full p-0.5 transition", f.enabled ? "bg-emerald-500" : "bg-ink-600")}>
                        <span className={cn("block h-4 w-4 rounded-full bg-white transition", f.enabled && "translate-x-4")} />
                      </button>
                      <button onClick={() => setEditing(f)} className="min-w-0 flex-1 text-left">
                        <p className="truncate font-medium text-white">{f.name}</p>
                        <p className="truncate text-xs text-slate-400">
                          @{ch?.username ?? "instagram"} · {f.keywords.length ? `comentário com ${f.keywords.map((k) => `“${k}”`).join(" ou ")}` : "qualquer comentário"} · {f.steps.length + 1} mensagens
                        </p>
                      </button>
                      <PostBadge f={f} />
                    </div>
                    {f.post_status === "failed" && f.post_error && <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-200">Publicação: {f.post_error}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-xs text-slate-400">
                      <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{s.started} entraram</span>
                      <span className="inline-flex items-center gap-1 text-emerald-300"><UserCheck className="h-3.5 w-3.5" />{s.done} chegaram ao link</span>
                      {s.blocked > 0 && <span className="text-amber-300">{s.blocked} pararam por não seguir</span>}
                      <div className="ml-auto flex items-center gap-1">
                        {f.post_permalink && <a href={f.post_permalink} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-slate-300 hover:bg-ink-800"><ExternalLink className="h-3.5 w-3.5" /> Ver publicação</a>}
                        <Button size="sm" variant="ghost" onClick={() => setRunsOf(f)}>Quem entrou</Button>
                        <Button size="sm" variant="outline" onClick={() => setEditing(f)}>Editar</Button>
                        <button onClick={() => void remove(f)} className="rounded-md p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-300" aria-label="Excluir"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {runsOf && <Runs flow={runsOf} onClose={() => setRunsOf(null)} />}
    </div>
  );
}

function PostBadge({ f }: { f: IgFlowRow }) {
  if (f.post_mode === "any") return <span className="rounded-full bg-ink-700 px-2.5 py-0.5 text-xs text-slate-300">Qualquer publicação</span>;
  if (f.post_mode === "existing") return <span className="rounded-full bg-ink-700 px-2.5 py-0.5 text-xs text-slate-300">Publicação escolhida</span>;
  const style = { none: "bg-ink-700 text-slate-400", scheduled: "bg-sky-500/15 text-sky-300", processing: "bg-brand-500/20 text-brand-200", published: "bg-emerald-500/15 text-emerald-300", failed: "bg-red-500/15 text-red-300", canceled: "bg-ink-700 text-slate-400" }[f.post_status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", style)}>
      <CalendarClock className="h-3.5 w-3.5" />
      {f.post_status === "scheduled" && f.post_at ? `Publica ${fmtDate(f.post_at)}` : f.post_status === "published" && f.published_at ? `Publicada ${fmtDate(f.published_at)}` : f.post_status === "none" ? "Publicação não agendada" : POST_STATUS_LABEL[f.post_status]}
    </span>
  );
}

function Runs({ flow, onClose }: { flow: IgFlowRow; onClose: () => void }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch(`/api/ig-flows/${flow.id}`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (alive) setRuns(j.runs ?? []); });
    return () => { alive = false; };
  }, [flow.id]);
  const total = flow.steps.length + 1;
  return (
    <Modal open onClose={onClose} title={`Quem entrou em "${flow.name}"`} wide>
      {!runs ? <div className="flex justify-center py-10"><Spinner /></div> : !runs.length ? (
        <p className="py-8 text-center text-sm text-slate-500">Ninguém comentou ainda.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {runs.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-slate-100">{r.username ? `@${r.username}` : "Pessoa do Instagram"}</span>
              {r.follow_blocks > 0 && r.status !== "done" && <span className="text-xs text-amber-300">não segue</span>}
              <span className={cn("rounded-full px-2 py-0.5 text-xs", r.status === "done" ? "bg-emerald-500/15 text-emerald-300" : r.status === "failed" ? "bg-red-500/15 text-red-300" : "bg-ink-700 text-slate-300")}>
                {r.status === "done" ? "Recebeu o link" : r.status === "failed" ? "Falhou" : `Mensagem ${Math.min(r.step + 1, total)} de ${total}`}
              </span>
              <span className="w-24 shrink-0 text-right text-xs text-slate-500">{relativeTime(r.updated_at)}</span>
            </li>
          ))}
        </ul>
      )}
      {runs?.some((r) => r.status === "failed" && r.error) && <p className="mt-3 text-xs text-red-300">Última falha: {runs.find((r) => r.status === "failed" && r.error)?.error}</p>}
    </Modal>
  );
}

export function BackLink({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white"><ArrowLeft className="h-4 w-4" /> Voltar às automações do Instagram</button>;
}
