import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadChannel } from "@/lib/whatsapp";
import * as ig from "@/lib/instagram";
import { buttonPayload, DEFAULT_NOT_FOLLOWING, matchesKeywords, parsePayload, RETRY_FOLLOW_BUTTON, type IgFlowRow, type IgPostMedia, type IgStep } from "@/lib/ig-flows";

type FlowDb = IgFlowRow & { organization_id: string; post_container_id: string | null; post_attempts: number };
type RunDb = { id: string; flow_id: string; organization_id: string; igsid: string; comment_id: string | null; step: number; status: string; error: string | null; follow_blocks: number };

const BUCKET = "ig-posts";
const msg = (e: unknown) => ((e as Error)?.message ?? "erro").replace(/^Instagram:\s*/, "").slice(0, 300);

// ---------- publicação agendada ----------

/** Publica o que venceu e acompanha o que o Instagram ainda está processando. Chamado a cada minuto. */
export async function runIgPosts() {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("claim_ig_posts", { p_limit: 3 });
  if (error) throw error;
  const out = { published: 0, processing: 0, failed: 0 };
  for (const f of (data ?? []) as FlowDb[]) {
    const set = (v: Record<string, unknown>) => db.from("ig_flows").update(v).eq("id", f.id);
    try {
      const ch = await loadChannel(f.channel_id);
      const token = ch.secrets.meta_access_token ?? "";
      if (ch.status !== "connected" || !token || !ch.ig_user_id) throw new Error("A conta do Instagram está desconectada. Reconecte e agende de novo.");
      let container = f.post_container_id;
      if (f.post_status === "scheduled") {
        const m = f.post_media as IgPostMedia | null;
        if (!m) throw new Error("Publicação sem arquivo");
        const { data: signed, error: se } = await db.storage.from(BUCKET).createSignedUrl(m.path, 6 * 3600);
        if (se || !signed?.signedUrl) throw new Error("Não consegui abrir o arquivo da publicação");
        container = await ig.createPostContainer(token, ch.ig_user_id, { kind: m.kind, url: signed.signedUrl, caption: f.post_caption });
        await set({ post_status: "processing", post_container_id: container, post_error: null, post_attempts: 0 });
      }
      if (!container) throw new Error("Publicação sem preparo");
      const st = await ig.postContainerStatus(token, container);
      if (st.code === "FINISHED") {
        const pub = await ig.publishPostContainer(token, ch.ig_user_id, container);
        await set({ post_status: "published", post_media_id: pub.id, post_permalink: pub.permalink, published_at: new Date().toISOString(), post_error: null });
        out.published++;
      } else if (st.code === "ERROR" || st.code === "EXPIRED") {
        await set({ post_status: "failed", post_error: `O Instagram recusou o arquivo${st.detail ? `: ${st.detail}` : ""}`.slice(0, 300) });
        out.failed++;
      } else if (f.post_status === "processing" && f.post_attempts > 30) {
        await set({ post_status: "failed", post_error: "O Instagram demorou mais de 30 minutos para processar o vídeo. Tente um arquivo menor." });
        out.failed++;
      } else out.processing++;
    } catch (e) {
      console.error("[ig post]", f.id, e);
      // Antes de criar o preparo dá para tentar de novo; depois disso, repetir poderia publicar duas vezes.
      if (f.post_status === "scheduled" && f.post_attempts < 3) await set({ post_error: msg(e) });
      else if (f.post_status === "processing" && f.post_attempts <= 30 && !/recusou|Publicação sem/.test(msg(e))) await set({ post_error: msg(e) });
      else { await set({ post_status: "failed", post_error: msg(e) }); out.failed++; }
    }
  }
  return out;
}

// ---------- gatilho de comentário ----------

export interface IgCommentEvent { id?: string; text?: string; from?: { id?: string; username?: string }; media?: { id?: string } }

async function channelOf(igUserId: string) {
  const { data } = await supabaseAdmin().from("whatsapp_channels").select("id, organization_id, status").eq("provider", "instagram").eq("ig_user_id", igUserId).maybeSingle();
  return data && data.status === "connected" ? (data as { id: string; organization_id: string }) : null;
}

