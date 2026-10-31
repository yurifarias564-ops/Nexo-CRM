"use client";
import { useEffect, useState } from "react";
import { Send, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Responder o chat da OLX deste lead (aparece só quando o lead veio de um chat da OLX). */
export function OlxReply({ leadId, onSent }: { leadId: string; onSent?: () => void }) {
  const [has, setHas] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabaseBrowser().from("olx_chats").select("id").eq("lead_id", leadId).limit(1).then(({ data }) => setHas(Boolean(data?.length)));
  }, [leadId]);
  if (!has) return null;
  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    const r = await fetch("/api/olx/reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId, text }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast.error(j.error ?? "Não foi possível responder");
    toast.success("Resposta enviada no chat da OLX");
    setText("");
    onSent?.();
  }
  return (
    <div className="space-y-2 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-violet-200"><ShoppingBag className="h-3.5 w-3.5" /> Responder no chat da OLX</p>
      <div className="flex gap-2">
        <input className="field" value={text} maxLength={2000} placeholder="Escreva a resposta…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} />
        <Button onClick={() => void send()} loading={busy}><Send className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
