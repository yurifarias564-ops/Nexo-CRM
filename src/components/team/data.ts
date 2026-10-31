"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { DEFAULT_TZ } from "@/lib/time";
import type { TeamMetric, TeamNote, TeamSale, TeamSeller, TeamSellerGoal, TeamSettings, TeamStore, TeamValue } from "@/lib/team";

export function browserTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ; } catch { return DEFAULT_TZ; }
}

export interface TeamBase {
  stores: TeamStore[];
  sellers: TeamSeller[];
  metrics: TeamMetric[];
  goals: TeamSellerGoal[];
  settings: TeamSettings;
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Lê a configuração do time pelo login (RLS). */
export async function loadBaseSb(orgId: string): Promise<TeamBase> {
  const sb = supabaseBrowser();
  const [st, s, m, g, cfg] = await Promise.all([
    sb.from("team_stores").select("id, name, revenue_goal, os_daily_goal, position").eq("organization_id", orgId).order("position").order("created_at"),
    sb.from("team_sellers").select("id, name, user_id, active, position, role, store_id").eq("organization_id", orgId).order("position").order("created_at"),
    sb.from("team_metrics").select("id, name, unit, source:origin, role, result_of, daily_target, weekly_target, monthly_target, active, position").eq("organization_id", orgId).order("position").order("created_at"),
    sb.from("team_seller_goals").select("seller_id, metric_id, daily_target, weekly_target, monthly_target").eq("organization_id", orgId),
    sb.from("team_settings").select("cycle_start, baseline, baseline_note").eq("organization_id", orgId).maybeSingle(),
  ]);
  const err = st.error ?? s.error ?? m.error ?? g.error ?? cfg.error;
  if (err) throw new Error(err.message);
  return normalizeBase({ stores: st.data ?? [], sellers: s.data ?? [], metrics: m.data ?? [], goals: g.data ?? [], settings: cfg.data ?? null });
}

/** Converte o que vem do banco (numeric como texto) no formato do checklist. Também usado pelo link público. */
export function normalizeBase(raw: { stores: unknown[]; sellers: unknown[]; metrics: unknown[]; goals: unknown[]; settings: Record<string, unknown> | null }): TeamBase {
  return {
    stores: (raw.stores as TeamStore[]).map((x) => ({ ...x, revenue_goal: n(x.revenue_goal), os_daily_goal: n(x.os_daily_goal) })),
    sellers: raw.sellers as TeamSeller[],
    metrics: (raw.metrics as TeamMetric[]).map((x) => ({ ...x, daily_target: n(x.daily_target), weekly_target: n(x.weekly_target), monthly_target: n(x.monthly_target) })),
    goals: (raw.goals as TeamSellerGoal[]).map((x) => ({ ...x, daily_target: n(x.daily_target), weekly_target: n(x.weekly_target), monthly_target: n(x.monthly_target) })),
    settings: {
      cycle_start: (raw.settings?.cycle_start as string | null) ?? null,
      baseline: ((raw.settings?.baseline ?? {}) as Record<string, number>),
      baseline_note: (raw.settings?.baseline_note as string | null) ?? null,
    },
  };
}

/** Configuração do time da empresa (lojas, pessoas, indicadores, metas, ciclo). */
export function useTeamBase(load: () => Promise<TeamBase>) {
  const [base, setBase] = useState<TeamBase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try { setBase(await load()); setError(null); } catch (e) { setError((e as Error).message); }
  }, [load]);
  useEffect(() => {
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);
  return { base, error, reload };
}

export async function fetchValues(orgId: string, from: string, to: string, tz: string): Promise<TeamValue[]> {
  const { data, error } = await supabaseBrowser().rpc("team_values", { org: orgId, p_from: from, p_to: to, tz });
  if (error) throw error;
  return ((data ?? []) as TeamValue[]).map((v) => ({ ...v, value: Number(v.value) }));
}

export async function fetchSales(orgId: string, from: string, to: string): Promise<TeamSale[]> {
  const { data, error } = await supabaseBrowser().from("team_sales")
    .select("id, seller_id, store_id, sdr_id, day, value, os_number, note, created_at")
    .eq("organization_id", orgId).gte("day", from).lte("day", to).order("created_at", { ascending: false }).limit(5000);
  if (error) throw error;
  return ((data ?? []) as TeamSale[]).map((x) => ({ ...x, value: Number(x.value) }));
}

export async function fetchNotes(orgId: string, from: string, to: string): Promise<TeamNote[]> {
  const { data, error } = await supabaseBrowser().from("team_notes")
    .select("seller_id, day, body, updated_at").eq("organization_id", orgId).gte("day", from).lte("day", to)
    .order("day", { ascending: false }).limit(2000);
  if (error) throw error;
  return (data ?? []) as TeamNote[];
}

// ---------------------------------------------------------------------------------------------
// Fonte de dados do checklist: pelo login (dentro do CRM) ou pelo link do cliente (sem login)
// ---------------------------------------------------------------------------------------------

export interface VoiceFill { heard: string; updates: { metric_id: string; add: number }[]; note: string | null }

