import "server-only";
import { envOptional } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { transcribe } from "@/lib/voice";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { metricApplies, type TeamMetric, type TeamSeller } from "@/lib/team";

const MAX_AUDIO = 10 * 1024 * 1024;

interface M { id: string; name: string; parent: string | null }

/** Texto falado → quanto somar em cada atividade + o resto (nomes, combinados) para as notas. */
export async function parseDay(text: string, metrics: M[]): Promise<{ updates: { metric_id: string; add: number }[]; note: string | null }> {
  const list = metrics.map((m, i) => `${i + 1}. ${m.name}${m.parent ? ` (resultado de "${m.parent}")` : ""}`).join("\n");
  const system = [
    "Você preenche o checklist diário de um vendedor a partir do que ele falou (português do Brasil, vindo de áudio, pode ter erros de transcrição).",
    "Atividades do checklist:", list,
    "Para cada quantidade que ele disse ter feito, escolha a atividade mais parecida pelo sentido (\"liguei para 3\" = ligações/contatos; \"fiz 5 follow up\" = follow-ups; \"resgatei 10 clientes\" = resgates/clientes recuperados; \"uma venda de indicação\" = vendas/pedidos de indicação). Números por extenso viram números (\"uma\" = 1).",
    "Só use atividades da lista. Não invente quantidades. Se algo dito não cabe em nenhuma atividade, não force.",
    "Em \"nota\" coloque só detalhes úteis para o gestor que não são números (nomes de clientes, telefones, combinados, objeções), em frases curtas. Se não houver, null.",
    'Responda SÓ JSON: {"itens":[{"n":<número da atividade>,"qtd":<número>}],"nota":<texto ou null>}',
  ].join("\n");
  const raw = await askJson(system, text);
  let j: { itens?: { n?: unknown; qtd?: unknown }[]; nota?: unknown };
  try { j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { throw new HttpError(502, "Não consegui entender o áudio. Tente de novo, falando os números."); }
  const updates: { metric_id: string; add: number }[] = [];
  for (const it of j.itens ?? []) {
    const m = metrics[Number(it.n) - 1];
    const q = Number(it.qtd);
    if (m && Number.isFinite(q) && q > 0 && q <= 10_000) updates.push({ metric_id: m.id, add: Math.round(q * 100) / 100 });
  }
  const note = typeof j.nota === "string" && j.nota.trim() ? j.nota.trim().slice(0, 2000) : null;
  return { updates, note };
}

async function askJson(system: string, user: string): Promise<string> {
  const errors: string[] = [];
  const groq = envOptional("GROQ_API_KEY");
  if (groq) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", headers: { Authorization: `Bearer ${groq}`, "content-type": "application/json" },
        body: JSON.stringify({ model: envOptional("GROQ_CHECKLIST_MODEL", "llama-3.3-70b-versatile"), temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
        signal: AbortSignal.timeout(20_000),
      });
      const b = (await r.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
      if (r.ok && b.choices?.[0]?.message?.content) return b.choices[0].message.content;
      errors.push(`groq ${r.status} ${b.error?.message ?? ""}`);
    } catch (e) { errors.push(`groq ${(e as Error).message}`); }
  }
  const anth = envOptional("ANTHROPIC_API_KEY");
  if (anth) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "x-api-key": anth, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: envOptional("ANTHROPIC_VOICE_MODEL", "claude-sonnet-5-5"), max_tokens: 800, system, messages: [{ role: "user", content: user }] }),
        signal: AbortSignal.timeout(25_000),
      });
      const b = (await r.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
      const t = b.content?.find((c) => c.type === "text")?.text;
      if (r.ok && t) return t;
      errors.push(`claude ${r.status} ${b.error?.message ?? ""}`);
    } catch (e) { errors.push(`claude ${(e as Error).message}`); }
  }
  console.error("[checklist voz]", errors.join(" | ") || "sem chave");
  throw new HttpError(502, "O preenchimento por áudio está indisponível agora. Preencha nos botões + e −.");
}

/** Recebe o áudio de um vendedor da empresa e devolve o que preencher. */
export async function voiceFill(orgId: string, req: Request) {
  const form = await req.formData();
  const audio = form.get("audio");
  const sellerId = String(form.get("sellerId") ?? "");
  const hint = typeof form.get("text") === "string" ? String(form.get("text")).trim().slice(0, 1000) : "";
  if (!(audio instanceof Blob) || audio.size === 0) throw new HttpError(422, "Áudio não recebido");
  if (audio.size > MAX_AUDIO) throw new HttpError(413, "Áudio muito longo (máx. ~2 minutos)");
  const db = supabaseAdmin();
  const [{ data: seller }, { data: metrics }] = await Promise.all([
    db.from("team_sellers").select("id, name, user_id, active, position, role, store_id").eq("organization_id", orgId).eq("id", sellerId).maybeSingle(),
    db.from("team_metrics").select("id, name, unit, source:origin, role, result_of, active").eq("organization_id", orgId).eq("active", true).order("position"),
  ]);
  if (!seller) throw new HttpError(404, "Pessoa não encontrada");
  const ms = ((metrics ?? []) as unknown as TeamMetric[]).filter((m) => m.source === "manual" && metricApplies(m, seller as TeamSeller));
  if (!ms.length) throw new HttpError(422, "Não há atividades para preencher nesta função");
  const ext = audio.type.includes("mp4") ? "mp4" : audio.type.includes("ogg") ? "ogg" : "webm";
  let heard = "";
  try { heard = await transcribe(audio, `dia.${ext}`); } catch (e) { if (!hint) throw e; heard = hint; }
  if (!heard) throw new HttpError(422, "Não consegui ouvir nada. Fale mais perto do microfone.");
  const names = new Map(ms.map((m) => [m.id, m.name]));
  const r = await parseDay(heard, ms.map((m) => ({ id: m.id, name: m.name, parent: m.result_of ? names.get(m.result_of) ?? null : null })));
  return { heard, ...r };
}
