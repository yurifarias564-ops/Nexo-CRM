"use client";
import { useMemo, useState } from "react";
import {
  Bell, Bot, Clock, DollarSign, Filter, GitBranch, Hourglass, KanbanSquare, MessageCircle, MessageSquareText, Sparkles, Split, StickyNote,
  Sun, Tag as TagIcon, UserRoundCog, Webhook, XCircle, Zap,
} from "lucide-react";
import { useWorkspace } from "@/components/workspace";
import { cn } from "@/lib/utils";
import { COND_LABEL, TRIGGER_LABEL, VARIABLES, type CondField, type Step, type Trigger } from "@/lib/automations/schema";

// Formulários e resumos dos blocos da automação (usados no canvas).

export const ZERO = "00000000-0000-0000-0000-000000000000";

export const STEP_ICON: Record<Step["type"], typeof Zap> = {
  send_message: MessageCircle, notify: Bell, wait: Clock, condition: Filter, move_stage: KanbanSquare, add_tag: TagIcon, remove_tag: TagIcon,
  assign: UserRoundCog, set_value: DollarSign, add_note: StickyNote, ai: Bot, webhook: Webhook,
  wait_reply: Hourglass, split: Split, wait_business: Sun, ai_message: Sparkles,
};
export const GROUP_COLOR: Record<string, string> = { Mensagens: "#22c55e", Lead: "#3b82f6", Fluxo: "#f59e0b", Integrações: "#a855f7" };

export function newStep(type: Step["type"], ws: ReturnType<typeof useWorkspace>): Step {
  switch (type) {
    case "send_message": return { type, text: "Olá, {{primeiro_nome}}! " };
    case "notify": return { type, phone: "", text: "Novo lead: {{nome}} ({{telefone}}) — etapa {{etapa}}" };
    case "wait": return { type, amount: 1, unit: "days" };
    case "condition": return { type, field: "business_hours", value: null };
    case "move_stage": return { type, stage_id: ws.stages[0]?.id ?? ZERO };
    case "add_tag": case "remove_tag": return { type, tag_id: ws.tags[0]?.id ?? ZERO };
    case "assign": return { type, mode: "round_robin", user_ids: ws.members.map((m) => m.user_id) };
    case "set_value": return { type, value: 0 };
    case "add_note": return { type, text: "" };
    case "ai": return { type, mode: "pause" };
    case "webhook": return { type, url: "https://" };
    case "wait_reply": return { type, amount: 1, unit: "days" };
    case "split": return { type, percent_a: 50 };
    case "wait_business": return { type };
    case "ai_message": return { type, instruction: "Retome a conversa de forma natural e pergunte se ainda tem interesse." };
  }
}

export function useNames() {
  const ws = useWorkspace();
  return useMemo(() => ({
    stage: (id: string | null | undefined) => (id === ZERO ? "escolha a etapa" : id ? ws.stageById.get(id)?.name ?? "etapa removida" : "qualquer etapa"),
    tag: (id: string) => ws.tagById.get(id)?.name ?? "escolha a tag",
    member: (id: string) => ws.memberById.get(id)?.full_name ?? ws.memberById.get(id)?.email ?? "vendedor",
  }), [ws]);
}

export function triggerSummary(t: Trigger): string {
  switch (t.type) {
    case "message_received": return t.keywords.length ? `Mensagem com: ${t.keywords.join(", ")}` : "Qualquer mensagem do cliente";
    case "idle": return `Lead parado há ${t.days} dia${t.days > 1 ? "s" : ""}`;
    default: return TRIGGER_LABEL[t.type].label;
  }
}

