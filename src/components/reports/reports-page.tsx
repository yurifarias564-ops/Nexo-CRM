"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarRange, ChevronLeft, ChevronRight, Download, Eye, FileBarChart, Send } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { formatBRL } from "@/lib/utils";
import { currentPeriod, monthRange, periodLabel, shiftPeriod } from "@/lib/reports/period";
import { DEFAULT_TZ } from "@/lib/time";
import { GoalsCard } from "./goals-card";
import { TemplateLibrary } from "./template-library";
import { DeliveryCard, toInput, type SettingsInput } from "./delivery-card";
import { api, type Run, type Settings, type Template } from "./shared";

type Metrics = Record<string, number>;

const STATUS: Record<Run["status"], { label: string; cls: string }> = {
  generating: { label: "Gerando…", cls: "bg-brand-500/15 text-brand-200" },
  generated: { label: "Gerado", cls: "bg-slate-500/15 text-slate-300" },
  sent: { label: "Enviado", cls: "bg-emerald-500/15 text-emerald-300" },
  failed: { label: "Falhou", cls: "bg-red-500/15 text-red-300" },
};
const KIND: Record<Run["kind"], string> = { auto: "Automático", manual: "Enviado manualmente", preview: "Prévia" };

function browserTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ; } catch { return DEFAULT_TZ; }
}