/** Alguém comentou: se bater com um fluxo ligado, manda a primeira mensagem no Direct. */
export async function handleIgComment(igUserId: string, c: IgCommentEvent) {
  const from = c.from?.id, commentId = c.id;
  if (!from || !commentId || from === igUserId) return; // ignora os próprios comentários (inclusive a resposta pública do fluxo)
  const row = await channelOf(igUserId);
  if (!row) return;
  const db = supabaseAdmin();
  const { data: flows } = await db.from("ig_flows").select("*").eq("channel_id", row.id).eq("enabled", true);
  const mediaId = c.media?.id ?? null;
  const cand = ((flows ?? []) as FlowDb[])
    .filter((f) => (f.post_mode === "any" || (mediaId && f.post_media_id === mediaId)) && f.steps.length > 0 && matchesKeywords(c.text ?? "", f.keywords))
    .sort((a, b) => Number(a.post_mode === "any") - Number(b.post_mode === "any")); // o fluxo da publicação ganha do "qualquer publicação"
  const flow = cand[0];
  if (!flow) return;

  const { data: prev } = await db.from("ig_flow_runs").select("id, comment_id").eq("flow_id", flow.id).eq("igsid", from).maybeSingle();
  if (prev?.comment_id === commentId) return; // aviso repetido da Meta
  const now = new Date().toISOString();
  const fields = { comment_id: commentId, username: c.from?.username ?? null, step: 0, status: "active", error: null, follow_blocks: 0, updated_at: now, completed_at: null };
  let runId = prev?.id as string | undefined;
  if (runId) await db.from("ig_flow_runs").update(fields).eq("id", runId);
  else {
    const { data: ins, error } = await db.from("ig_flow_runs").insert({ flow_id: flow.id, organization_id: flow.organization_id, igsid: from, ...fields }).select("id").single();
    if (error) { if (error.code === "23505") return; throw error; }
    runId = ins.id;
  }
  const ch = await loadChannel(row.id);
  const token = ch.secrets.meta_access_token ?? "";
  const first = flow.steps[0] as IgStep;
  try {
    await ig.sendButtons(token, { comment_id: commentId }, first.text, [{ title: first.button, payload: buttonPayload(runId!, 0) }]);
  } catch (e1) {
    // Se o Instagram não aceitar botão na resposta ao comentário, segue por texto: a pessoa responde e o fluxo anda.
    try {
      await ig.sendTextTo(token, { comment_id: commentId }, `${first.text}\n\nResponda OK para continuar.`);
      await db.from("ig_flow_runs").update({ error: "fallback" }).eq("id", runId!);
    } catch (e2) {
      console.error("[ig flow] primeira mensagem", msg(e1), msg(e2));
      await db.from("ig_flow_runs").update({ status: "failed", error: msg(e2) }).eq("id", runId!);
      return;
    }
  }
  if (flow.comment_reply?.trim()) {
    try { await ig.replyToComment(token, commentId, flow.comment_reply); } catch (e) { console.error("[ig flow] resposta pública", msg(e)); }
  }
}

// ---------- cliques nos botões ----------

async function advance(run: RunDb, flow: FlowDb, token: string) {
  const db = supabaseAdmin();
  const k = run.step, target = k + 1, isFinal = target >= flow.steps.length;
  const needFollow = isFinal ? flow.final_require_follow : (flow.steps[target] as IgStep).requireFollow;
  const to = { id: run.igsid };
  if (needFollow && (await ig.followsBusiness(token, run.igsid)) === false) {
    await db.from("ig_flow_runs").update({ follow_blocks: run.follow_blocks + 1, updated_at: new Date().toISOString() }).eq("id", run.id);
    await ig.sendButtons(token, to, flow.not_following_text?.trim() || DEFAULT_NOT_FOLLOWING, [{ title: RETRY_FOLLOW_BUTTON, payload: buttonPayload(run.id, k) }]);
    return;
  }
  // Reserva o avanço antes de enviar: dois cliques seguidos não mandam a mesma etapa duas vezes.
  const { data: won } = await db.from("ig_flow_runs").update({ step: target, updated_at: new Date().toISOString(), ...(isFinal ? { status: "done", completed_at: new Date().toISOString() } : {}) })
    .eq("id", run.id).eq("step", k).eq("status", "active").select("id");
  if (!won?.length) return;
  try {
    if (isFinal) await ig.sendButtons(token, to, flow.final_text ?? "", [{ title: flow.final_button ?? "Abrir", url: flow.final_url ?? "" }]);
    else { const s = flow.steps[target] as IgStep; await ig.sendButtons(token, to, s.text, [{ title: s.button, payload: buttonPayload(run.id, target) }]); }
  } catch (e) {
    await db.from("ig_flow_runs").update({ step: k, status: "active", completed_at: null, error: msg(e) }).eq("id", run.id);
    throw e;
  }
}

async function loadRun(runId: string, igUserId: string, senderId: string) {
  const row = await channelOf(igUserId);
  if (!row) return null;
  const db = supabaseAdmin();
  const { data: run } = await db.from("ig_flow_runs").select("*").eq("id", runId).maybeSingle();
  if (!run || run.igsid !== senderId || run.status !== "active") return null;
  const { data: flow } = await db.from("ig_flows").select("*").eq("id", run.flow_id).maybeSingle();
  if (!flow || flow.channel_id !== row.id || !flow.enabled) return null;
  const ch = await loadChannel(row.id);
  return { run: run as RunDb, flow: flow as FlowDb, token: ch.secrets.meta_access_token ?? "" };
}

/** Clique em botão do fluxo. Devolve true quando o clique era de um fluxo (para não acordar a IA). */
export async function handleIgPostback(igUserId: string, senderId: string, payload: string | undefined) {
  const p = parsePayload(payload);
  if (!p) return false;
  try {
    const x = await loadRun(p.runId, igUserId, senderId);
    if (x && p.step === x.run.step) await advance(x.run, x.flow, x.token); // botão de etapa antiga é ignorado
  } catch (e) { console.error("[ig flow] clique", msg(e)); }
  return true;
}

/** Sem botão (modo texto): a resposta da pessoa vale como clique. Devolve true se a mensagem era de um fluxo. */
export async function handleIgFlowText(igUserId: string, senderId: string) {
  const row = await channelOf(igUserId);
  if (!row) return false;
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: runs } = await supabaseAdmin().from("ig_flow_runs").select("id").eq("igsid", senderId).eq("organization_id", row.organization_id).eq("status", "active").eq("error", "fallback").gte("updated_at", since).order("updated_at", { ascending: false }).limit(1);
  if (!runs?.length) return false;
  try {
    const x = await loadRun(runs[0]!.id, igUserId, senderId);
    if (!x) return false;
    await advance(x.run, x.flow, x.token);
  } catch (e) { console.error("[ig flow] resposta", msg(e)); }
  return true;
}
