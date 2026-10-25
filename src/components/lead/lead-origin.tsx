"use client";
import { useCallback, useEffect, useState } from "react";
import { Megaphone, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CHANNELS, NOT_TRACKED, type Channel } from "@/lib/tracking/shared";

interface Origin { channel: Channel; source_type: string; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null; utm_term: string | null; ad_id: string | null; ad_title: string | null; ad_url: string | null; created_at: string }

const TYPE: Record<string, string> = { link: "link rastreado", anuncio_whatsapp: "anúncio de clique para o WhatsApp", site: "botão do site", manual: "informado manualmente" };

/** Origem do lead (campanha, criativo, anúncio) — com edição manual. */
export function LeadOrigin({ leadId }: { leadId: string }) {
  const [o, setO] = useState<Origin | null | undefined>(undefined);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ channel: "", utm_campaign: "", utm_content: "" });

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from("lead_origins").select("*").eq("lead_id", leadId).maybeSingle();
    setO((data as Origin | null) ?? null);
  }, [leadId]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  async function save() {
    const res = await fetch("/api/tracking/origin", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId, channel: f.channel || null, utm_campaign: f.utm_campaign, utm_content: f.utm_content }) });
    const data = await res.json();
    if (!res.ok) return toast.error(data.error);
    setEdit(false); void load();
  }

  if (o === undefined) return null;
  const ch = o ? CHANNELS[o.channel] : NOT_TRACKED;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="label mb-0">Origem</span>
        {!edit && <button onClick={() => { setF({ channel: o?.channel ?? "", utm_campaign: o?.utm_campaign ?? "", utm_content: o?.utm_content ?? "" }); setEdit(true); }} className="rounded p-1 text-slate-500 hover:text-slate-200" aria-label="Editar origem"><Pencil className="h-3.5 w-3.5" /></button>}
      </div>
      {edit ? (
        <div className="space-y-2 rounded-lg border border-line bg-ink-850 p-3">
          <select className="field h-9 text-sm" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
            <option value="">Não rastreado</option>
            {Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <input className="field h-9 text-sm" placeholder="Campanha (opcional)" maxLength={200} value={f.utm_campaign} onChange={(e) => setF({ ...f, utm_campaign: e.target.value })} />
          <input className="field h-9 text-sm" placeholder="Criativo / anúncio (opcional)" maxLength={200} value={f.utm_content} onChange={(e) => setF({ ...f, utm_content: e.target.value })} />
          <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEdit(false)}>Cancelar</Button><Button size="sm" onClick={() => void save()}>Salvar</Button></div>
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-ink-850 px-3 py-2 text-sm">
          <p className="flex items-center gap-2 text-slate-100"><span className="h-2.5 w-2.5 rounded-full" style={{ background: ch.color }} /> {ch.label}
            {o && <span className="text-xs text-slate-500">· {TYPE[o.source_type] ?? o.source_type}</span>}
          </p>
          {o && (o.utm_campaign || o.ad_title) && <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-300"><Megaphone className="mt-0.5 h-3 w-3 shrink-0 text-slate-500" /> Campanha: {o.utm_campaign || o.ad_title}</p>}
          {o && (o.utm_content || o.ad_id) && <p className="mt-0.5 text-xs text-slate-400">Criativo: {o.utm_content || o.ad_id}</p>}
          {o?.ad_url && <a href={o.ad_url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block text-xs text-brand-300 hover:text-brand-200">Ver anúncio →</a>}
          {!o && <p className="text-xs text-slate-500">Chegou sem link rastreado nem anúncio. Toque no lápis para informar (ex.: indicação).</p>}
        </div>
      )}
    </div>
  );
}
