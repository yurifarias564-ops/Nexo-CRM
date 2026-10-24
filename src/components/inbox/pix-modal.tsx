"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Field, Modal, Spinner } from "@/components/ui/misc";
import { displayPixKey, PIX_KEY_LABEL, type PixKeyType } from "@/lib/pix";
import { cn } from "@/lib/utils";

interface PixKey { id: string; key_type: PixKeyType; key: string; holder_name: string; city: string; label: string | null }

export function PixIcon({ className }: { className?: string }) {
  // Losango do Pix (desenho simples, sem a marca oficial)
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M12 2.5 6.6 7.9l2.1 2.1a1.9 1.9 0 0 0 2.7 0L12 9.4l.6.6a1.9 1.9 0 0 0 2.7 0l2.1-2.1L12 2.5Zm-6.9 6.9L2.5 12l2.6 2.6 2.4-2.4a.3.3 0 0 0 0-.4L5.1 9.4Zm13.8 0-2.4 2.4a.3.3 0 0 0 0 .4l2.4 2.4 2.6-2.6-2.6-2.6ZM12 14.6l-.6.6a1.9 1.9 0 0 1-2.7 0l-2.1-2.1L12 21.5l5.4-5.4-2.1-2.1a1.9 1.9 0 0 0-2.7 0l-.6.6Z" />
    </svg>
  );
}

const TYPES: PixKeyType[] = ["cnpj", "cpf", "phone", "email", "random"];
const PLACEHOLDER: Record<PixKeyType, string> = {
  cnpj: "00.000.000/0000-00", cpf: "000.000.000-00", phone: "(85) 99999-9999", email: "financeiro@empresa.com", random: "00000000-0000-0000-0000-000000000000",
};

