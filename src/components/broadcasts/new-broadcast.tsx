"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Clock3, FileText, Image as ImageIcon, Mic, Paperclip, Plus, Video, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { useWorkspace } from "@/components/workspace";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { DEFAULT_TZ } from "@/lib/time";
import { durationLabel, formatMoney, idleLabel, META_BR_RATES, PACES, renderVars, type Audience, type CostEstimate, type TemplateParam } from "@/lib/broadcasts";
import { NewTemplateModal } from "./new-template";
import { AudienceBuilder, type PickedLead } from "./audience-builder";

type Channel = { id: string; name: string; provider: "meta" | "zapi" | "evolution"; status: string; phone_number: string | null };
export type Tpl = {
  id: string; name: string; language: string; category: string; status: string; rejectedReason: string | null;
  header: { format: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT"; text?: string } | null; body: string; footer: string | null;
  buttons: { type: string; text: string }[]; params: number; sendable: boolean;
};
type Preview = { provider: string; count: number; overLimit: boolean; sample: { id: string; name: string | null; phone: string }[]; cost: CostEstimate | null; category: string | null };

const STEPS = ["Público", "Mensagem", "Quando", "Revisar"] as const;
const MAX_MB = 16;

function kindOf(f: File) {
  if (/^image\/(jpeg|png)$/.test(f.type)) return "image";
  if (/^video\/(mp4|3gpp)$/.test(f.type)) return "video";
  if (/^audio\//.test(f.type)) return "audio";
  return "document";
}
const KIND_ICON = { image: ImageIcon, video: Video, audio: Mic, document: FileText } as const;

function localNowPlus(min: number) {
  const d = new Date(Date.now() + min * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function NewBroadcast({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const ws = useWorkspace();
  const [step, setStep] = useState(0);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [channelId, setChannelId] = useState("");
  const [aud, setAud] = useState<Audience>({ tagIds: [], stageIds: [], idle: null, leadIds: [], excludeLeadIds: [] });
  const [picked, setPicked] = useState<PickedLead[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [templates, setTemplates] = useState<Tpl[] | null>(null);
  const [tplKey, setTplKey] = useState("");
  const [params, setParams] = useState<TemplateParam[]>([]);
  const [headerFile, setHeaderFile] = useState<File | null>(null);
  const [newTpl, setNewTpl] = useState(false);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [sendAt, setSendAt] = useState(localNowPlus(60));
  const [pace, setPace] = useState<number>(PACES[0].seconds);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const ch = channels?.find((c) => c.id === channelId) ?? null;
  const isMeta = ch?.provider === "meta";
  const tpl = templates?.find((t) => `${t.name}|${t.language}` === tplKey) ?? null;
  const hasCriteria = aud.tagIds.length + aud.stageIds.length + aud.leadIds.length > 0 || aud.idle !== null;

  useEffect(() => {
    void (async () => {
      const { data } = await supabaseBrowser().from("whatsapp_channels").select("id, name, provider, status, phone_number").neq("provider", "instagram").order("created_at");
      const list = (data ?? []) as Channel[];
      setChannels(list);
      const first = list.find((c) => c.status === "connected");
      if (first) setChannelId(first.id);
    })();
  }, []);

  // Modelos do número oficial
  useEffect(() => {
    if (!isMeta || !channelId) return;
    let alive = true;
    void (async () => {
      setTemplates(null);
      const r = await fetch(`/api/broadcasts/templates?channelId=${channelId}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!alive) return;
      if (!r.ok) { toast.error(j.error ?? "Não consegui buscar os modelos"); setTemplates([]); return; }
      setTemplates(j.templates);
    })();
    return () => { alive = false; };
  }, [isMeta, channelId, newTpl]);

  // Prévia do público (e custo, na API oficial)
  const prevKey = JSON.stringify({ channelId, aud, tplKey });
  useEffect(() => {
    if (!channelId || !hasCriteria) return;
    let alive = true;
    const t = setTimeout(async () => {
      setLoadingPrev(true);
      const r = await fetch("/api/broadcasts/preview", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, audience: aud, template: tpl ? { name: tpl.name, language: tpl.language, params: [] } : null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!alive) return;
      setLoadingPrev(false);
      if (r.ok) setPreview(j); else toast.error(j.error ?? "Não consegui calcular o público");
    }, 400);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevKey, hasCriteria]);
  const shownPreview = hasCriteria ? preview : null;

  function pickTemplate(key: string) {
    setTplKey(key);
    const t = templates?.find((x) => `${x.name}|${x.language}` === key);
    setParams(Array.from({ length: t?.params ?? 0 }, (_, i) => (i === 0 ? { kind: "first_name" } : { kind: "text", value: "" })));
    setHeaderFile(null);
  }
  function insertVar(v: string) {
    const el = bodyRef.current;
    const pos = el?.selectionStart ?? body.length;
    setBody(body.slice(0, pos) + v + body.slice(pos));
    setTimeout(() => { el?.focus(); el?.setSelectionRange(pos + v.length, pos + v.length); }, 0);
  }
  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > MAX_MB * 1024 * 1024) { toast.error(`"${f.name}" passa de ${MAX_MB} MB`); continue; }
      if (next.length >= 2) { toast.error("No máximo 2 mídias por disparo"); break; }
      next.push(f);
    }
    setFiles(next);
  }

  const stepOk = [
    Boolean(ch && ch.status === "connected" && shownPreview && shownPreview.count > 0 && !shownPreview.overLimit),
    isMeta
      ? Boolean(tpl && tpl.status === "APPROVED" && tpl.sendable && params.every((p) => p.kind !== "text" || p.value.trim()) && (!tpl.header || tpl.header.format === "TEXT" || headerFile))
      : Boolean(body.trim() || files.length),
    when === "now" || sendAt > localNowPlus(0),
    Boolean(name.trim()) && (!isMeta || agree),
  ];
  const cost = shownPreview?.cost ?? null;

  async function submit() {
    if (!ch || !shownPreview) return;
    setSaving(true);
    const label = [
      aud.tagIds.length ? `Tags: ${aud.tagIds.map((id) => ws.tagById.get(id)?.name).filter(Boolean).join(", ")}` : null,
      aud.stageIds.length ? `Colunas: ${aud.stageIds.map((id) => ws.stageById.get(id)?.name).filter(Boolean).join(", ")}` : null,
      aud.idle ? `Sem interação há + de ${idleLabel(aud.idle)}` : null,
      aud.leadIds.length ? `${aud.leadIds.length} lead(s) escolhido(s)` : null,
    ].filter(Boolean).join(" · ");
    const fd = new FormData();
    fd.set("payload", JSON.stringify({
      name: name.trim(), channelId, audience: aud, audienceLabel: label,
      body: isMeta ? null : body.trim() || null,
      template: isMeta && tpl ? { name: tpl.name, language: tpl.language, params } : null,
      sendNow: when === "now", sendAt: when === "later" ? sendAt : null,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ,
      intervalSeconds: pace, confirmedCost: cost?.total ?? null,
    }));
    if (!isMeta) files.forEach((f) => fd.append("media", f));
    if (isMeta && headerFile) fd.set("header", headerFile);
    const r = await fetch("/api/broadcasts", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) return toast.error(j.error ?? "Não consegui criar o disparo");
    toast.success(when === "now" ? "Disparo iniciado" : "Disparo agendado");
    onCreated(j.id);
  }

  const sampleName = shownPreview?.sample[0]?.name ?? "Maria Souza";
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <button onClick={onCancel} className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white"><ArrowLeft className="h-4 w-4" /> Voltar aos disparos</button>
        <h2 className="text-lg font-semibold tracking-tight text-white">Novo disparo</h2>

        <ol className="mt-4 flex flex-wrap gap-2">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button onClick={() => i < step && setStep(i)} disabled={i > step}
                className={cn("flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm", i === step ? "border-brand-400/60 bg-brand-500/15 text-white" : i < step ? "border-line text-slate-300 hover:bg-ink-800" : "border-line text-slate-600")}>
                <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold", i < step ? "bg-emerald-500 text-white" : i === step ? "bg-brand-500 text-white" : "bg-ink-700 text-slate-400")}>{i < step ? <Check className="h-3 w-3" /> : i + 1}</span>
                {s}
              </button>
            </li>
          ))}
        </ol>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="card space-y-6 p-5">
            {step === 0 && (
              <>
                <section>
                  <p className="label">Número que vai enviar</p>
                  {channels === null ? <Spinner className="h-5 w-5" /> : !channels.length ? (
                    <p className="text-sm text-slate-400">Nenhum WhatsApp conectado. Conecte um número em Configurações.</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {channels.map((c) => (
                        <button key={c.id} disabled={c.status !== "connected"} onClick={() => { setChannelId(c.id); setTplKey(""); setParams([]); }}
                          className={cn("rounded-xl border p-3 text-left text-sm transition disabled:opacity-40", channelId === c.id ? "border-brand-400/60 bg-brand-500/10" : "border-line hover:bg-ink-800")}>
                          <p className="font-medium text-white">{c.name}</p>
                          <p className="text-xs text-slate-400">{c.phone_number ? `+${c.phone_number} · ` : ""}{c.provider === "meta" ? "API oficial (cobrado pela Meta, só modelos aprovados)" : "WhatsApp por QR Code (sem custo por mensagem)"}{c.status !== "connected" ? " · desconectado" : ""}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <AudienceBuilder aud={aud} setAud={setAud} picked={picked} setPicked={setPicked} />
              </>
            )}

            {step === 1 && (isMeta ? (
              <section className="space-y-4">
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                  Pela regra da Meta, disparo pela API oficial só sai com <b>modelo aprovado</b>. Cada mensagem entregue é cobrada pela Meta conforme a categoria do modelo.
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="label mb-0">Modelo</p>
                  <Button size="sm" variant="outline" onClick={() => setNewTpl(true)}><Plus className="h-3.5 w-3.5" /> Criar modelo e enviar para aprovação</Button>
                </div>
                {templates === null ? <Spinner className="h-5 w-5" /> : !templates.length ? <p className="text-sm text-slate-400">Nenhum modelo nessa conta ainda.</p> : (
                  <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                    {templates.map((t) => {
                      const key = `${t.name}|${t.language}`;
                      const usable = t.status === "APPROVED" && t.sendable;
                      return (
                        <li key={key}>
                          <button disabled={!usable} onClick={() => pickTemplate(key)}
                            className={cn("w-full rounded-xl border p-3 text-left text-sm transition", tplKey === key ? "border-brand-400/60 bg-brand-500/10" : "border-line hover:bg-ink-800", !usable && "cursor-not-allowed opacity-60")}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-white">{t.name}</span>
                              <span className="text-[11px] text-slate-500">{t.language} · {t.category === "MARKETING" ? "Marketing" : t.category === "UTILITY" ? "Utilidade" : t.category}</span>
                              <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium", t.status === "APPROVED" ? "bg-emerald-500/15 text-emerald-300" : t.status === "PENDING" || t.status === "IN_APPEAL" ? "bg-amber-500/15 text-amber-300" : "bg-red-500/15 text-red-300")}>
                                {t.status === "APPROVED" ? "Aprovado" : t.status === "PENDING" ? "Em análise" : t.status === "REJECTED" ? "Recusado" : t.status}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-slate-400">{t.body}</p>
                            {t.rejectedReason && <p className="mt-1 text-xs text-red-300">Motivo: {t.rejectedReason}</p>}
                            {t.status === "APPROVED" && !t.sendable && <p className="mt-1 text-xs text-slate-500">Tem link dinâmico ou variável no título: ainda não dá para usar no disparo.</p>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {tpl && (
                  <div className="space-y-3">
                    {params.map((p, i) => (
                      <div key={i} className="grid gap-2 sm:grid-cols-[110px_160px_1fr] sm:items-center">
                        <span className="text-sm text-slate-300">Campo {`{{${i + 1}}}`}</span>
                        <select className="field" value={p.kind} onChange={(e) => setParams((ps) => ps.map((x, j) => (j === i ? (e.target.value === "text" ? { kind: "text", value: "" } : { kind: e.target.value as "name" }) : x)))}>
                          <option value="first_name">Primeiro nome do lead</option>
                          <option value="name">Nome completo do lead</option>
                          <option value="text">Texto fixo</option>
                        </select>
                        {p.kind === "text" && <input className="field" maxLength={1024} placeholder="Ex.: 20% de desconto" value={p.value} onChange={(e) => setParams((ps) => ps.map((x, j) => (j === i ? { kind: "text", value: e.target.value } : x)))} />}
                      </div>
                    ))}
                    {tpl.header && tpl.header.format !== "TEXT" && (
                      <label className="block">
                        <span className="label">{tpl.header.format === "IMAGE" ? "Foto do cabeçalho" : tpl.header.format === "VIDEO" ? "Vídeo do cabeçalho" : "Documento do cabeçalho"}</span>
                        <input type="file" className="block text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-ink-700 file:px-3 file:py-1.5 file:text-slate-100"
                          accept={tpl.header.format === "IMAGE" ? "image/jpeg,image/png" : tpl.header.format === "VIDEO" ? "video/mp4" : "application/pdf"}
                          onChange={(e) => setHeaderFile(e.target.files?.[0] ?? null)} />
                      </label>
                    )}
                  </div>
                )}
              </section>
            ) : (
              <section className="space-y-4">
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="label mb-0 flex-1">Mensagem</span>
                    <button onClick={() => insertVar("{{primeiro_nome}}")} className="rounded-full border border-line px-2 py-0.5 text-xs text-slate-300 hover:bg-ink-800">+ Primeiro nome</button>
                    <button onClick={() => insertVar("{{nome}}")} className="rounded-full border border-line px-2 py-0.5 text-xs text-slate-300 hover:bg-ink-800">+ Nome completo</button>
                  </div>
                  <textarea ref={bodyRef} className="field h-36 resize-y py-2" maxLength={4096} value={body} onChange={(e) => setBody(e.target.value)}
                    placeholder="Oi {{primeiro_nome}}, tudo bem? Faz um tempo que a gente não conversa…" />
                  <p className="mt-1 text-right text-xs text-slate-500">{body.length}/4096</p>
                </div>
                <div>
                  <p className="label">Mídias (até 2: foto, vídeo, áudio ou documento)</p>
                  <div className="flex flex-wrap gap-2">
                    {files.map((f, i) => {
                      const I = KIND_ICON[kindOf(f)];
                      return (
                        <span key={i} className="inline-flex items-center gap-2 rounded-xl border border-line bg-ink-850 px-3 py-2 text-sm text-slate-200">
                          <I className="h-4 w-4 text-slate-400" /><span className="max-w-[160px] truncate">{f.name}</span>
                          <span className="text-xs text-slate-500">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                          <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-300" aria-label="Remover"><X className="h-3.5 w-3.5" /></button>
                        </span>
                      );
                    })}
                    {files.length < 2 && (
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-sm text-slate-400 hover:bg-ink-800">
                        <Paperclip className="h-4 w-4" /> Adicionar mídia
                        <input type="file" multiple className="hidden" accept="image/jpeg,image/png,video/mp4,audio/*,application/pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">O texto vai como legenda da primeira foto ou vídeo. Com áudio ou documento, o texto vai logo depois, em outra mensagem.</p>
                </div>
              </section>
            ))}

            {step === 2 && (
              <section className="space-y-5">
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["now", "later"] as const).map((w) => (
                    <button key={w} onClick={() => setWhen(w)} className={cn("rounded-xl border p-3 text-left text-sm", when === w ? "border-brand-400/60 bg-brand-500/10" : "border-line hover:bg-ink-800")}>
                      <p className="font-medium text-white">{w === "now" ? "Disparar agora" : "Agendar"}</p>
                      <p className="text-xs text-slate-400">{w === "now" ? "Começa em segundos" : "Escolha o dia e a hora"}</p>
                    </button>
                  ))}
                </div>
                {when === "later" && (
                  <label className="block max-w-xs">
                    <span className="label">Dia e hora</span>
                    <input type="datetime-local" className="field" min={localNowPlus(1)} value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
                  </label>
                )}
                {!isMeta && (
                  <div>
                    <p className="label">Ritmo do envio</p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {PACES.map((p) => (
                        <button key={p.id} onClick={() => setPace(p.seconds)} className={cn("rounded-xl border p-3 text-left text-sm", pace === p.seconds ? "border-brand-400/60 bg-brand-500/10" : "border-line hover:bg-ink-800")}>
                          <p className="font-medium text-white">{p.label}{p.id === "safe" && <span className="ml-1.5 text-[11px] text-emerald-300">recomendado</span>}</p>
                          <p className="text-xs text-slate-400">{p.hint}</p>
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />No WhatsApp por QR Code, mandar muito rápido para quem não tem seu número salvo pode fazer o WhatsApp bloquear o número. O intervalo varia um pouco entre cada envio para parecer natural.</p>
                  </div>
                )}
                {shownPreview && <p className="flex items-center gap-1.5 text-sm text-slate-300"><Clock3 className="h-4 w-4 text-slate-500" /> Duração prevista: {durationLabel(shownPreview.count, isMeta ? 0 : pace)}</p>}
              </section>
            )}

            {step === 3 && shownPreview && ch && (
              <section className="space-y-5">
                <label className="block">
                  <span className="label">Nome do disparo (só para você)</span>
                  <input className="field" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Reativação clientes parados 3 meses" />
                </label>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div className="rounded-xl border border-line bg-ink-850 p-3"><dt className="text-xs text-slate-400">Para quem</dt><dd className="num mt-1 text-lg font-semibold text-white">{shownPreview.count.toLocaleString("pt-BR")} pessoas</dd></div>
                  <div className="rounded-xl border border-line bg-ink-850 p-3"><dt className="text-xs text-slate-400">Quando</dt><dd className="mt-1 font-medium text-white">{when === "now" ? "Agora" : new Date(sendAt).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" })}</dd></div>
                  <div className="rounded-xl border border-line bg-ink-850 p-3"><dt className="text-xs text-slate-400">Número</dt><dd className="mt-1 font-medium text-white">{ch.name}</dd></div>
                  <div className="rounded-xl border border-line bg-ink-850 p-3"><dt className="text-xs text-slate-400">Duração prevista</dt><dd className="mt-1 font-medium text-white">{durationLabel(shownPreview.count, isMeta ? 0 : pace)}</dd></div>
                </dl>
                {isMeta ? (
                  <CostBox cost={cost} category={shownPreview.category} count={shownPreview.count} agree={agree} setAgree={setAgree} />
                ) : (
                  <div className="rounded-xl border border-line bg-ink-850 p-4 text-sm">
                    <p className="font-medium text-white">Custo: R$ 0,00 por mensagem</p>
                    <p className="mt-1 text-xs text-slate-400">No WhatsApp por QR Code a Meta não cobra por mensagem. O que existe é o risco de bloqueio se mandar rápido demais; por isso o ritmo.</p>
                  </div>
                )}
              </section>
            )}

            <div className="flex justify-between gap-2 border-t border-line pt-4">
              <Button variant="ghost" onClick={() => (step ? setStep(step - 1) : onCancel())}>{step ? "Voltar" : "Cancelar"}</Button>
              {step < 3
                ? <Button onClick={() => setStep(step + 1)} disabled={!stepOk[step]}>Continuar</Button>
                : <Button onClick={submit} disabled={!stepOk[3]} loading={saving}>{when === "now" ? "Disparar agora" : "Agendar disparo"}</Button>}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="card p-4">
              <p className="text-xs text-slate-400">Público</p>
              {!hasCriteria ? <p className="mt-1 text-sm text-slate-500">Use pelo menos um filtro para ver quem recebe.</p> : loadingPrev && !shownPreview ? <Spinner className="mt-2 h-5 w-5" /> : shownPreview && (
                <>
                  <p className="num mt-1 text-3xl font-semibold text-white">{shownPreview.count.toLocaleString("pt-BR")}<span className="ml-1.5 text-sm font-normal text-slate-400">pessoas</span>{loadingPrev && <Spinner className="ml-2 inline h-4 w-4" />}</p>
                  {shownPreview.overLimit && <p className="mt-1 text-xs text-red-300">Passa do limite de 5.000 por disparo. Filtre mais.</p>}
                  <ul className="mt-3 space-y-1 text-xs text-slate-400">
                    {shownPreview.sample.map((s) => <li key={s.id} className="truncate">{s.name ?? "Sem nome"} · +{s.phone}</li>)}
                    {shownPreview.count > shownPreview.sample.length && <li className="text-slate-500">e mais {(shownPreview.count - shownPreview.sample.length).toLocaleString("pt-BR")}…</li>}
                  </ul>
                  {isMeta && cost?.total != null && cost.currency && <p className="mt-3 border-t border-line pt-3 text-sm text-slate-300">Custo: <b className="text-white">{formatMoney(cost.total, cost.currency)}</b></p>}
                </>
              )}
            </div>
            {step >= 1 && (
              <div className="card p-4">
                <p className="mb-2 text-xs text-slate-400">Como chega no WhatsApp</p>
                <div className="chat-bg space-y-1.5 rounded-xl p-3">
                  {isMeta ? (tpl ? (
                    <div className="ml-auto max-w-[90%] rounded-lg bg-emerald-900/70 px-2.5 py-1.5 text-[13px] text-slate-100">
                      {tpl.header?.format === "TEXT" && <p className="font-semibold">{tpl.header.text}</p>}
                      {tpl.header && tpl.header.format !== "TEXT" && <p className="mb-1 rounded bg-black/30 py-6 text-center text-xs text-slate-300">{headerFile ? headerFile.name : tpl.header.format === "IMAGE" ? "Foto" : tpl.header.format === "VIDEO" ? "Vídeo" : "Documento"}</p>}
                      <p className="whitespace-pre-wrap">{tpl.body.replace(/\{\{(\d+)\}\}/g, (_m, n) => { const p = params[Number(n) - 1]; return !p ? "" : p.kind === "text" ? p.value || `{{${n}}}` : p.kind === "name" ? sampleName : sampleName.split(" ")[0]!; })}</p>
                      {tpl.footer && <p className="mt-1 text-[11px] text-slate-400">{tpl.footer}</p>}
                      {tpl.buttons.map((b, i) => <p key={i} className="mt-1 border-t border-white/10 pt-1 text-center text-sky-300">{b.text}</p>)}
                    </div>
                  ) : <p className="text-center text-xs text-slate-500">Escolha um modelo</p>) : (
                    <>
                      {files.map((f, i) => {
                        const k = kindOf(f); const I = KIND_ICON[k];
                        const cap = body.trim() && files.findIndex((x) => ["image", "video"].includes(kindOf(x))) === i;
                        return (
                          <div key={i} className="ml-auto max-w-[90%] rounded-lg bg-emerald-900/70 p-1.5 text-[13px] text-slate-100">
                            <p className="flex items-center gap-2 rounded bg-black/30 px-2 py-3 text-xs text-slate-300"><I className="h-4 w-4" />{f.name}</p>
                            {cap && <p className="mt-1 whitespace-pre-wrap px-1">{renderVars(body, sampleName)}</p>}
                          </div>
                        );
                      })}
                      {body.trim() && !files.some((f) => ["image", "video"].includes(kindOf(f))) && (
                        <div className="ml-auto max-w-[90%] whitespace-pre-wrap rounded-lg bg-emerald-900/70 px-2.5 py-1.5 text-[13px] text-slate-100">{renderVars(body, sampleName)}</div>
                      )}
                      {!body.trim() && !files.length && <p className="text-center text-xs text-slate-500">Escreva a mensagem</p>}
                    </>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">Exemplo com o nome de {sampleName.split(" ")[0]}.</p>
              </div>
            )}
          </aside>
        </div>
      </div>
      {newTpl && ch && <NewTemplateModal channelId={ch.id} onClose={() => setNewTpl(false)} />}
    </div>
  );
}

function CostBox({ cost, category, count, agree, setAgree }: { cost: CostEstimate | null; category: string | null; count: number; agree: boolean; setAgree: (v: boolean) => void }) {
  if (!cost || cost.total == null || !cost.currency || !cost.unit) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
        Não consegui ler a moeda da sua conta na Meta para calcular o custo com precisão. Confira o número em Configurações antes de disparar.
        <label className="mt-3 flex items-start gap-2 text-xs"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> Entendo que a Meta vai cobrar cada mensagem entregue e quero disparar mesmo assim.</label>
      </div>
    );
  }
  const catLabel = category === "MARKETING" ? "Marketing" : category === "UTILITY" ? "Utilidade" : "Autenticação";
  return (
    <div className="rounded-xl border border-brand-400/30 bg-brand-500/[.07] p-4 text-sm">
      <p className="text-xs text-slate-400">Custo na Meta (API oficial)</p>
      <p className="num mt-1 text-3xl font-semibold text-white">{formatMoney(cost.total, cost.currency)}</p>
      <table className="mt-3 w-full text-xs text-slate-300">
        <tbody>
          <tr><td className="py-0.5">Mensagens para números do Brasil</td><td className="num text-right">{cost.brazil.toLocaleString("pt-BR")}</td></tr>
          <tr><td className="py-0.5">Preço por mensagem ({catLabel})</td><td className="num text-right">{formatMoney(cost.unit, cost.currency)}</td></tr>
          <tr className="border-t border-line font-semibold text-white"><td className="pt-1">Total máximo</td><td className="num pt-1 text-right">{formatMoney(cost.total, cost.currency)}</td></tr>
        </tbody>
      </table>
      {cost.otherCountry > 0 && <p className="mt-2 text-xs text-amber-300">{cost.otherCountry} número(s) de fora do Brasil têm outra tabela de preço e não entram nesse total.</p>}
      <ul className="mt-3 list-disc space-y-1 pl-4 text-[11px] text-slate-400">
        <li>Tabela oficial da Meta para o Brasil, vigente desde {new Date(`${META_BR_RATES.since}T12:00:00`).toLocaleDateString("pt-BR")}, na moeda da sua conta ({cost.currency}).</li>
        <li>A Meta só cobra mensagem entregue: se alguma falhar, o valor final fica menor.</li>
        {category !== "MARKETING" && <li>Utilidade tem desconto por volume no mês: o valor real pode sair menor.</li>}
        <li>Conversas abertas por anúncio de clique para o WhatsApp nos últimos dias podem sair de graça.</li>
      </ul>
      <label className="mt-3 flex items-start gap-2 text-xs text-slate-200"><input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> Confirmo o disparo para {count.toLocaleString("pt-BR")} pessoas, com custo de até {formatMoney(cost.total, cost.currency)} cobrado pela Meta.</label>
    </div>
  );
}

