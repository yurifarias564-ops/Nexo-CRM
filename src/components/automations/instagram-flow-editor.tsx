"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, ExternalLink, Film, ImageIcon, Link2, Plus, Trash2, Upload, UserCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { DEFAULT_TZ } from "@/lib/time";
import { DEFAULT_NOT_FOLLOWING, flowProblems, IG_LIMITS, RETRY_FOLLOW_BUTTON, type IgFlowRow, type IgPostMedia, type IgPostMode, type IgStep } from "@/lib/ig-flows";
import { BackLink, fmtDate, type IgChannelInfo } from "./instagram-flows";

type MediaItem = { id: string; caption: string | null; type: string; thumb: string | null; permalink: string | null; timestamp: string | null };

function toLocal(iso: string | null) {
  const d = iso ? new Date(iso) : new Date(Date.now() + 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const MODES: { id: IgPostMode; label: string; hint: string }[] = [
  { id: "schedule", label: "Agendar publicação nova", hint: "O CRM publica o vídeo ou a foto no dia e hora marcados" },
  { id: "existing", label: "Publicação que já existe", hint: "Escolha um Reels ou post já publicado" },
  { id: "any", label: "Qualquer publicação", hint: "Vale para comentários em todos os seus posts" },
];

export function InstagramFlowEditor({ initial, channels, onClose }: { initial: IgFlowRow | null; channels: IgChannelInfo[]; onClose: () => void }) {
  const usable = channels.filter((c) => c.connected);
  const [name, setName] = useState(initial?.name ?? "");
  const [channelId, setChannelId] = useState(initial?.channel_id ?? usable[0]?.id ?? "");
  const [mode, setMode] = useState<IgPostMode>(initial?.post_mode ?? "schedule");
  const [media, setMedia] = useState<IgPostMedia | null>(initial?.post_media ?? null);
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState(initial?.post_caption ?? "");
  const [postNow, setPostNow] = useState(false);
  const [postAt, setPostAt] = useState(toLocal(initial?.post_at ?? null));
  const [mediaId, setMediaId] = useState(initial?.post_media_id ?? null);
  const [permalink, setPermalink] = useState(initial?.post_permalink ?? null);
  const [recent, setRecent] = useState<MediaItem[] | null>(null);
  const [keywords, setKeywords] = useState<string[]>(initial?.keywords ?? []);
  const [kw, setKw] = useState("");
  const [reply, setReply] = useState(initial?.comment_reply ?? "");
  const [steps, setSteps] = useState<IgStep[]>(initial?.steps?.length ? initial.steps : [{ text: "", button: "", requireFollow: false }]);
  const [finalText, setFinalText] = useState(initial?.final_text ?? "");
  const [finalButton, setFinalButton] = useState(initial?.final_button ?? "");
  const [finalUrl, setFinalUrl] = useState(initial?.final_url ?? "");
  const [finalFollow, setFinalFollow] = useState(initial?.final_require_follow ?? true);
  const [notFollowing, setNotFollowing] = useState(initial?.not_following_text ?? "");
  const [saving, setSaving] = useState<"draft" | "on" | null>(null);

  const ch = channels.find((c) => c.id === channelId);
  const locked = initial?.post_status === "processing" || initial?.post_status === "published";
  const anyFollow = finalFollow || steps.some((s, i) => i > 0 && s.requireFollow);

  useEffect(() => {
    if (mode !== "existing" || !channelId || locked) return;
    let alive = true;
    void (async () => {
      const r = await fetch(`/api/ig-flows/media?channelId=${channelId}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!alive) return;
      if (!r.ok) { toast.error(j.error ?? "Não consegui buscar as publicações"); setRecent([]); return; }
      setRecent(j.media);
    })();
    return () => { alive = false; };
  }, [mode, channelId, locked]);

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const r = await fetch("/api/ig-flows/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, mime: file.type, size: file.size }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Não consegui preparar o envio");
      const up = await supabaseBrowser().storage.from("ig-posts").uploadToSignedUrl(j.path, j.token, file, { contentType: j.media.mime });
      if (up.error) throw new Error(`O envio falhou: ${up.error.message}`);
      setMedia(j.media);
    } catch (e) { toast.error((e as Error).message); }
    setUploading(false);
  }
  function addKw() {
    const v = kw.trim().replace(/^["“”']+|["“”']+$/g, "");
    if (v && !keywords.some((k) => k.toLowerCase() === v.toLowerCase()) && keywords.length < IG_LIMITS.keywords) setKeywords([...keywords, v]);
    setKw("");
  }
  const setStep = (i: number, patch: Partial<IgStep>) => setSteps((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => setSteps((ss) => { const n = [...ss]; const j = i + d; if (j < 0 || j >= n.length) return ss; [n[i], n[j]] = [n[j]!, n[i]!]; return n.map((s, k) => (k === 0 ? { ...s, requireFollow: false } : s)); });

  const problems = useMemo(() => flowProblems({
    post_mode: mode, post_media: media, post_at: postNow ? new Date().toISOString() : postAt, post_media_id: mediaId, post_status: locked ? "published" : "none",
    steps, final_text: finalText, final_button: finalButton, final_url: finalUrl,
  }), [mode, media, postNow, postAt, mediaId, locked, steps, finalText, finalButton, finalUrl]);

  async function save(enabled: boolean) {
    if (!name.trim()) return toast.error("Dê um nome à automação");
    if (enabled && problems.length) return toast.error(problems[0]!);
    setSaving(enabled ? "on" : "draft");
    const pending = kw.trim() ? [...keywords, kw.trim()] : keywords;
    const body = {
      name: name.trim(), channelId, enabled, postMode: mode, postMedia: media, postCaption: caption || null, postAt: postNow ? null : postAt, postNow,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ, postMediaId: mediaId, postPermalink: permalink,
      keywords: pending, commentReply: reply || null, steps, finalText: finalText || null, finalButton: finalButton || null, finalUrl: finalUrl.trim() || null,
      finalRequireFollow: finalFollow, notFollowingText: notFollowing || null,
    };
    const r = await fetch(initial ? `/api/ig-flows/${initial.id}` : "/api/ig-flows", { method: initial ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setSaving(null);
    if (!r.ok) return toast.error(j.error ?? "Não consegui salvar");
    toast.success(enabled ? "Automação ligada" : "Rascunho salvo");
    onClose();
  }

  const Kind = media?.kind === "image" ? ImageIcon : Film;
  return (
    <div className="space-y-4">
      <BackLink onClick={onClose} />
      <div className="grid gap-5 lg:grid-cols-[1fr_330px]">
        <div className="space-y-4">
          <Card n={1} title="Nome e conta">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="label">Nome (só para você)</span>
                <input className="field" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Reels do dia 20 — palavra QUERO" /></label>
              <label className="block"><span className="label">Conta do Instagram</span>
                <select className="field" value={channelId} onChange={(e) => { setChannelId(e.target.value); setMediaId(null); setRecent(null); }} disabled={Boolean(initial)}>
                  {usable.map((c) => <option key={c.id} value={c.id}>@{c.username}</option>)}
                </select></label>
            </div>
          </Card>

          <Card n={2} title="Publicação">
            {locked ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                <span className="flex-1">{initial?.post_status === "published" ? `Publicada${initial.published_at ? ` em ${fmtDate(initial.published_at)}` : ""}. Os comentários nela disparam o fluxo.` : "Sendo publicada no Instagram agora…"}</span>
                {initial?.post_permalink && <a href={initial.post_permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline"><ExternalLink className="h-3.5 w-3.5" /> Abrir</a>}
              </div>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-3">
                  {MODES.map((m) => (
                    <button key={m.id} onClick={() => setMode(m.id)} className={cn("rounded-xl border p-3 text-left text-sm", mode === m.id ? "border-brand-400/60 bg-brand-500/10" : "border-line hover:bg-ink-800")}>
                      <p className="font-medium text-white">{m.label}</p><p className="mt-0.5 text-xs text-slate-400">{m.hint}</p>
                    </button>
                  ))}
                </div>
                {mode === "schedule" && (
                  <div className="mt-4 space-y-4">
                    {ch && !ch.canPublish && <Warn>Esta conta ainda não liberou a permissão de publicar. Salve como rascunho, volte e toque em “Liberar automações”.</Warn>}
                    <div>
                      <span className="label">Vídeo (Reels) ou foto</span>
                      {media ? (
                        <div className="flex items-center gap-3 rounded-xl border border-line bg-ink-850 px-3 py-2.5 text-sm">
                          <Kind className="h-5 w-5 text-brand-300" />
                          <span className="min-w-0 flex-1 truncate text-slate-100">{media.name}</span>
                          <span className="text-xs text-slate-500">{(media.size / 1024 / 1024).toFixed(1)} MB</span>
                          <button onClick={() => setMedia(null)} className="rounded p-1 text-slate-500 hover:text-red-300" aria-label="Trocar arquivo"><X className="h-4 w-4" /></button>
                        </div>
                      ) : (
                        <label className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-line px-4 py-7 text-center text-sm text-slate-400 hover:bg-ink-800", uploading && "pointer-events-none opacity-70")}>
                          {uploading ? <><Spinner className="h-6 w-6" /> Enviando o arquivo… não feche a página</> : <><Upload className="h-6 w-6 text-brand-300" /> Escolher arquivo<span className="text-xs text-slate-500">Vídeo MP4/MOV vertical 9:16, até 100 MB e 90 s para Reels · ou foto JPG até 8 MB</span></>}
                          <input type="file" className="hidden" accept="video/mp4,video/quicktime,image/jpeg" onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ""; }} />
                        </label>
                      )}
                    </div>
                    <label className="block"><span className="label">Legenda</span>
                      <textarea className="field h-28 resize-y py-2" maxLength={IG_LIMITS.caption} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={`Comenta ${keywords[0] ?? "QUERO"} que eu te mando no direct 👇`} />
                      <span className="mt-1 block text-right text-xs text-slate-500">{caption.length}/{IG_LIMITS.caption}</span></label>
                    <div>
                      <span className="label">Quando publicar</span>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="seg"><button className={cn(!postNow && "on")} onClick={() => setPostNow(false)}>Dia e hora</button><button className={cn(postNow && "on")} onClick={() => setPostNow(true)}>Assim que ligar</button></div>
                        {!postNow && <input type="datetime-local" className="field w-auto" min={toLocal(new Date().toISOString())} value={postAt} onChange={(e) => setPostAt(e.target.value)} />}
                      </div>
                      <p className="mt-1.5 text-xs text-slate-500">A publicação só sai com a automação ligada. Vídeo leva de 1 a 5 minutos para o Instagram processar.</p>
                    </div>
                  </div>
                )}
                {mode === "existing" && (
                  <div className="mt-4">
                    {recent === null ? <Spinner className="h-5 w-5" /> : !recent.length ? <p className="text-sm text-slate-500">Nenhuma publicação encontrada nessa conta.</p> : (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {recent.map((m) => (
                          <button key={m.id} onClick={() => { setMediaId(m.id); setPermalink(m.permalink); }} title={m.caption ?? ""}
                            className={cn("relative aspect-[4/5] overflow-hidden rounded-xl border-2 bg-ink-800 text-left", mediaId === m.id ? "border-brand-400" : "border-transparent hover:border-line")}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {m.thumb ? <img src={m.thumb} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-slate-500"><Film className="h-6 w-6" /></span>}
                            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2 text-[11px] leading-tight text-white"><span className="line-clamp-2">{m.caption ?? "Sem legenda"}</span></span>
                            {mediaId === m.id && <CheckCircle2 className="absolute right-1.5 top-1.5 h-5 w-5 rounded-full bg-brand-500 text-white" />}
                          </button>
                        ))}
                      </div>
                    )}
                    {mediaId && !recent?.some((m) => m.id === mediaId) && <p className="mt-2 text-xs text-slate-400">Publicação escolhida antes continua valendo.</p>}
                  </div>
                )}
              </>
            )}
          </Card>

          <Card n={3} title="Gatilho: o comentário">
            {ch && !ch.canComments && <Warn>Esta conta ainda não liberou a leitura de comentários. Salve como rascunho, volte e toque em “Liberar automações”.</Warn>}
            <span className="label">Palavras que disparam</span>
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-ink-850 p-2">
              {keywords.map((k) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-lg bg-brand-500/20 py-1 pl-2.5 pr-1 text-sm font-medium text-brand-100">{k}
                  <button onClick={() => setKeywords(keywords.filter((x) => x !== k))} className="rounded p-0.5 hover:bg-brand-500/30" aria-label={`Remover ${k}`}><X className="h-3 w-3" /></button></span>
              ))}
              <input className="min-w-[140px] flex-1 bg-transparent px-2 py-1 text-sm text-white outline-none placeholder:text-slate-500" value={kw} maxLength={40}
                onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addKw(); } }} onBlur={addKw} placeholder={keywords.length ? "Outra palavra" : "Ex.: QUERO (Enter para adicionar)"} />
            </div>
            <p className="mt-1.5 text-xs text-slate-500">{keywords.length ? "Maiúscula, minúscula e acento não fazem diferença. A palavra pode estar no meio da frase." : "Sem palavra cadastrada, qualquer comentário dispara o fluxo."}</p>
            <label className="mt-4 block"><span className="label">Resposta pública no comentário (opcional)</span>
              <input className="field" maxLength={300} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Te chamei no direct 📩" /></label>
          </Card>

          <Card n={4} title="Conversa no Direct">
            <div className="space-y-3">
              {steps.map((s, i) => (
                <div key={i} className="rounded-xl border border-line bg-ink-850 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">Mensagem {i + 1}</span>
                    {i === 0 && <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[11px] text-slate-300">chega logo após o comentário</span>}
                    <div className="ml-auto flex items-center">
                      <IconBtn label="Subir" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
                      <IconBtn label="Descer" disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
                      <IconBtn label="Excluir" disabled={steps.length === 1} onClick={() => setSteps(steps.filter((_, j) => j !== i))} danger><Trash2 className="h-3.5 w-3.5" /></IconBtn>
                    </div>
                  </div>
                  <textarea className="field h-24 resize-y py-2" maxLength={IG_LIMITS.text} value={s.text} onChange={(e) => setStep(i, { text: e.target.value })}
                    placeholder={i === 0 ? "Oi! Vi seu comentário 😄 Quer receber o material?" : "Texto desta etapa"} />
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <label className="flex min-w-[200px] flex-1 items-center gap-2 text-xs text-slate-400">Botão
                      <input className="field h-9" maxLength={IG_LIMITS.button} value={s.button} onChange={(e) => setStep(i, { button: e.target.value })} placeholder={i === 0 ? "Quero sim" : "Continuar"} />
                      <span className="w-10 shrink-0 text-right">{s.button.length}/20</span></label>
                    {i > 0 && <FollowToggle on={s.requireFollow} onChange={(v) => setStep(i, { requireFollow: v })} />}
                  </div>
                </div>
              ))}
              {steps.length < IG_LIMITS.steps && <Button variant="outline" size="sm" onClick={() => setSteps([...steps, { text: "", button: "", requireFollow: false }])}><Plus className="h-3.5 w-3.5" /> Adicionar mensagem</Button>}

              <div className="rounded-xl border border-brand-400/40 bg-brand-500/[.07] p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2"><Link2 className="h-4 w-4 text-brand-300" /><span className="text-sm font-semibold text-white">Mensagem final, com o link</span>
                  <div className="ml-auto"><FollowToggle on={finalFollow} onChange={setFinalFollow} /></div></div>
                <textarea className="field h-20 resize-y py-2" maxLength={IG_LIMITS.text} value={finalText} onChange={(e) => setFinalText(e.target.value)} placeholder="Prontinho! Aqui está o seu acesso 👇" />
                <div className="mt-2 grid gap-2 sm:grid-cols-[200px_1fr]">
                  <input className="field h-9" maxLength={IG_LIMITS.button} value={finalButton} onChange={(e) => setFinalButton(e.target.value)} placeholder="Texto do botão (Acessar)" />
                  <input className="field h-9" type="url" maxLength={500} value={finalUrl} onChange={(e) => setFinalUrl(e.target.value)} placeholder="https://sua-pagina.com" />
                </div>
              </div>

              {anyFollow && (
                <label className="block rounded-xl border border-line bg-ink-850 p-3"><span className="label flex items-center gap-1.5"><UserCheck className="h-3.5 w-3.5" /> Mensagem para quem ainda não segue</span>
                  <textarea className="field h-20 resize-y py-2" maxLength={IG_LIMITS.text} value={notFollowing} onChange={(e) => setNotFollowing(e.target.value)} placeholder={DEFAULT_NOT_FOLLOWING} />
                  <span className="mt-1 block text-xs text-slate-500">Vai com o botão “{RETRY_FOLLOW_BUTTON}”. A pessoa segue, toca nele e o fluxo continua de onde parou.</span></label>
              )}
            </div>
          </Card>

          {problems.length > 0 && (
            <div className="rounded-xl border border-line bg-ink-900 p-3 text-xs text-slate-400">
              <p className="mb-1 font-medium text-slate-300">Para ligar, falta:</p>
              <ul className="list-disc space-y-0.5 pl-4">{problems.slice(0, 5).map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2 pb-6">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button variant="outline" onClick={() => void save(false)} loading={saving === "draft"} disabled={uploading}>Salvar desligada</Button>
            <Button onClick={() => void save(true)} loading={saving === "on"} disabled={uploading}>{mode === "schedule" && !locked ? (postNow ? "Ligar e publicar agora" : "Ligar e agendar") : "Salvar e ligar"}</Button>
          </div>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="card p-4">
            <p className="mb-2 text-xs text-slate-400">Como a pessoa vê no Direct</p>
            <div className="chat-bg space-y-3 rounded-xl p-3">
              <p className="mx-auto w-fit rounded-full bg-black/40 px-3 py-1 text-[11px] text-slate-300">comentou {keywords[0] ? `“${keywords[0]}”` : "no seu post"}</p>
              {steps.map((s, i) => <Bubble key={i} text={s.text || `Mensagem ${i + 1}`} button={s.button || "Botão"} follow={i > 0 && s.requireFollow} />)}
              <Bubble text={finalText || "Mensagem final"} button={finalButton || "Abrir link"} link follow={finalFollow} />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">Cada toque no botão libera a mensagem seguinte. Etapas com <UserCheck className="inline h-3 w-3" /> só aparecem para quem te segue.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Card({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h3 className="mb-4 flex items-center gap-2.5 text-sm font-semibold text-white"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white">{n}</span>{title}</h3>
      {children}
    </section>
  );
}
function Warn({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{children}</p>;
}
function IconBtn({ children, label, onClick, disabled, danger }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return <button onClick={onClick} disabled={disabled} aria-label={label} title={label} className={cn("rounded-md p-1.5 text-slate-500 disabled:opacity-30", danger ? "hover:bg-red-500/10 hover:text-red-300" : "hover:bg-ink-700 hover:text-white")}>{children}</button>;
}
function FollowToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="inline-flex items-center gap-2 text-xs text-slate-300">
      <span className={cn("h-5 w-9 shrink-0 rounded-full p-0.5 transition", on ? "bg-emerald-500" : "bg-ink-600")}><span className={cn("block h-4 w-4 rounded-full bg-white transition", on && "translate-x-4")} /></span>
      Só para quem me segue
    </button>
  );
}
function Bubble({ text, button, link, follow }: { text: string; button: string; link?: boolean; follow?: boolean }) {
  return (
    <div className="max-w-[92%] overflow-hidden rounded-2xl bg-ink-700 text-[13px] text-slate-100">
      {follow && <p className="flex items-center gap-1 bg-emerald-500/15 px-3 py-1 text-[11px] text-emerald-300"><UserCheck className="h-3 w-3" /> só para quem segue</p>}
      <p className="whitespace-pre-wrap px-3 py-2">{text}</p>
      <p className="flex items-center justify-center gap-1.5 border-t border-white/10 px-3 py-2 text-center font-semibold text-sky-300">{link && <ExternalLink className="h-3.5 w-3.5" />}{button}</p>
    </div>
  );
}