/** "Solicitar pagamento" via Pix, como no WhatsApp: escolhe a chave, valor opcional e envia. */
export function PixModal({ open, onClose, contactName, onSend }: {
  open: boolean; onClose: () => void; contactName: string;
  onSend: (p: { keyId: string; amount: number | null; description?: string }) => Promise<void>;
}) {
  const ws = useWorkspace();
  const [keys, setKeys] = useState<PixKey[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ type: "cnpj" as PixKeyType, key: "", holderName: "", city: "", label: "" });

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from("pix_keys").select("id, key_type, key, holder_name, city, label").eq("organization_id", ws.orgId).order("created_at");
    const list = (data ?? []) as PixKey[];
    setKeys(list);
    setSel((s) => (s && list.some((k) => k.id === s) ? s : list[0]?.id ?? null));
    if (!list.length) setAdding(true);
  }, [ws.orgId]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { setAmount(""); setDesc(""); setPicking(false); setAdding(false); void load(); }, 0);
    return () => clearTimeout(t);
  }, [open, load]);

  const key = keys?.find((k) => k.id === sel) ?? null;
  const value = Number(amount.replace(/\./g, "").replace(",", ".")) || null;

  async function addKey() {
    setBusy(true);
    try {
      const res = await fetch("/api/pix/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Chave Pix cadastrada");
      setForm({ type: "cnpj", key: "", holderName: "", city: "", label: "" });
      setAdding(false); setPicking(false);
      await load();
      setSel(data.id);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function removeKey(id: string) {
    if (!confirm("Excluir esta chave Pix do CRM? (Não mexe na sua conta do banco.)")) return;
    const { error } = await supabaseBrowser().from("pix_keys").delete().eq("id", id);
    if (error) return toast.error(error.message);
    await load();
  }

  async function submit() {
    if (!key) return;
    setBusy(true);
    try { await onSend({ keyId: key.id, amount: value, description: desc.trim() || undefined }); onClose(); }
    catch (e) { toast.error((e as Error).message || "Não consegui enviar o Pix"); }
    finally { setBusy(false); }
  }

  const showForm = adding && ws.canManage;

  return (
    <Modal open={open} onClose={onClose} title={showForm ? "Nova chave Pix" : "Solicitar pagamento"}
      footer={showForm ? (
        <>
          {keys && keys.length > 0 && <Button variant="ghost" onClick={() => setAdding(false)}>Voltar</Button>}
          <Button onClick={addKey} loading={busy} disabled={!form.key.trim() || form.holderName.trim().length < 2 || form.city.trim().length < 2}>Salvar chave</Button>
        </>
      ) : (
        <Button className="w-full" onClick={submit} loading={busy} disabled={!key}>Enviar solicitação</Button>
      )}>
      <div className="space-y-3 text-sm" data-modal-body>
        {keys === null ? <div className="flex justify-center py-6"><Spinner /></div> : showForm ? (
          <>
            <p className="text-slate-400">O dinheiro cai direto na conta dona da chave. O CRM só gera o código Pix para o cliente pagar.</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipo de chave">
              {TYPES.map((t) => (
                <button key={t} type="button" role="radio" aria-checked={form.type === t} onClick={() => setForm({ ...form, type: t })}
                  className={cn("rounded-full border px-3 py-1 text-xs", form.type === t ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-200" : "border-line text-slate-400 hover:text-slate-200")}>
                  {PIX_KEY_LABEL[t]}
                </button>
              ))}
            </div>
            <Field label={`Chave (${PIX_KEY_LABEL[form.type]})`}>
              <input className="field" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder={PLACEHOLDER[form.type]}
                inputMode={form.type === "email" || form.type === "random" ? "text" : "numeric"} autoComplete="off" />
            </Field>
            <Field label="Nome do recebedor" hint="Como aparece no banco (empresa ou pessoa dona da chave).">
              <input className="field" value={form.holderName} maxLength={60} onChange={(e) => setForm({ ...form, holderName: e.target.value })} placeholder={ws.orgName} />
            </Field>
            <Field label="Cidade"><input className="field" value={form.city} maxLength={40} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Maracanaú" /></Field>
            <Field label="Apelido (opcional)"><input className="field" value={form.label} maxLength={40} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Ex.: Conta da loja" /></Field>
          </>
        ) : !keys.length ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-amber-100">Nenhuma chave Pix cadastrada. Peça ao administrador para cadastrar a chave da empresa aqui no chat (botão + → Pix).</p>
        ) : (
          <>
            <p className="text-center text-slate-400"><b className="text-slate-200">{contactName}</b> vai receber o Pix com o botão de copiar, como no WhatsApp.</p>
            {picking ? (
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                {keys.map((k) => (
                  <li key={k.id} className="flex items-center gap-2 px-3 py-2.5">
                    <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => { setSel(k.id); setPicking(false); }}>
                      <PixIcon className="h-6 w-6 shrink-0 text-emerald-300" />
                      <span className="min-w-0"><span className="block truncate text-slate-100">{k.label || "Pix"}</span><span className="block truncate text-xs text-slate-500">{PIX_KEY_LABEL[k.key_type]}: {displayPixKey(k.key_type, k.key)}</span></span>
                      {sel === k.id && <Check className="ml-auto h-4 w-4 text-emerald-300" />}
                    </button>
                    {ws.canManage && <button onClick={() => void removeKey(k.id)} className="rounded p-1 text-slate-500 hover:text-red-300" aria-label="Excluir chave"><Trash2 className="h-4 w-4" /></button>}
                  </li>
                ))}
                {ws.canManage && (
                  <li><button className="flex w-full items-center gap-3 px-3 py-2.5 text-brand-300 hover:bg-ink-800" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Cadastrar outra chave</button></li>
                )}
              </ul>
            ) : key && (
              <div className="flex items-center gap-3 rounded-xl bg-ink-800 px-4 py-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300"><PixIcon className="h-6 w-6" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-slate-100">{key.label || "Pix"}</span>
                  <span className="block truncate text-xs text-slate-400">{PIX_KEY_LABEL[key.key_type]}: {displayPixKey(key.key_type, key.key)}</span>
                </span>
                <button onClick={() => setPicking(true)} className="rounded-full p-2 text-slate-300 hover:bg-ink-700" aria-label="Trocar chave" title="Trocar chave"><Pencil className="h-4 w-4" /></button>
              </div>
            )}
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">R$</span>
              <input className="field rounded-full pl-11" inputMode="decimal" placeholder="Valor (opcional)" value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} />
            </div>
            <input className="field rounded-full" maxLength={40} placeholder="Referente a… (opcional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </>
        )}
      </div>
    </Modal>
  );
}