export interface TeamApi {
  key: string;
  userId: string | null;
  canManage: boolean;
  /** Link do cliente: sem login, todo mundo da lista pode preencher. */
  isPublic: boolean;
  values(from: string, to: string, tz: string): Promise<TeamValue[]>;
  sales(from: string, to: string): Promise<TeamSale[]>;
  notes(from: string, to: string): Promise<TeamNote[]>;
  upsertEntry(e: { seller_id: string; metric_id: string; day: string; value: number }): Promise<void>;
  upsertNote(e: { seller_id: string; day: string; body: string }): Promise<TeamNote>;
  insertSale(e: { seller_id: string; day: string; value: number; os_number: string | null; sdr_id: string | null }): Promise<TeamSale>;
  deleteSale(id: string): Promise<void>;
  voice(audio: Blob, sellerId: string, text: string): Promise<VoiceFill>;
  /** Avisa quando algo muda (tempo real no CRM; consulta periódica no link). */
  subscribe(onChange: () => void): () => void;
}

export function loginTeamApi(orgId: string, userId: string, canManage: boolean): TeamApi {
  const sel = "id, seller_id, store_id, sdr_id, day, value, os_number, note, created_at";
  return {
    key: orgId, userId, canManage, isPublic: false,
    values: (f, t, tz) => fetchValues(orgId, f, t, tz),
    sales: (f, t) => fetchSales(orgId, f, t),
    notes: (f, t) => fetchNotes(orgId, f, t),
    async upsertEntry(e) {
      const { error } = await supabaseBrowser().from("team_entries").upsert({ organization_id: orgId, ...e, updated_by: userId }, { onConflict: "seller_id,metric_id,day" });
      if (error) throw new Error(error.message);
    },
    async upsertNote(e) {
      const { data, error } = await supabaseBrowser().from("team_notes").upsert({ organization_id: orgId, ...e, updated_by: userId }, { onConflict: "seller_id,day" })
        .select("seller_id, day, body, updated_at").single();
      if (error) throw new Error(error.message);
      return data as TeamNote;
    },
    async insertSale(e) {
      const { data, error } = await supabaseBrowser().from("team_sales").insert({ organization_id: orgId, ...e, created_by: userId }).select(sel).single();
      if (error) throw new Error(error.message);
      return { ...(data as TeamSale), value: Number(data.value) };
    },
    async deleteSale(id) {
      const { error } = await supabaseBrowser().from("team_sales").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    voice: (audio, sellerId, text) => postVoice("/api/team/voice", audio, sellerId, text),
    subscribe(onChange) {
      const sb = supabaseBrowser();
      const ch = sb.channel(`team-live-${orgId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "team_entries", filter: `organization_id=eq.${orgId}` }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "team_sales", filter: `organization_id=eq.${orgId}` }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "team_notes", filter: `organization_id=eq.${orgId}` }, onChange)
        .subscribe();
      return () => { void sb.removeChannel(ch); };
    },
  };
}

async function postVoice(url: string, audio: Blob, sellerId: string, text: string): Promise<VoiceFill> {
  const form = new FormData();
  form.append("audio", audio, "audio.webm");
  form.append("sellerId", sellerId);
  if (text) form.append("text", text);
  const r = await fetch(url, { method: "POST", body: form });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "Não consegui entender o áudio");
  return j as VoiceFill;
}

export function publicTeamApi(token: string): TeamApi {
  const base = `/api/checklist/${encodeURIComponent(token)}`;
  const get = async <T,>(q: string): Promise<T> => {
    const r = await fetch(`${base}?${q}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? "Erro");
    return j as T;
  };
  const post = async <T,>(body: object): Promise<T> => {
    const r = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? "Erro");
    return j as T;
  };
  return {
    key: token, userId: null, canManage: false, isPublic: true,
    values: async (f, t, tz) => (await get<{ values: TeamValue[] }>(`scope=values&from=${f}&to=${t}&tz=${encodeURIComponent(tz)}`)).values.map((v) => ({ ...v, value: Number(v.value) })),
    sales: async (f, t) => (await get<{ sales: TeamSale[] }>(`scope=sales&from=${f}&to=${t}`)).sales.map((v) => ({ ...v, value: Number(v.value) })),
    notes: async (f, t) => (await get<{ notes: TeamNote[] }>(`scope=notes&from=${f}&to=${t}`)).notes,
    upsertEntry: async (e) => { await post({ op: "entry", ...e }); },
    upsertNote: async (e) => (await post<{ note: TeamNote }>({ op: "note", ...e })).note,
    insertSale: async (e) => { const s = (await post<{ sale: TeamSale }>({ op: "sale", ...e })).sale; return { ...s, value: Number(s.value) }; },
    deleteSale: async (id) => { await post({ op: "deleteSale", id }); },
    voice: (audio, sellerId, text) => postVoice(`${base}/voice`, audio, sellerId, text),
    subscribe(onChange) {
      const t = setInterval(() => { if (document.visibilityState === "visible") onChange(); }, 30_000);
      return () => clearInterval(t);
    },
  };
}

export const TeamApiContext = createContext<TeamApi | null>(null);
export function useTeamApi(): TeamApi {
  const api = useContext(TeamApiContext);
  if (!api) throw new Error("TeamApiContext ausente");
  return api;
}
