"use client";
import { useEffect, useMemo, useState } from "react";
import { FileText, Send } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Empty, Field, Modal, Spinner } from "@/components/ui/misc";

type Template = { name: string; language: string; category: string; body: string; params: number };

/**
 * Envio de modelo aprovado pela Meta. Necessário na API oficial quando o
 * cliente não escreve há mais de 24h (ou para iniciar conversa nova).
 */
export function TemplateModal({
  open, onClose, target, channelId, defaultFirstParam, onSent,
}: {
  open: boolean;
  onClose: () => void;
  target: { conversationId?: string; leadId?: string };
  channelId?: string | null;
  defaultFirstParam?: string;
  onSent?: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Enviar modelo aprovado" wide>
      {open && <Body target={target} channelId={channelId ?? null} defaultFirstParam={defaultFirstParam} onDone={() => { onSent?.(); onClose(); }} />}
    </Modal>
  );
}

function Body({ target, channelId, defaultFirstParam, onDone }: {
  target: { conversationId?: string; leadId?: string };
  channelId: string | null;
  defaultFirstParam?: string;
  onDone: () => void;
}) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [chId, setChId] = useState<string | null>(channelId);
  const [selected, setSelected] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let id = channelId;
      if (!id) {
        const { data } = await supabaseBrowser().from("whatsapp_channels").select("id").eq("provider", "meta").eq("status", "connected").order("created_at").limit(1).maybeSingle();
        id = data?.id ?? null;
      }
      if (!alive) return;
      setChId(id);
      if (!id) { setTemplates([]); return; }
      const res = await fetch(`/api/channels/${id}/templates`, { cache: "no-store" });
      const body = await res.json();
      if (!alive) return;
      if (!res.ok) { setErr(body.error); setTemplates([]); return; }
      setTemplates(body.templates);
    })();
    return () => { alive = false; };
  }, [channelId]);

  const tpl = useMemo(() => templates?.find((t) => `${t.name}|${t.language}` === selected) ?? null, [templates, selected]);
  const preview = tpl ? tpl.body.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => params[Number(n) - 1] || `{{${n}}}`) : "";

  function choose(key: string) {
    setSelected(key);
    const t = templates?.find((x) => `${x.name}|${x.language}` === key);
    setParams(Array.from({ length: t?.params ?? 0 }, (_, i) => (i === 0 && defaultFirstParam ? defaultFirstParam : "")));
  }

  async function send() {
    if (!tpl) return;
    setSending(true);
    const res = await fetch("/api/messages/template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...target, channelId: chId ?? undefined, name: tpl.name, language: tpl.language, params }),
    });
    const body = await res.json();
    setSending(false);
    if (!res.ok) return toast.error(body.error);
    toast.success("Modelo enviado. Quando o cliente responder, a conversa livre é liberada.");
    onDone();
  }

  if (!templates) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (!templates.length) {
    return (
      <Empty icon={<FileText className="h-5 w-5" />} title={chId ? "Nenhum modelo aprovado disponível" : "Nenhum número oficial conectado"}
        text={err ?? (chId
          ? "Crie e aprove modelos no Gerenciador do WhatsApp da Meta. Aparecem aqui os modelos com variáveis só no texto."
          : "Modelos só existem na API oficial da Meta.")} />
    );
  }

  return (
    <div className="space-y-4">
      <Field label="Modelo">
        <select className="field" value={selected} onChange={(e) => choose(e.target.value)}>
          <option value="" disabled>Escolha um modelo…</option>
          {templates.map((t) => (
            <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} · {t.language} · {t.category.toLowerCase()}</option>
          ))}
        </select>
      </Field>
      {tpl && (
        <>
          {params.map((p, i) => (
            <Field key={i} label={`Variável {{${i + 1}}}`}>
              <input className="field" value={p} maxLength={1024} onChange={(e) => setParams((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))} />
            </Field>
          ))}
          <div>
            <span className="label">Prévia</span>
            <p className="whitespace-pre-wrap rounded-xl rounded-br-md bg-gradient-to-br from-brand-600 to-navy-500 p-3 text-sm text-white">{preview}</p>
          </div>
          <div className="flex justify-end">
            <Button onClick={send} loading={sending} disabled={params.some((p) => !p.trim())}><Send className="h-4 w-4" /> Enviar modelo</Button>
          </div>
        </>
      )}
    </div>
  );
}