export function ReportsPage() {
  const ws = useWorkspace();
  const [tz] = useState(browserTz);
  const [period, setPeriod] = useState(() => currentPeriod(browserTz()));
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [metrics, setMetrics] = useState<{ period: string; data: Metrics } | null>(null);
  const [generating, setGenerating] = useState<null | "preview" | "send">(null);

  const zone = settings?.time_zone ?? tz;
  const thisMonth = currentPeriod(zone);

  const loadSettings = useCallback(async () => {
    const sb = supabaseBrowser();
    const [s, t] = await Promise.all([
      sb.from("report_settings").select("*").eq("organization_id", ws.orgId).maybeSingle(),
      sb.from("report_templates").select("id, name, file_name, created_at, blueprint").order("created_at", { ascending: false }),
    ]);
    setSettings((s.data as Settings | null) ?? null);
    setTemplates((t.data ?? []) as Template[]);
    setSettingsLoaded(true);
  }, [ws.orgId]);

  const loadRuns = useCallback(async () => {
    const { data } = await supabaseBrowser().from("report_runs")
      .select("id, period, kind, status, summary, error, target_name, created_at, sent_at, pdf_path")
      .eq("organization_id", ws.orgId).order("created_at", { ascending: false }).limit(30);
    setRuns((data ?? []) as Run[]);
  }, [ws.orgId]);

  useEffect(() => {
    // Carga inicial: setState só nos callbacks (depois da resposta)
    const t = setTimeout(() => { void loadSettings(); void loadRuns(); }, 0);
    return () => clearTimeout(t);
  }, [loadSettings, loadRuns]);

  useEffect(() => {
    let alive = true;
    const r = monthRange(period, zone);
    void supabaseBrowser().rpc("report_metrics", { org: ws.orgId, p_from: r.from.toISOString(), p_to: r.to.toISOString() })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { toast.error("Não foi possível carregar os números do mês"); return; }
        const raw = (data ?? {}) as Record<string, unknown>;
        const n = (k: string) => Number(raw[k] ?? 0);
        setMetrics({ period, data: {
          new_leads: n("new_leads"), won_count: n("won_count"), won_value: n("won_value"), lost_count: n("lost_count"),
          calls: n("calls"), calls_answered: n("calls_answered"), scheduled_sent: n("scheduled_sent"),
          followups: n("calls") + n("scheduled_sent"), appointments: n("appointments"), appointments_held: n("appointments_held"),
        } });
      });
    return () => { alive = false; };
  }, [period, zone, ws.orgId]);

  const input = useMemo(() => toInput(settings, tz), [settings, tz]);

  async function saveSettings(next: SettingsInput): Promise<boolean> {
    try {
      await api("/api/reports/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      await loadSettings();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  }

  async function selectTemplate(t: Template) {
    if (await saveSettings({ ...input, templateId: t.id })) toast.success(`"${t.name}" será o modelo desta empresa`);
  }

  async function generate(send: boolean) {
    if (!settings?.template_id) return toast.error("Escolha um modelo de relatório primeiro");
    if (send && (!settings.channel_id || !settings.target_id)) return toast.error("Configure o WhatsApp e o destino do envio");
    if (send && !confirm(`Gerar o relatório de ${periodLabel(period)} e enviar agora para ${settings.target_name ?? "o destino configurado"}?`)) return;
    setGenerating(send ? "send" : "preview");
    const t = toast.loading("Escrevendo o relatório com IA… (até 1 minuto)");
    // Abre a aba antes da espera para o navegador não bloquear o pop-up
    const win = send ? null : window.open("about:blank", "_blank");
    try {
      const r = await api<{ runId: string; status: string }>("/api/reports/generate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period, send }),
      });
      toast.success(send ? "Relatório enviado no WhatsApp!" : "Prévia pronta", { id: t });
      if (win) win.location.href = `/api/reports/runs/${r.runId}/pdf`;
    } catch (e) {
      win?.close();
      toast.error((e as Error).message, { id: t });
    } finally {
      setGenerating(null);
      void loadRuns();
    }
  }

  const m = metrics?.period === period ? metrics.data : null;
  const selectedTemplate = templates.find((t) => t.id === settings?.template_id) ?? null;
  const missing = [
    !settings?.template_id && "modelo",
    !settings?.channel_id && "WhatsApp",
    !settings?.target_id && "destino",
  ].filter(Boolean) as string[];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white"><FileBarChart className="h-5 w-5 text-brand-300" /> Relatórios</h2>
            <p className="mt-1 text-sm text-slate-400">Relatório mensal de resultados para o cliente: leads, ligações, follow-ups, vendas e metas — com a explicação do porquê.</p>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-line bg-ink-900 p-1">
            <button type="button" onClick={() => setPeriod((p) => shiftPeriod(p, -1))} className="rounded-lg p-2 text-slate-400 hover:bg-ink-700 hover:text-white" aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /></button>
            <span className="flex min-w-[170px] items-center justify-center gap-2 text-sm font-medium text-white"><CalendarRange className="h-4 w-4 text-brand-300" />{periodLabel(period)}</span>
            <button type="button" onClick={() => setPeriod((p) => shiftPeriod(p, 1))} disabled={period >= thisMonth} className="rounded-lg p-2 text-slate-400 hover:bg-ink-700 hover:text-white disabled:opacity-30" aria-label="Próximo mês"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        {/* Números do mês */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {[
            ["Leads recebidos", m?.new_leads, null],
            ["Vendas", m?.won_count, m ? formatBRL(m.won_value ?? 0) : null],
            ["Conversão", m ? ((m.won_count ?? 0) + (m.lost_count ?? 0) > 0 ? `${Math.round(((m.won_count ?? 0) / ((m.won_count ?? 0) + (m.lost_count ?? 0))) * 100)}%` : "—") : undefined, m ? `${m.lost_count} perdidos` : null],
            ["Ligações", m?.calls, m ? `${m.calls_answered} atendidas` : null],
            ["Follow-ups", m?.followups, m ? `${m.scheduled_sent} automáticos` : null],
            ["Agendamentos", m?.appointments, m ? `${m.appointments_held} realizados` : null],
          ].map(([label, value, sub]) => (
            <div key={String(label)} className="card p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
              <div className="mt-1.5 h-8 text-2xl font-semibold tabular-nums text-white">{value === undefined ? <Spinner className="h-5 w-5" /> : typeof value === "number" ? value.toLocaleString("pt-BR") : value}</div>
              {sub && <p className="mt-0.5 truncate text-xs text-slate-400">{sub}</p>}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <GoalsCard period={period} actuals={m} loadingActuals={!m} />

            {/* Gerar agora */}
            <div className="card p-5">
              <h3 className="font-semibold text-white">Gerar relatório de {periodLabel(period)}</h3>
              <p className="mt-0.5 text-sm text-slate-400">
                {selectedTemplate ? <>Modelo: <b className="text-slate-200">{selectedTemplate.name}</b>. </> : settings?.template_name ? <>Modelo: <b className="text-slate-200">{settings.template_name}</b>. </> : null}
                Gere uma prévia para conferir antes, ou envie agora no WhatsApp.
              </p>
              {missing.length > 0 && settingsLoaded && (
                <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Falta configurar: {missing.join(", ")}.
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => generate(false)} loading={generating === "preview"} disabled={!ws.canManage || !!generating || !settings?.template_id}><Eye className="h-4 w-4" /> Gerar prévia (PDF)</Button>
                <Button onClick={() => generate(true)} loading={generating === "send"} disabled={!ws.canManage || !!generating || missing.length > 0}><Send className="h-4 w-4" /> Gerar e enviar agora</Button>
              </div>
              {!ws.canManage && <p className="mt-2 text-xs text-slate-500">Somente administradores geram e enviam relatórios.</p>}
            </div>
          </div>

          <div className="space-y-6">
            <TemplateLibrary templates={templates} selectedId={settings?.template_id ?? null} onSelect={selectTemplate} onChange={loadSettings} />
            {settingsLoaded
              ? <DeliveryCard key={settings?.organization_id ?? "new"} settings={input} onSave={(f) => saveSettings({ ...f, templateId: input.templateId })} />
              : <div className="card flex h-40 items-center justify-center"><Spinner /></div>}
          </div>
        </div>

        {/* Histórico */}
        <div className="card overflow-hidden">
          <div className="border-b border-line px-5 py-4"><h3 className="font-semibold text-white">Histórico</h3></div>
          {runs === null ? <div className="flex h-24 items-center justify-center"><Spinner /></div>
            : !runs.length ? <p className="px-5 py-8 text-center text-sm text-slate-500">Nenhum relatório gerado ainda.</p>
              : (
                <ul className="divide-y divide-line">
                  {runs.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                      <div className="w-36 shrink-0">
                        <p className="font-medium text-slate-100">{periodLabel(r.period.slice(0, 7))}</p>
                        <p className="text-xs text-slate-500">{new Date(r.sent_at ?? r.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                      <span className="text-xs text-slate-400">{KIND[r.kind]}{r.status === "sent" && r.target_name ? ` · ${r.target_name}` : ""}</span>
                      <p className="min-w-0 flex-1 truncate text-slate-400" title={r.error ?? r.summary ?? ""}>
                        {r.status === "failed" ? <span className="text-red-300">{r.error}</span> : r.summary}
                      </p>
                      {r.pdf_path && (
                        <div className="flex gap-1">
                          <a href={`/api/reports/runs/${r.id}/pdf`} target="_blank" rel="noopener noreferrer" className="rounded p-1.5 text-slate-400 hover:bg-ink-700 hover:text-white" aria-label="Abrir PDF" title="Abrir"><Eye className="h-4 w-4" /></a>
                          <a href={`/api/reports/runs/${r.id}/pdf?download=1`} className="rounded p-1.5 text-slate-400 hover:bg-ink-700 hover:text-white" aria-label="Baixar PDF" title="Baixar"><Download className="h-4 w-4" /></a>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
        </div>
      </div>
    </div>
  );
}
