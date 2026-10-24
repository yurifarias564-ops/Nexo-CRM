"use client";
import { useEffect, useState } from "react";
import { Crosshair, MapPin, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Modal } from "@/components/ui/misc";
import { parseCoords } from "@/lib/geo";

export interface LocationPick { latitude: number; longitude: number; name?: string; address?: string }

export function LocationModal({ open, onClose, onSend }: { open: boolean; onClose: () => void; onSend: (l: LocationPick) => Promise<void> | void }) {
  const [where, setWhere] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const coords = parseCoords(where);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { setWhere(""); setName(""); setAddress(""); setErr(null); }, 0);
    return () => clearTimeout(t);
  }, [open]);

  function useMine() {
    if (!navigator.geolocation) return setErr("Este aparelho não informa a localização.");
    setLocating(true); setErr(null);
    navigator.geolocation.getCurrentPosition(
      (p) => { setWhere(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`); setLocating(false); },
      () => { setErr("Não consegui pegar sua localização. Permita o acesso à localização ou cole um link do Google Maps."); setLocating(false); },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  async function submit() {
    if (!coords) return;
    setBusy(true);
    try { await onSend({ ...coords, name: name.trim() || undefined, address: address.trim() || undefined }); onClose(); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Enviar localização"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={submit} loading={busy} disabled={!coords}><Send className="h-4 w-4" /> Enviar</Button></>}>
      <div className="space-y-3 text-sm" data-modal-body>
        <Button variant="outline" className="w-full" onClick={useMine} loading={locating}><Crosshair className="h-4 w-4" /> Usar minha localização atual</Button>
        <Field label="Ou cole o link do Google Maps / coordenadas" hint='Abra o local no Google Maps → Compartilhar → Copiar link. Ou digite "-3.8765, -38.6254".'>
          <input className="field" value={where} onChange={(e) => setWhere(e.target.value)} placeholder="https://maps.google.com/... ou -3.87, -38.62" />
        </Field>
        {where && !coords && <p className="text-xs text-amber-300">Não achei as coordenadas nesse link. Links curtos (maps.app.goo.gl) não trazem a posição: abra o link, copie o endereço completo da barra do navegador e cole aqui.</p>}
        {coords && (
          <a className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-emerald-200 hover:bg-emerald-500/10"
            href={`https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`} target="_blank" rel="noopener noreferrer">
            <MapPin className="h-4 w-4" /> {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)} · conferir no mapa
          </a>
        )}
        <Field label="Nome do local (opcional)"><input className="field" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Loja Centro" /></Field>
        <Field label="Endereço (opcional)"><input className="field" value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, número, bairro" /></Field>
        {err && <p className="text-xs text-red-300">{err}</p>}
      </div>
    </Modal>
  );
}
