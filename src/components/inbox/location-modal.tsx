"use client";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as LMap, CircleMarker } from "leaflet";
import { Crosshair, LocateFixed, MapPin, Navigation, Search, Send, X } from "lucide-react";
import { Spinner } from "@/components/ui/misc";
import { parseCoords } from "@/lib/geo";
import { cn } from "@/lib/utils";

export interface LocationPick { latitude: number; longitude: number; name?: string; address?: string }

// Mapa: OpenStreetMap (Leaflet). Busca e locais próximos: Photon (geocoder aberto do OSM).
const PHOTON = "https://photon.komoot.io";
const FALLBACK: [number, number] = [-3.7319, -38.5267]; // Fortaleza

type Place = { name: string; address: string; lat: number; lng: number; kind: string };
type Feature = { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> };

function toPlace(f: Feature): Place {
  const p = f.properties;
  const street = [p.street, p.housenumber].filter(Boolean).join(", ");
  const address = [street, p.district || p.locality, p.city, p.state].filter(Boolean).join(", ");
  const name = p.name || street || p.city || "Local";
  return { name, address: address === name ? [p.city, p.state].filter(Boolean).join(", ") : address, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], kind: p.osm_key === "highway" ? "street" : p.osm_value ?? "" };
}

async function photon(path: string, signal?: AbortSignal): Promise<Place[]> {
  const res = await fetch(`${PHOTON}${path}`, { signal });
  if (!res.ok) return [];
  const body = (await res.json().catch(() => ({}))) as { features?: Feature[] };
  return (body.features ?? []).map(toPlace);
}