export function StepSummary({ s }: { s: Step }) {
  const n = useNames();
  switch (s.type) {
    case "send_message": case "add_note": return <>{s.text || "—"}</>;
    case "notify": return <>{s.phone || "escolha o número"} · {s.text}</>;
    case "wait": return <>{s.amount} {s.unit === "minutes" ? "minuto(s)" : s.unit === "hours" ? "hora(s)" : "dia(s)"}</>;
    case "condition": return <>o lead {COND_LABEL[s.field]} {s.field === "stage" ? n.stage(s.value) : s.field === "tag" || s.field === "no_tag" ? n.tag(s.value ?? "") : s.field === "assigned" ? n.member(s.value ?? "") : s.value ?? ""}</>;
    case "move_stage": return <>{n.stage(s.stage_id)}</>;
    case "add_tag": case "remove_tag": return <>{n.tag(s.tag_id)}</>;
    case "assign": return <>{s.mode === "round_robin" ? "Rodízio: " : ""}{s.user_ids.map(n.member).join(", ") || "escolha"}</>;
    case "set_value": return <>{s.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</>;
    case "ai": return <>{s.mode === "pause" ? "Pausar a IA" : s.mode === "resume" ? "Ligar a IA" : "Desligar a IA"} nesta conversa</>;
    case "webhook": return <>{s.url}</>;
    case "wait_reply": return <>até {s.amount} {s.unit === "minutes" ? "minuto(s)" : s.unit === "hours" ? "hora(s)" : "dia(s)"}</>;
    case "split": return <>A {s.percent_a}% · B {100 - s.percent_a}%</>;
    case "wait_business": return <>seg a sáb, 8h às 18h</>;
    case "ai_message": return <>{s.instruction}</>;
  }
}

const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block space-y-1"><span className="text-xs font-medium text-slate-400">{label}</span>{children}</label>
);

