"use client";
import { useEffect, useState } from "react";
import { RefreshCw, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import type { Channel } from "@/lib/types";
import { api, type Settings } from "./shared";

type Group = { id: string; subject: string; size: number | null };
export type SettingsInput = {
  enabled: boolean; templateId: string | null; channelId: string | null; targetType: "group" | "phone" | null;
  targetId: string | null; targetName: string | null; sendHour: number; timeZone: string; caption: string | null;
};

export function toInput(s: Settings | null, tz: string): SettingsInput {
  return {
    enabled: s?.enabled ?? false, templateId: s?.template_id ?? null, channelId: s?.channel_id ?? null, targetType: s?.target_type ?? null,
    targetId: s?.target_id ?? null, targetName: s?.target_name ?? null, sendHour: s?.send_hour ?? 18, timeZone: s?.time_zone ?? tz, caption: s?.caption ?? null,
  };
}

/** Para onde e a que horas o relatório sai no último dia do mês. */
export function DeliveryCard({ settings, onSave }: { settings: SettingsInput; onSave: (s: SettingsInput) => Promise<boolean> }) {
  const ws = useWorkspace();
  const [form, setForm] = useState(settings);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [groupsFor, setGroupsFor] = useState<string | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    void supabaseBrowser().from("whatsapp_channels").select("*").eq("organization_id", ws.orgId).order("created_at")
      .then(({ data }) => setChannels((data ?? []) as Channel[]));
  }, [ws.orgId]);

  const channel = channels?.find((c) => c.id === form.channelId) ?? null;
  const canGroup = channel?.provider === "evolution";
  const set = (p: Partial<SettingsInput>) => setForm((f) => ({ ...f, ...p }));

  async function loadGroups(id: string) {
    setLoadingGroups(true);
    try {
      const r = await api<{ groups: Group[]; unsupported?: boolean }>(`/api/channels/${id}/groups`);
      setGroups(r.groups);
      setGroupsFor(id);
    } catch (e) {
      toast.error((e as Error).message);
      setGroups([]);
      setGroupsFor(id);
    } finally {
      setLoadingGroups(false);
    }
  }

  function pickChannel(id: string) {
    const ch = channels?.find((c) => c.id === id);
    set({ channelId: id || null, ...(ch?.provider !== "evolution" && form.targetType === "group" ? { targetType: "phone", targetId: null, targetName: null } : {}) });
    setGroups(null);
    setGroupsFor(null);
  }

  async function save() {
    setSaving(true);
    const okSaved = await onSave(form);
    setSaving(false);
    if (okSaved) toast.success(form.enabled ? "Envio automático ativado" : "Configuração salva");
  }

  const disabled = !ws.canManage;
  const shownGroups = (groups ?? []).filter((g) => !filter || g.subject.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white">Envio automático</h3>
          <p className="mt-0.5 text-sm text-slate-400">No último dia de cada mês (30 ou 31; 28/29 em fevereiro), o relatório é gerado e enviado em PDF no WhatsApp.</p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-slate-300">
          <span>{form.enabled ? "Ativo" : "Desativado"}</span>
          <button type="button" role="switch" aria-checked={form.enabled} disabled={disabled} onClick={() => set({ enabled: !form.enabled })}
            className={cn("relative h-6 w-11 rounded-full transition", form.enabled ? "bg-brand-500" : "bg-ink-600")}>
            <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", form.enabled ? "left-[22px]" : "left-0.5")} />
          </button>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">WhatsApp que envia</span>
          <select className="field" value={form.channelId ?? ""} disabled={disabled || !channels} onChange={(e) => pickChannel(e.target.value)}>
            <option value="">{channels && !channels.length ? "Nenhum WhatsApp conectado" : "Escolha…"}</option>
            {channels?.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.provider === "evolution" ? "QR Code" : "API oficial"}{c.status !== "connected" ? " (desconectado)" : ""}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Horário de envio</span>
          <select className="field" value={form.sendHour} disabled={disabled} onChange={(e) => set({ sendHour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00 ({form.timeZone.split("/").pop()?.replace("_", " ")})</option>)}
          </select>
        </label>
      </div>

      <div className="mt-4">
        <span className="label">Enviar para</span>
        <div className="flex gap-1 rounded-lg border border-line bg-ink-900 p-1 text-sm">
          {(["group", "phone"] as const).map((k) => (
            <button key={k} type="button" disabled={disabled || (k === "group" && !!channel && !canGroup)}
              onClick={() => set({ targetType: k, targetId: null, targetName: null })}
              className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 font-medium transition disabled:opacity-40", form.targetType === k ? "bg-ink-700 text-white" : "text-slate-400 hover:text-slate-200")}>
              {k === "group" ? <><Users className="h-3.5 w-3.5" /> Grupo do cliente</> : <><Send className="h-3.5 w-3.5" /> Número</>}
            </button>
          ))}
        </div>
        {channel && !canGroup && <p className="mt-1.5 text-xs text-amber-300/90">A API oficial do WhatsApp não envia para grupos. Use um número conectado por QR Code para mandar no grupo.</p>}

        {form.targetType === "group" && (
          <div className="mt-3">
            {form.targetId && <p className="mb-2 text-sm text-slate-300">Selecionado: <b className="text-white">{form.targetName ?? form.targetId}</b></p>}
            {!form.channelId ? <p className="text-sm text-slate-500">Escolha o WhatsApp primeiro.</p>
              : groupsFor !== form.channelId ? (
                <Button size="sm" variant="outline" disabled={disabled} loading={loadingGroups} onClick={() => loadGroups(form.channelId!)}><Users className="h-3.5 w-3.5" /> {form.targetId ? "Trocar grupo" : "Escolher grupo"}</Button>
              ) : (
                <div className="rounded-xl border border-line bg-ink-850">
                  <div className="flex items-center gap-2 border-b border-line p-2">
                    <input className="field h-8" placeholder="Buscar grupo…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                    <button type="button" onClick={() => loadGroups(form.channelId!)} className="rounded p-1.5 text-slate-400 hover:bg-ink-700" aria-label="Recarregar grupos">
                      {loadingGroups ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
                    </button>
                  </div>
                  <ul className="max-h-56 overflow-y-auto p-1">
                    {shownGroups.map((g) => (
                      <li key={g.id}>
                        <button type="button" onClick={() => set({ targetId: g.id, targetName: g.subject })}
                          className={cn("flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm", form.targetId === g.id ? "bg-brand-500/15 text-brand-100" : "text-slate-300 hover:bg-ink-700")}>
                          <span className="truncate">{g.subject}</span>
                          {g.size !== null && <span className="ml-2 shrink-0 text-xs text-slate-500">{g.size} pessoas</span>}
                        </button>
                      </li>
                    ))}
                    {!shownGroups.length && <li className="px-3 py-4 text-center text-sm text-slate-500">{groups?.length ? "Nenhum grupo com esse nome" : "Nenhum grupo encontrado neste número"}</li>}
                  </ul>
                </div>
              )}
          </div>
        )}

        {form.targetType === "phone" && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Número (com DDI e DDD)</span>
              <input className="field" inputMode="tel" placeholder="55 11 99999-9999" disabled={disabled} value={form.targetId ?? ""} onChange={(e) => set({ targetId: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">Nome do contato</span>
              <input className="field" placeholder="Ex.: João (dono)" disabled={disabled} maxLength={200} value={form.targetName ?? ""} onChange={(e) => set({ targetName: e.target.value })} />
            </label>
          </div>
        )}
      </div>

      <label className="mt-4 block">
        <span className="label">Mensagem que acompanha o PDF (opcional)</span>
        <textarea className="field min-h-[72px]" maxLength={1000} disabled={disabled} value={form.caption ?? ""} onChange={(e) => set({ caption: e.target.value })}
          placeholder="Ex.: Bom dia, pessoal! Segue o relatório do mês 👇" />
        <span className="mt-1 block text-xs text-slate-500">A IA também escreve um resumo curto do mês logo abaixo da sua mensagem.</span>
      </label>

      {ws.canManage && <div className="mt-4 flex justify-end"><Button onClick={save} loading={saving}>Salvar envio</Button></div>}
    </div>
  );
}