/** Enviar localização no estilo do WhatsApp: mapa com pino, busca e locais próximos. */
export function LocationModal({ open, onClose, onSend }: { open: boolean; onClose: () => void; onSend: (l: LocationPick) => Promise<void> | void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const meDot = useRef<CircleMarker | null>(null);
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [pinAddr, setPinAddr] = useState<Place | null>(null);
  const [me, setMe] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [nearby, setNearby] = useState<Place[]>([]);
  const [nearLoading, setNearLoading] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [locError, setLocError] = useState<string | null>(null);

  const locate = useCallback((fly = true) => {
    if (!navigator.geolocation) { setLocError("Este aparelho não informa a localização."); return; }
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const v = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) };
        setMe(v);
        if (map.current) {
          import("leaflet").then(({ default: L }) => {
            meDot.current?.remove();
            meDot.current = L.circleMarker([v.lat, v.lng], { radius: 8, color: "#fff", weight: 3, fillColor: "#3b82f6", fillOpacity: 1 }).addTo(map.current!);
          });
          if (fly) map.current.setView([v.lat, v.lng], 17);
        }
      },
      () => setLocError("Permita o acesso à localização para usar a sua posição atual."),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }, []);

  // Cria o mapa ao abrir
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let m: LMap | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (!alive || !box.current) return;
      m = L.map(box.current, { zoomControl: false, attributionControl: true }).setView(FALLBACK, 13);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
      map.current = m;
      const update = () => { const c = m!.getCenter(); setCenter({ lat: c.lat, lng: c.lng }); };
      m.on("moveend", update);
      update();
      setTimeout(() => m?.invalidateSize(), 150);
      locate(true);
    })();
    return () => {
      alive = false;
      m?.remove();
      map.current = null;
      meDot.current = null;
      setQ(""); setResults([]); setNearby([]); setPinAddr(null); setMe(null); setCenter(null);
    };
  }, [open, locate]);

  // Endereço do pino + locais próximos (espera o mapa parar)
  useEffect(() => {
    if (!center) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setNearLoading(true);
      try {
        const [pin, near] = await Promise.all([
          photon(`/reverse?lat=${center.lat}&lon=${center.lng}&limit=1`, ctl.signal),
          photon(`/reverse?lat=${center.lat}&lon=${center.lng}&limit=12&radius=0.35`, ctl.signal),
        ]);
        setPinAddr(pin[0] ?? null);
        const seen = new Set<string>();
        const uniq = near.filter((p) => p.name && p.kind !== "house" && !seen.has(p.name) && seen.add(p.name));
        // Comércios e pontos de referência primeiro; ruas depois
        setNearby([...uniq.filter((p) => p.kind !== "street"), ...uniq.filter((p) => p.kind === "street")].slice(0, 8));
      } catch { /* cancelado */ } finally { setNearLoading(false); }
    }, 450);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [center]);

  // Busca por endereço / link do Maps / coordenadas
  useEffect(() => {
    const text = q.trim();
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      if (text.length < 3) { setResults([]); return; }
      const coords = parseCoords(text);
      if (coords) { map.current?.setView([coords.latitude, coords.longitude], 17); setResults([]); return; }
      setSearching(true);
      const c = map.current?.getCenter();
      try {
        setResults(await photon(`/api?q=${encodeURIComponent(text)}&limit=6${c ? `&lat=${c.lat}&lon=${c.lng}` : ""}`, ctl.signal));
      } catch { /* cancelado */ } finally { setSearching(false); }
    }, 400);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  async function send(key: string, l: LocationPick) {
    setSending(key);
    try { await onSend(l); onClose(); }
    catch { /* erro já avisado */ }
    finally { setSending(null); }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Enviar localização">
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-ink-900 sm:h-[86vh] sm:max-w-lg sm:rounded-2xl sm:border sm:border-line">
        <div className="flex items-center gap-2 px-3 pb-2 pt-3">
          <button onClick={onClose} className="rounded-full p-2 text-slate-300 hover:bg-ink-800" aria-label="Fechar"><X className="h-5 w-5" /></button>
          <p className="flex-1 text-center font-semibold text-white">Enviar localização</p>
          <span className="w-9" />
        </div>
        <div className="relative px-3 pb-2">
          <Search className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input className="field rounded-full pl-9" placeholder="Pesquise, insira um endereço ou cole link do Maps" value={q} onChange={(e) => setQ(e.target.value)} />
          {(results.length > 0 || searching) && (
            <ul className="absolute inset-x-3 top-full z-[1000] mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-ink-850 shadow-card">
              {searching && !results.length && <li className="flex justify-center p-3"><Spinner /></li>}
              {results.map((r, i) => (
                <li key={`${r.lat},${r.lng},${i}`}>
                  <button className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-ink-700"
                    onClick={() => { map.current?.setView([r.lat, r.lng], 17); setQ(""); setResults([]); }}>
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
                    <span className="min-w-0"><span className="block truncate text-sm text-slate-100">{r.name}</span><span className="block truncate text-xs text-slate-500">{r.address}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="relative h-[42%] min-h-[220px] shrink-0">
          <div ref={box} className="absolute inset-0 z-0" />
          {/* Pino fixo no centro: arraste o mapa para escolher o ponto */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-full">
            <MapPin className="h-10 w-10 fill-red-500 text-red-700 drop-shadow-lg" />
          </div>
          <button onClick={() => locate(true)} className="absolute right-3 top-3 z-[500] rounded-xl bg-ink-900/90 p-2.5 text-white shadow-card hover:bg-ink-800" aria-label="Ir para minha localização" title="Minha localização">
            <Navigation className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          <button disabled={!center || Boolean(sending)}
            onClick={() => center && void send("pin", { latitude: center.lat, longitude: center.lng, name: pinAddr?.name, address: pinAddr?.address })}
            className="flex w-full items-center gap-3 rounded-2xl bg-ink-800 px-4 py-3 text-left hover:bg-ink-700 disabled:opacity-60">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-300"><MapPin className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-white">Enviar este ponto do mapa</span>
              <span className="block truncate text-xs text-slate-400">{pinAddr ? [pinAddr.name, pinAddr.address].filter(Boolean).join(" · ") : "Arraste o mapa para ajustar o pino"}</span>
            </span>
            {sending === "pin" ? <Spinner /> : <Send className="h-4 w-4 text-brand-300" />}
          </button>

          <p className="mb-2 mt-4 px-1 text-sm font-medium text-slate-400">Locais próximos</p>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-ink-800">
            <li>
              <button disabled={!me || Boolean(sending)} onClick={() => me && void send("me", { latitude: me.lat, longitude: me.lng })}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-700 disabled:opacity-60">
                <LocateFixed className="h-5 w-5 shrink-0 text-sky-300" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-white">Localização atual</span>
                  <span className="block truncate text-xs text-slate-500">{me ? `Precisão de ${me.acc} m` : locError ?? "Buscando sua posição…"}</span>
                </span>
                {sending === "me" ? <Spinner /> : !me && !locError ? <Crosshair className="h-4 w-4 animate-pulse text-slate-500" /> : null}
              </button>
            </li>
            {nearLoading && !nearby.length && <li className="flex justify-center p-4"><Spinner /></li>}
            {nearby.map((p, i) => (
              <li key={`${p.lat},${p.lng},${i}`}>
                <button disabled={Boolean(sending)} onClick={() => void send(`n${i}`, { latitude: p.lat, longitude: p.lng, name: p.name, address: p.address || undefined })}
                  className={cn("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-700 disabled:opacity-60")}>
                  <MapPin className="h-5 w-5 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-white">{p.name}</span>
                    <span className="block truncate text-xs text-slate-500">{p.address}</span>
                  </span>
                  {sending === `n${i}` && <Spinner />}
                </button>
              </li>
            ))}
            {!nearLoading && !nearby.length && <li className="px-4 py-3 text-xs text-slate-500">Nenhum local com nome por perto. Use “Enviar este ponto do mapa”.</li>}
          </ul>
          <p className="mt-3 px-1 text-[11px] text-slate-600">Localização em tempo real não é liberada pelo WhatsApp para sistemas — envie o ponto fixo.</p>
        </div>
      </div>
    </div>
  );
}

