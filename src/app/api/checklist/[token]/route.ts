import { z } from "zod";
import { fail, HttpError, ok, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { orgByToken } from "@/lib/team-server/share";
import { isValidTimeZone, DEFAULT_TZ } from "@/lib/time";

export const runtime = "nodejs";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ip = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";

/** Link do cliente: lê só o checklist do time desta empresa. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    await rateLimit(`chk-get:${ip(req)}`, 600, 3600);
    const { orgId, orgName } = await orgByToken(token);
    const db = supabaseAdmin();
    const q = new URL(req.url).searchParams;
    const scope = q.get("scope") ?? "base";
    const from = q.get("from") ?? "", to = q.get("to") ?? "";
    if (scope !== "base" && (!DAY.test(from) || !DAY.test(to) || from > to)) throw new HttpError(422, "Período inválido");
    if (scope === "base") {
      const [st, s, m, g, cfg] = await Promise.all([
        db.from("team_stores").select("id, name, revenue_goal, os_daily_goal, position").eq("organization_id", orgId).order("position").order("created_at"),
        db.from("team_sellers").select("id, name, user_id, active, position, role, store_id").eq("organization_id", orgId).order("position").order("created_at"),
        db.from("team_metrics").select("id, name, unit, source:origin, role, result_of, daily_target, weekly_target, monthly_target, active, position").eq("organization_id", orgId).order("position").order("created_at"),
        db.from("team_seller_goals").select("seller_id, metric_id, daily_target, weekly_target, monthly_target").eq("organization_id", orgId),
        db.from("team_settings").select("cycle_start, baseline, baseline_note").eq("organization_id", orgId).maybeSingle(),
      ]);
      // Não expõe quem é o login de cada pessoa: só se tem ou não
      const sellers = (s.data ?? []).map((x) => ({ ...x, user_id: x.user_id ? "login" : null }));
      return ok({ orgName, stores: st.data ?? [], sellers, metrics: m.data ?? [], goals: g.data ?? [], settings: cfg.data ?? null });
    }
    if (scope === "values") {
      const tz = q.get("tz");
      const { data, error } = await db.rpc("team_values", { org: orgId, p_from: from, p_to: to, tz: isValidTimeZone(tz) ? tz : DEFAULT_TZ });
      if (error) throw error;
      return ok({ values: data ?? [] });
    }
    if (scope === "sales") {
      const { data, error } = await db.from("team_sales").select("id, seller_id, store_id, sdr_id, day, value, os_number, note, created_at")
        .eq("organization_id", orgId).gte("day", from).lte("day", to).order("created_at", { ascending: false }).limit(5000);
      if (error) throw error;
      return ok({ sales: data ?? [] });
    }
    if (scope === "notes") {
      const { data, error } = await db.from("team_notes").select("seller_id, day, body, updated_at")
        .eq("organization_id", orgId).gte("day", from).lte("day", to).order("day", { ascending: false }).limit(2000);
      if (error) throw error;
      return ok({ notes: data ?? [] });
    }
    throw new HttpError(422, "Consulta inválida");
  } catch (e) {
    return fail(e);
  }
}

const day = z.string().regex(DAY);
const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("entry"), seller_id: z.string().uuid(), metric_id: z.string().uuid(), day, value: z.number().min(0).max(1_000_000) }),
  z.object({ op: z.literal("note"), seller_id: z.string().uuid(), day, body: z.string().max(8000) }),
  z.object({ op: z.literal("sale"), seller_id: z.string().uuid(), day, value: z.number().min(0).max(100_000_000), os_number: z.string().max(40).nullable(), sdr_id: z.string().uuid().nullable() }),
  z.object({ op: z.literal("deleteSale"), id: z.string().uuid() }),
]);

/** Link do cliente: grava só no checklist desta empresa (pessoas e atividades dela). */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    await rateLimit(`chk-post:${token}`, 1200, 3600, "Muitas alterações seguidas. Aguarde um pouco.");
    const { orgId } = await orgByToken(token);
    const b = Body.parse(await readJson(req, 12_000));
    const db = supabaseAdmin();
    const sellerOk = async (id: string) => {
      const { data } = await db.from("team_sellers").select("id").eq("organization_id", orgId).eq("id", id).maybeSingle();
      if (!data) throw new HttpError(404, "Pessoa não encontrada");
    };
    if (b.op === "deleteSale") {
      const { error } = await db.from("team_sales").delete().eq("organization_id", orgId).eq("id", b.id);
      if (error) throw error;
      return ok({ ok: true });
    }
    await sellerOk(b.seller_id);
    if (b.op === "entry") {
      const { data: m } = await db.from("team_metrics").select("id, origin").eq("organization_id", orgId).eq("id", b.metric_id).maybeSingle();
      if (!m || m.origin !== "manual") throw new HttpError(404, "Atividade não encontrada");
      const { error } = await db.from("team_entries").upsert({ organization_id: orgId, seller_id: b.seller_id, metric_id: b.metric_id, day: b.day, value: Math.round(b.value * 100) / 100, updated_by: null }, { onConflict: "seller_id,metric_id,day" });
      if (error) throw error;
      return ok({ ok: true });
    }
    if (b.op === "note") {
      const { data, error } = await db.from("team_notes").upsert({ organization_id: orgId, seller_id: b.seller_id, day: b.day, body: b.body, updated_by: null }, { onConflict: "seller_id,day" })
        .select("seller_id, day, body, updated_at").single();
      if (error) throw error;
      return ok({ note: data });
    }
    if (b.sdr_id) await sellerOk(b.sdr_id);
    const { data, error } = await db.from("team_sales").insert({ organization_id: orgId, seller_id: b.seller_id, day: b.day, value: b.value, os_number: b.os_number, sdr_id: b.sdr_id, created_by: null })
      .select("id, seller_id, store_id, sdr_id, day, value, os_number, note, created_at").single();
    if (error) throw error;
    return ok({ sale: data }, 201);
  } catch (e) {
    return fail(e);
  }
}