function StagePick({ value, onChange, any }: { value: string | null; onChange: (v: string | null) => void; any?: boolean }) {
  const ws = useWorkspace();
  return (
    <select className="field" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {any && <option value="">Qualquer etapa</option>}
      {!any && <option value={ZERO} disabled>Escolha a etapa</option>}
      {ws.pipelines.map((p) => (
        <optgroup key={p.id} label={p.name}>
          {ws.stages.filter((s) => s.pipeline_id === p.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}
function TagPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ws = useWorkspace();
  return (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value={ZERO} disabled>Escolha a tag</option>
      {ws.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}
function TextWithVars({ value, onChange, rows = 4 }: { value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <div className="space-y-1.5">
      <textarea className="field text-sm" rows={rows} maxLength={4000} value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="flex flex-wrap gap-1">{VARIABLES.map((v) => <button key={v} type="button" onClick={() => onChange(`${value}${v}`)} className="rounded-md bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] text-brand-200 hover:bg-ink-700">{v}</button>)}</div>
    </div>
  );
}

export function TriggerForm({ t, onChange }: { t: Trigger; onChange: (t: Trigger) => void }) {
  const [kw, setKw] = useState("");
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-1.5 sm:grid-cols-2">
        {(Object.keys(TRIGGER_LABEL) as Trigger["type"][]).map((k) => (
          <button key={k} onClick={() => onChange(
            k === "lead_created" ? { type: k, source: null } : k === "stage_changed" ? { type: k, stage_id: null } : k === "tag_added" ? { type: k, tag_id: ZERO }
              : k === "message_received" ? { type: k, keywords: [] } : k === "idle" ? { type: k, days: 3, stage_id: null } : { type: k })}
            className={cn("rounded-lg border px-3 py-2 text-left", t.type === k ? "border-amber-400/60 bg-amber-500/10" : "border-line hover:border-slate-500")}>
            <span className="block font-medium text-slate-100">{TRIGGER_LABEL[k].label}</span>
            <span className="block text-[11px] text-slate-500">{TRIGGER_LABEL[k].hint}</span>
          </button>
        ))}
      </div>
      {t.type === "lead_created" && <F label="Só leads com origem contendo (opcional)"><input className="field" placeholder="Ex.: WhatsApp, Instagram, Planilha" value={t.source ?? ""} onChange={(e) => onChange({ ...t, source: e.target.value || null })} /></F>}
      {t.type === "stage_changed" && <F label="Para a etapa"><StagePick any value={t.stage_id} onChange={(v) => onChange({ ...t, stage_id: v })} /></F>}
      {t.type === "tag_added" && <F label="Tag"><TagPick value={t.tag_id} onChange={(v) => onChange({ ...t, tag_id: v })} /></F>}
      {t.type === "message_received" && (
        <F label="Palavras-chave (vazio = qualquer mensagem)">
          <div className="flex flex-wrap gap-1.5">
            {t.keywords.map((k) => <span key={k} className="inline-flex items-center gap-1 rounded-full bg-ink-700 px-2 py-0.5 text-xs">{k}<button onClick={() => onChange({ ...t, keywords: t.keywords.filter((x) => x !== k) })}><XCircle className="h-3 w-3" /></button></span>)}
          </div>
          <input className="field mt-1.5" placeholder="Digite e aperte Enter (ex.: preço)" value={kw} onChange={(e) => setKw(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && kw.trim()) { e.preventDefault(); onChange({ ...t, keywords: [...new Set([...t.keywords, kw.trim()])].slice(0, 20) }); setKw(""); } }} />
        </F>
      )}
      {t.type === "idle" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <F label="Parado há (dias)"><input type="number" min={1} max={180} className="field" value={t.days} onChange={(e) => onChange({ ...t, days: Math.min(180, Math.max(1, Number(e.target.value) || 1)) })} /></F>
          <F label="Na etapa"><StagePick any value={t.stage_id} onChange={(v) => onChange({ ...t, stage_id: v })} /></F>
        </div>
      )}
    </div>
  );
}

export function StepForm({ s, onChange, assinatura }: { s: Step; onChange: (s: Step) => void; assinatura?: string }) {
  const ws = useWorkspace();
  switch (s.type) {
    case "send_message": return <F label="Mensagem para o cliente"><TextWithVars value={s.text} onChange={(text) => onChange({ ...s, text })} /></F>;
    case "add_note": return <F label="Anotação (aparece no histórico do lead)"><TextWithVars rows={2} value={s.text} onChange={(text) => onChange({ ...s, text })} /></F>;
    case "notify": return (
      <div className="space-y-2">
        <F label="WhatsApp de quem recebe o aviso (DDI + DDD + número)"><input className="field" inputMode="tel" placeholder="5585999990000" value={s.phone} onChange={(e) => onChange({ ...s, phone: e.target.value.replace(/\D/g, "") })} /></F>
        <F label="Mensagem"><TextWithVars rows={2} value={s.text} onChange={(text) => onChange({ ...s, text })} /></F>
      </div>
    );
    case "wait": return (
      <div className="flex gap-2">
        <input type="number" min={1} max={365} className="field w-24" value={s.amount} onChange={(e) => onChange({ ...s, amount: Math.min(365, Math.max(1, Number(e.target.value) || 1)) })} />
        <select className="field" value={s.unit} onChange={(e) => onChange({ ...s, unit: e.target.value as typeof s.unit })}>
          <option value="minutes">minutos</option><option value="hours">horas</option><option value="days">dias</option>
        </select>
      </div>
    );
    case "condition": return (
      <div className="space-y-2">
        <F label="Continuar só se o lead…">
          <select className="field" value={s.field} onChange={(e) => onChange({ ...s, field: e.target.value as CondField, value: null })}>
            {(Object.keys(COND_LABEL) as CondField[]).map((k) => <option key={k} value={k}>{COND_LABEL[k]}</option>)}
          </select>
        </F>
        {s.field === "stage" && <StagePick value={s.value ?? ZERO} onChange={(v) => onChange({ ...s, value: v })} />}
        {(s.field === "tag" || s.field === "no_tag") && <TagPick value={s.value ?? ZERO} onChange={(v) => onChange({ ...s, value: v })} />}
        {s.field === "assigned" && (
          <select className="field" value={s.value ?? ""} onChange={(e) => onChange({ ...s, value: e.target.value })}>
            <option value="" disabled>Escolha</option>{ws.members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name ?? m.email}</option>)}
          </select>
        )}
        {(s.field === "value_gte" || s.field === "value_lte") && <input type="number" min={0} className="field" value={s.value ?? ""} onChange={(e) => onChange({ ...s, value: e.target.value })} />}
        {(s.field === "source" || s.field === "last_message_contains") && <input className="field" placeholder={s.field === "source" ? "Ex.: Instagram" : "Palavras separadas por vírgula"} value={s.value ?? ""} onChange={(e) => onChange({ ...s, value: e.target.value })} />}
        <p className="text-[11px] text-slate-500"><GitBranch className="mr-1 inline h-3 w-3" />Ligue as saídas <b className="text-emerald-300">Sim</b> e <b className="text-red-300">Não</b> no canvas. Saída sem ligação = o fluxo termina ali.</p>
      </div>
    );
    case "move_stage": return <F label="Mover para"><StagePick value={s.stage_id} onChange={(v) => onChange({ ...s, stage_id: v ?? ZERO })} /></F>;
    case "add_tag": case "remove_tag": return <F label="Tag"><TagPick value={s.tag_id} onChange={(v) => onChange({ ...s, tag_id: v })} /></F>;
    case "assign": return (
      <div className="space-y-2">
        <div className="flex gap-2 text-xs">
          {(["round_robin", "fixed"] as const).map((m) => <button key={m} onClick={() => onChange({ ...s, mode: m })} className={cn("rounded-full border px-3 py-1", s.mode === m ? "border-brand-400/60 bg-brand-500/15 text-brand-100" : "border-line text-slate-400")}>{m === "round_robin" ? "Rodízio (um por vez)" : "Sempre o mesmo"}</button>)}
        </div>
        <div className="space-y-1">
          {ws.members.map((m) => (
            <label key={m.user_id} className="flex items-center gap-2 text-sm text-slate-200">
              <input type={s.mode === "fixed" ? "radio" : "checkbox"} name="assign" checked={s.user_ids.includes(m.user_id)}
                onChange={(e) => onChange({ ...s, user_ids: s.mode === "fixed" ? [m.user_id] : e.target.checked ? [...s.user_ids, m.user_id] : s.user_ids.filter((u) => u !== m.user_id) })} />
              {m.full_name ?? m.email} <span className="text-xs text-slate-500">{m.role === "agent" ? "vendedor" : m.role === "owner" ? "dono" : "admin"}</span>
            </label>
          ))}
        </div>
      </div>
    );
    case "set_value": return <F label="Valor (R$)"><input type="number" min={0} className="field" value={s.value} onChange={(e) => onChange({ ...s, value: Math.max(0, Number(e.target.value) || 0) })} /></F>;
    case "ai": return (
      <select className="field" value={s.mode} onChange={(e) => onChange({ ...s, mode: e.target.value as typeof s.mode })}>
        <option value="pause">Pausar a IA (um vendedor assume)</option><option value="resume">Ligar a IA nesta conversa</option><option value="off">Desligar a IA nesta conversa</option>
      </select>
    );
    case "wait_reply": return (
      <div className="space-y-2">
        <p className="text-xs text-slate-400">Espera o cliente responder por até:</p>
        <div className="flex gap-2">
          <input type="number" min={1} max={365} className="field w-24" value={s.amount} onChange={(e) => onChange({ ...s, amount: Math.min(365, Math.max(1, Number(e.target.value) || 1)) })} />
          <select className="field" value={s.unit} onChange={(e) => onChange({ ...s, unit: e.target.value as typeof s.unit })}>
            <option value="minutes">minutos</option><option value="hours">horas</option><option value="days">dias</option>
          </select>
        </div>
        <p className="text-[11px] text-slate-500">Se responder, segue pela saída <b className="text-emerald-300">Respondeu</b> na hora. Se o tempo acabar, segue por <b className="text-amber-300">Não respondeu</b>.</p>
      </div>
    );
    case "split": return (
      <div className="space-y-2">
        <F label={`Caminho A: ${s.percent_a}% dos leads · Caminho B: ${100 - s.percent_a}%`}>
          <input type="range" min={1} max={99} value={s.percent_a} onChange={(e) => onChange({ ...s, percent_a: Number(e.target.value) })} className="w-full" />
        </F>
        <p className="text-[11px] text-slate-500">Teste duas mensagens ou dois caminhos e veja nas execuções qual converte mais.</p>
      </div>
    );
    case "wait_business": return <p className="text-xs text-slate-400">Se estiver fora do horário comercial (seg a sáb, 8h às 18h), espera abrir para continuar. Bom antes de mandar mensagem.</p>;
    case "ai_message": return (
      <div className="space-y-2">
        <F label="O que a IA deve escrever">
          <TextWithVars rows={3} value={s.instruction} onChange={(instruction) => onChange({ ...s, instruction })} />
        </F>
        <p className="text-[11px] text-slate-500"><Sparkles className="mr-1 inline h-3 w-3" />A IA lê a conversa, segue as instruções e as regras do Agente de IA e escreve uma mensagem personalizada para cada cliente. Usa a mesma IA e chave do Agente.</p>
      </div>
    );
    case "webhook": return (
      <div className="space-y-1.5">
        <F label="Endereço do webhook (n8n, Make, Zapier…)"><input className="field font-mono text-xs" value={s.url} onChange={(e) => onChange({ ...s, url: e.target.value.trim() })} /></F>
        <p className="text-[11px] text-slate-500"><MessageSquareText className="mr-1 inline h-3 w-3" />Envia um POST com nome, telefone, valor, etapa, origem, responsável e tags do lead. Cabeçalho <code>x-nexo-signature</code> (HMAC-SHA256 do corpo) para conferir a origem.</p>
        <p className="text-[11px] text-slate-500">Chave da assinatura: {assinatura ? <code className="select-all text-slate-300">{assinatura}</code> : "salve a automação para ver a chave"}. Endereços de rede interna são bloqueados.</p>
      </div>
    );
  }
}

