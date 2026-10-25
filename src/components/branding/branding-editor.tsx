"use client";
/* eslint-disable @next/next/no-img-element -- logos enviadas pela empresa (armazenamento público) */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Copy, Globe, ImagePlus, KanbanSquare, Loader2, MessageCircle, RefreshCw, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { palette, DEFAULT_COLOR } from "@/lib/branding/shared";

interface Row {
  app_name: string | null; logo_url: string | null; icon_url: string | null; primary_color: string | null;
  login_title: string | null; login_subtitle: string | null; support_whatsapp: string | null; hide_powered_by: boolean;
  custom_domain: string | null; domain_status: string | null;
}
interface DnsRecord { type: string; name: string; value: string; why: string }
interface DomainInfo { domain: string | null; status?: string; verified?: boolean; configured?: boolean; records?: DnsRecord[] }

const SWATCHES = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#d97706", "#16a34a", "#0d9488", "#0891b2", "#475569", "#111827", "#b45309"];

/** Editor da marca da empresa: nome, logo, ícone, cor, tela de login e domínio próprio, com prévia ao vivo. */
export function BrandingEditor({ orgId, onSaved }: { orgId?: string; onSaved?: () => void }) {
  const q = orgId ? `?org=${orgId}` : "";
  const [loaded, setLoaded] = useState<{ canDomain: boolean; domainsReady: boolean; orgName: string } | null>(null);
  const [f, setF] = useState<Row>({ app_name: null, logo_url: null, icon_url: null, primary_color: DEFAULT_COLOR, login_title: null, login_subtitle: null, support_whatsapp: null, hide_powered_by: false, custom_domain: null, domain_status: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [domain, setDomain] = useState<DomainInfo | null>(null);
  const [newDomain, setNewDomain] = useState("");

  const load = useCallback(async () => {
    const r = await fetch(`/api/branding${q}`);
    const d = await r.json();
    if (!r.ok) { toast.error(d.error); return; }
    setLoaded({ canDomain: d.canDomain, domainsReady: d.domainsReady, orgName: d.orgName });
    if (d.branding) setF({ ...d.branding, primary_color: d.branding.primary_color ?? DEFAULT_COLOR });
    if (d.canDomain && d.branding?.custom_domain) {
      const r2 = await fetch(`/api/branding/domain${q}`);
      if (r2.ok) setDomain(await r2.json());
    }
  }, [q]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  async function upload(kind: "logo" | "icon", file: File) {
    setBusy(kind);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch(`/api/branding/upload${q}${q ? "&" : "?"}kind=${kind}`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setF((cur) => ({ ...cur, [`${kind}_url`]: d.url }));
      toast.success(kind === "logo" ? "Logo enviada" : "Ícone enviado");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  async function save() {
    setBusy("save");
    try {
      const r = await fetch(`/api/branding${q}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        app_name: f.app_name, primary_color: f.primary_color, login_title: f.login_title, login_subtitle: f.login_subtitle,
        support_whatsapp: f.support_whatsapp, hide_powered_by: f.hide_powered_by, logo_url: f.logo_url, icon_url: f.icon_url,
      }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      toast.success("Personalização salva");
      onSaved?.();
      if (!orgId) window.location.reload(); // aplica cores e logo na hora
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  async function addDomain() {
    setBusy("domain");
    try {
      const r = await fetch(`/api/branding/domain${q}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain: newDomain }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setDomain(d); setNewDomain("");
      setF((cur) => ({ ...cur, custom_domain: d.domain }));
      toast.success("Domínio adicionado. Agora crie os registros de DNS abaixo.");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }
  async function checkDomain() {
    setBusy("check");
    const r = await fetch(`/api/branding/domain${q}`);
    const d = await r.json();
    setBusy(null);
    if (!r.ok) return toast.error(d.error);
    setDomain(d);
    toast[d.status === "active" ? "success" : "message"](d.status === "active" ? "Domínio no ar com HTTPS!" : "Ainda não propagou. O DNS pode levar de minutos a algumas horas.");
  }
  async function removeDomain() {
    if (!confirm(`Desligar o domínio ${f.custom_domain}? Quem acessar por ele não verá mais o CRM.`)) return;
    const r = await fetch(`/api/branding/domain${q}`, { method: "DELETE" });
    if (r.ok) { setDomain(null); setF((cur) => ({ ...cur, custom_domain: null })); toast.success("Domínio removido"); }
  }

  const name = f.app_name || loaded?.orgName || "Sua empresa";
  const vars = useMemo(() => palette(f.primary_color ?? DEFAULT_COLOR) as React.CSSProperties, [f.primary_color]);
  const set = (k: keyof Row) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value || null });

  if (!loaded) return <div className="flex justify-center py-10"><Spinner /></div>;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <section className="space-y-3 rounded-xl border border-line bg-ink-900 p-4">
          <h3 className="font-semibold text-white">Identidade</h3>
          <Field label="Nome do sistema" hint={`Aparece no menu, na aba do navegador e no app do celular. Ex.: "${loaded.orgName} CRM".`}>
            <input className="field" maxLength={40} placeholder={loaded.orgName} value={f.app_name ?? ""} onChange={set("app_name")} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <ImagePick label="Logo (horizontal)" hint="PNG/WEBP com fundo transparente, ~400×120." url={f.logo_url} busy={busy === "logo"} wide
              onPick={(file) => void upload("logo", file)} onClear={() => setF({ ...f, logo_url: null })} />
            <ImagePick label="Ícone (quadrado)" hint="512×512. Aba do navegador e app do celular." url={f.icon_url} busy={busy === "icon"}
              onPick={(file) => void upload("icon", file)} onClear={() => setF({ ...f, icon_url: null })} />
          </div>
          <Field label="Cor principal">
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((c) => (
                <button key={c} type="button" onClick={() => setF({ ...f, primary_color: c })} aria-label={c}
                  className={cn("h-8 w-8 rounded-full border-2 transition", f.primary_color?.toLowerCase() === c ? "scale-110 border-white" : "border-transparent")} style={{ background: c }} />
              ))}
              <label className="flex items-center gap-2 rounded-lg border border-line px-2 py-1 text-xs text-slate-300">
                <input type="color" value={f.primary_color ?? DEFAULT_COLOR} onChange={(e) => setF({ ...f, primary_color: e.target.value })} className="h-6 w-8 cursor-pointer bg-transparent" />
                {f.primary_color}
              </label>
            </div>
          </Field>
        </section>

        <section className="space-y-3 rounded-xl border border-line bg-ink-900 p-4">
          <h3 className="font-semibold text-white">Tela de login</h3>
          <p className="text-xs text-slate-500">Aparece quando a equipe entra pelo domínio próprio. Lá não aparece “Criar conta”.</p>
          <Field label="Título"><input className="field" maxLength={120} placeholder={`Bem-vindo ao ${name}`} value={f.login_title ?? ""} onChange={set("login_title")} /></Field>
          <Field label="Frase de apoio"><input className="field" maxLength={300} placeholder="Atendimento e vendas em um só lugar." value={f.login_subtitle ?? ""} onChange={set("login_subtitle")} /></Field>
          <Field label="WhatsApp de suporte (opcional)" hint="Botão “Precisa de ajuda?” no login."><input className="field" inputMode="tel" placeholder="5585999990000" value={f.support_whatsapp ?? ""} onChange={set("support_whatsapp")} /></Field>
          {loaded.canDomain && (
            <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={f.hide_powered_by} onChange={(e) => setF({ ...f, hide_powered_by: e.target.checked })} /> Esconder “Tecnologia Nexo CRM” (white label total)</label>
          )}
        </section>

        <Button onClick={() => void save()} loading={busy === "save"} size="lg">Salvar personalização</Button>

        {loaded.canDomain && (
          <section className="space-y-3 rounded-xl border border-line bg-ink-900 p-4">
            <h3 className="flex items-center gap-2 font-semibold text-white"><Globe className="h-4 w-4 text-brand-300" /> Domínio próprio</h3>
            {!loaded.domainsReady && <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-200">Para ligar domínios, falta configurar no servidor o acesso à Vercel (VERCEL_API_TOKEN e VERCEL_PROJECT_ID).</p>}
            {!f.custom_domain ? (
              <>
                <p className="text-sm text-slate-400">O CRM abre num endereço do cliente, ex.: <b className="text-slate-200">crm.{(loaded.orgName || "empresa").toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "").slice(0, 16) || "empresa"}.com.br</b> — com HTTPS automático, logo e cores dele.</p>
                <div className="flex gap-2">
                  <input className="field flex-1" placeholder="crm.empresadocliente.com.br" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} autoComplete="off" />
                  <Button onClick={() => void addDomain()} loading={busy === "domain"} disabled={!newDomain.trim() || !loaded.domainsReady}>Adicionar</Button>
                </div>
                <p className="text-xs text-slate-500">Recomendado usar um subdomínio (crm.…): o site do cliente continua funcionando normalmente.</p>
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <a href={`https://${f.custom_domain}`} target="_blank" rel="noopener noreferrer" className="font-mono text-sm text-brand-200 hover:underline">https://{f.custom_domain}</a>
                  {domain?.status === "active" || f.domain_status === "active"
                    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300"><CheckCircle2 className="h-3 w-3" /> No ar</span>
                    : <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">Aguardando DNS</span>}
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void checkDomain()} loading={busy === "check"}><RefreshCw className="h-3.5 w-3.5" /> Verificar</Button>
                  <Button size="sm" variant="ghost" onClick={() => void removeDomain()}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
                {domain?.status !== "active" && domain?.records?.length ? (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-400">No painel onde o domínio foi comprado (Registro.br, Hostinger, GoDaddy, Cloudflare…), crie:</p>
                    <div className="overflow-x-auto rounded-lg border border-line">
                      <table className="w-full text-xs">
                        <thead className="text-left text-slate-500"><tr><th className="px-2 py-1.5">Tipo</th><th className="px-2 py-1.5">Nome</th><th className="px-2 py-1.5">Valor</th><th /></tr></thead>
                        <tbody className="divide-y divide-line">
                          {domain.records.map((r, i) => (
                            <tr key={i} className="text-slate-200">
                              <td className="px-2 py-1.5 font-semibold">{r.type}</td>
                              <td className="px-2 py-1.5 font-mono">{r.name}</td>
                              <td className="max-w-[220px] break-all px-2 py-1.5 font-mono">{r.value}</td>
                              <td className="px-2 py-1.5"><button onClick={() => void navigator.clipboard.writeText(r.value).then(() => toast.success("Copiado"))} className="text-slate-400 hover:text-white" aria-label="Copiar"><Copy className="h-3.5 w-3.5" /></button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-slate-500">Depois toque em “Verificar”. O certificado HTTPS é criado sozinho quando o DNS propagar.</p>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Prévia ao vivo */}
      <aside className="space-y-3" style={vars}>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Prévia</p>
        <div className="overflow-hidden rounded-xl border border-line bg-ink-950">
          <div className="flex">
            <div className="w-36 space-y-3 border-r border-line bg-ink-900/70 p-3">
              {f.logo_url ? <img src={f.logo_url} alt="" className="h-7 max-w-full object-contain object-left" />
                : <div className="flex items-center gap-1.5">{f.icon_url ? <img src={f.icon_url} alt="" className="h-6 w-6 rounded object-contain" /> : <span className="flex h-6 w-6 items-center justify-center rounded bg-brand-500 text-[11px] font-bold text-white">{name[0]?.toUpperCase()}</span>}<span className="truncate text-xs font-semibold text-white">{name}</span></div>}
              {[["Funil", KanbanSquare], ["Conversas", MessageCircle], ["Leads", Users]].map(([l, I], i) => {
                const Icon = I as typeof Users;
                return <div key={l as string} className={cn("flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px]", i === 0 ? "bg-ink-800 text-white" : "text-slate-400")}><Icon className={cn("h-3 w-3", i === 0 && "text-brand-300")} />{l as string}</div>;
              })}
            </div>
            <div className="flex-1 space-y-2 p-3">
              <div className="h-2 w-16 rounded bg-slate-700" />
              <div className="rounded-lg border border-line bg-ink-850 p-2"><div className="h-1.5 w-20 rounded bg-slate-600" /><div className="mt-1.5 h-1.5 w-12 rounded bg-brand-400/70" /></div>
              <div className="rounded-lg border border-line bg-ink-850 p-2"><div className="h-1.5 w-16 rounded bg-slate-600" /></div>
              <span className="inline-block rounded-md bg-brand-500 px-2 py-1 text-[10px] font-medium text-white shadow-glow">Botão</span>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-ink-950 p-4">
          {f.logo_url ? <img src={f.logo_url} alt="" className="h-7 max-w-full object-contain object-left" /> : <span className="text-sm font-semibold text-white">{name}</span>}
          <p className="mt-3 text-sm font-semibold text-white">{f.login_title || `Bem-vindo ao ${name}`}</p>
          {f.login_subtitle && <p className="text-xs text-slate-400">{f.login_subtitle}</p>}
          <div className="mt-3 space-y-1.5"><div className="h-6 rounded border border-line bg-ink-900" /><div className="h-6 rounded border border-line bg-ink-900" /></div>
          <div className="mt-2 rounded bg-brand-500 py-1.5 text-center text-[11px] font-medium text-white">Entrar</div>
          {!f.hide_powered_by && <p className="mt-2 text-center text-[10px] text-slate-600">Tecnologia Nexo CRM</p>}
        </div>
      </aside>
    </div>
  );
}

function ImagePick({ label, hint, url, busy, wide, onPick, onClear }: { label: string; hint: string; url: string | null; busy: boolean; wide?: boolean; onPick: (f: File) => void; onClear: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => input.current?.click()} className={cn("flex items-center justify-center overflow-hidden rounded-lg border border-dashed border-line bg-ink-850 hover:border-brand-400/50", wide ? "h-14 w-40" : "h-14 w-14")}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" /> : <ImagePlus className="h-5 w-5 text-slate-500" />}
        </button>
        {url && <button type="button" onClick={onClear} className="text-xs text-slate-500 hover:text-red-300">remover</button>}
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) onPick(file); e.target.value = ""; }} />
      </div>
    </Field>
  );
}
